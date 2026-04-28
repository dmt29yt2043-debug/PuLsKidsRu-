import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';

const csvPath = path.join(__dirname, '..', 'data', 'event_ru.csv');
const dbPath = path.join(__dirname, '..', 'data', 'events.db');

// BUG_009: previously we `unlinkSync(dbPath)` — which also wiped the `digests`
// and `digest_events` tables seeded separately. Now we only drop/recreate
// the `events` table (and its indexes), preserving everything else.
//
// NOTE: the legacy manually-seeded `digests` / `digest_events` tables are
// intentionally dropped here — digest generation is now fully programmatic
// via `lib/digests/` (5 curated digests computed at query time, no DB rows).
const db = new Database(dbPath);
db.exec(`
  DROP INDEX IF EXISTS idx_events_category;
  DROP INDEX IF EXISTS idx_events_free;
  DROP INDEX IF EXISTS idx_events_lat_lon;
  DROP INDEX IF EXISTS idx_events_start;
  DROP TABLE IF EXISTS digest_events;
  DROP TABLE IF EXISTS digests;
  DROP TABLE IF EXISTS events;
`);

db.exec(`
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    external_id TEXT,
    title TEXT NOT NULL,
    short_title TEXT,
    tagline TEXT,
    description TEXT,
    description_source TEXT,
    source_url TEXT,
    image_url TEXT,
    venue_name TEXT,
    subway TEXT,
    address TEXT,
    city TEXT,
    city_district TEXT,
    city_locality TEXT,
    country_county TEXT,
    lat REAL,
    lon REAL,
    timezone TEXT,
    schedule TEXT DEFAULT '{}',
    occurrences TEXT DEFAULT '[]',
    schedule_confidence INTEGER,
    schedule_source TEXT,
    next_start_at TEXT,
    next_end_at TEXT,
    age_min INTEGER,
    age_label TEXT,
    age_best_from INTEGER,
    age_best_to INTEGER,
    is_free INTEGER DEFAULT 0,
    price_summary TEXT,
    price_min REAL DEFAULT 0,
    price_max REAL DEFAULT 0,
    category_l1 TEXT,
    category_l2 TEXT,
    category_l3 TEXT,
    categories TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    format TEXT,
    motivation TEXT,
    class_meta TEXT DEFAULT '{}',
    reviews TEXT DEFAULT '[]',
    derisk TEXT DEFAULT '{}',
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    favorites_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'published',
    disabled INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX idx_events_category ON events(category_l1);
  CREATE INDEX idx_events_free ON events(is_free);
  CREATE INDEX idx_events_lat_lon ON events(lat, lon);
  CREATE INDEX idx_events_start ON events(next_start_at);
  CREATE INDEX idx_events_status ON events(status);
  CREATE INDEX idx_events_county ON events(country_county);
`);

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });

function parsePythonList(val: string): string[] {
  if (!val || val === '[]' || val === '') return [];
  try {
    // Try JSON first
    return JSON.parse(val.replace(/'/g, '"'));
  } catch {
    // Extract strings from python-like list
    const matches = val.match(/'([^']+)'/g);
    return matches ? matches.map(m => m.replace(/'/g, '')) : [];
  }
}

function parsePythonDict(val: string): Record<string, unknown> {
  if (!val || val === '{}' || val === '') return {};
  try {
    return JSON.parse(val.replace(/'/g, '"').replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null'));
  } catch {
    // Try harder with regex for nested structures
    try {
      const cleaned = val
        .replace(/'/g, '"')
        .replace(/True/g, 'true')
        .replace(/False/g, 'false')
        .replace(/None/g, 'null')
        .replace(/\\n/g, ' ')
        .replace(/\n/g, ' ');
      return JSON.parse(cleaned);
    } catch {
      return {};
    }
  }
}

function parseReviews(val: string): Array<{ text: string }> {
  const list = parsePythonList(val);
  return list.map(text => ({ text }));
}

function getImageUrl(row: Record<string, string>): string {
  // Try images field first for CDN URLs
  const images = row.images || '';
  const cdnMatch = images.match(/https:\/\/pulse-cdn\.dnogin\.com\/[^'"\s]+/);
  if (cdnMatch) return cdnMatch[0];
  // Fall back to picture_url
  return row.picture_url || '';
}

function getSourceUrl(row: Record<string, string>): string {
  const urls = row.source_urls || '';
  const ticketMatch = urls.match(/'ticket':\s*'([^']+)'/);
  if (ticketMatch) return ticketMatch[1];
  return row.canonical_url || '';
}

// ===========================================================================
// Data normalization — applied as each CSV row is imported.
// These rules fix recurring data bugs that would otherwise come back with
// every new CSV dump. DO NOT run one-off UPDATE statements on the DB —
// they'll be wiped on next import. Add the rule here instead.
// Each function is pure and side-effect-free on purpose.
// ===========================================================================

// BUG_005: some events ship with age ranges like 0–100 or 0–150, which makes
// them show up for every age filter and spoils personalization. Clamp to
// [0, 18]. If ranges go inverted or negative, normalize them too.
function clampAge(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 18) return 18;
  return n;
}

// BUG_006: a few events claim is_free=True while still carrying a non-zero
// price_min/price_max. Trust the `is_free` flag, zero the prices.
function reconcileFreeAndPrice(isFree: number, priceMin: number, priceMax: number) {
  if (isFree === 1 && (priceMin > 0 || priceMax > 0)) {
    return { priceMin: 0, priceMax: 0 };
  }
  return { priceMin, priceMax };
}

// BUG_004: CSV delivers next_end_at as "" (empty string) for all events.
// An empty string compares as < any ISO timestamp in SQL and silently breaks
// date-range filters. Store NULL instead; the app already handles NULL.
function normalizeDate(v: string | undefined | null): string | null {
  if (!v || v === '' || v === 'None' || v === 'null') return null;
  return v;
}

// BUG_003: ~40% of events come without category_l1 but usually carry
// categories[] or tags[] in JSON. Pick the first non-empty value and use it
// as category_l1 so category filters work out of the box.
const CATEGORY_ALIASES: Record<string, string> = {
  // Map CSV's capitalized "human" categories to our canonical slugs
  'Art': 'arts', 'Arts & Crafts': 'arts', 'Painting': 'arts',
  'Music': 'music', 'Cultural Events': 'arts',
  'Theater': 'theater', 'Circus': 'theater', 'Movies': 'film',
  'History': 'books', 'Walking Tour': 'attractions',
  "Children's Activities": 'family', 'Family Activities': 'family',
  'Kids Activities': 'family', 'Family Events': 'family',
  'Outdoor Activities': 'outdoors',
  'STEAM': 'science', 'STEM': 'science', 'Science': 'science',
  'Dining': 'food', 'Food': 'food',
  // Kudago English slugs that aren't canonical
  'concert': 'music', 'Concert': 'music',
  'kids': 'family', 'Kids': 'family',
  'comedy': 'theater',
};
// Canonical category slugs — anything outside this set is rejected to avoid
// exploding the category facet with tag-derived noise (e.g. "dinosaurs",
// "baking", "bingo"). Must match labels exposed by lib/db.ts::getCategories.
const CANONICAL_CATEGORIES = new Set([
  'family', 'arts', 'theater', 'attractions', 'books', 'holiday', 'sports',
  'comedy', 'community', 'education', 'fashion', 'film', 'food', 'gaming',
  'music', 'nightlife', 'outdoors', 'science', 'wellness',
]);

// Russian (Kudago) category names → canonical slugs.
// Covers the most common values found in kudago.com Moscow event feed.
const RU_CATEGORY_ALIASES: Record<string, string> = {
  // Изобразительное / творчество → arts
  'выставки': 'arts',
  'выставка': 'arts',
  'живопись': 'arts',
  'рисование': 'arts',
  'рукоделие': 'arts',
  'творчество': 'arts',
  'арт': 'arts',
  'искусство': 'arts',
  'галерея': 'arts',
  // Театр, цирк, танцы → theater
  'спектакли': 'theater',
  'спектакль': 'theater',
  'театры': 'theater',
  'театр': 'theater',
  'балет': 'theater',
  'цирк': 'theater',
  'танцы': 'theater',
  'хореография': 'theater',
  'перформанс': 'theater',
  'шоу': 'theater',
  // Музыка → music
  'концерты': 'music',
  'концерт': 'music',
  'музыка': 'music',
  'опера': 'music',
  'джаз': 'music',
  'хор': 'music',
  // Кино → film
  'кино': 'film',
  'кинотеатр': 'film',
  'кинофестиваль': 'film',
  'мультфильмы': 'film',
  // Дети, семья → family
  'детям': 'family',
  'дети': 'family',
  'семья': 'family',
  'семейные': 'family',
  'развлечения': 'family',
  'аниматоры': 'family',
  'детский': 'family',
  // Мастер-классы, обучение → education
  'мастер-классы': 'education',
  'мастер-класс': 'education',
  'мастерклассы': 'education',
  'воркшоп': 'education',
  'курсы': 'education',
  'обучение': 'education',
  'образование': 'education',
  'лекции': 'education',
  'лекция': 'education',
  // Прогулки, природа → outdoors
  'прогулки': 'outdoors',
  'экотуризм': 'outdoors',
  'природа': 'outdoors',
  'парк': 'outdoors',
  'активный отдых': 'outdoors',
  // Музеи, экскурсии → attractions
  'экскурсии': 'attractions',
  'экскурсия': 'attractions',
  'музеи': 'attractions',
  'музей': 'attractions',
  'достопримечательности': 'attractions',
  'зоопарк': 'attractions',
  'аквариум': 'attractions',
  'планетарий': 'attractions',
  // Наука → science
  'наука': 'science',
  'технологии': 'science',
  'роботехника': 'science',
  'робототехника': 'science',
  'программирование': 'science',
  'stem': 'science',
  // Спорт → sports
  'спорт': 'sports',
  'фитнес': 'sports',
  'йога': 'sports',
  'плавание': 'sports',
  'гимнастика': 'sports',
  'футбол': 'sports',
  'единоборства': 'sports',
  // Еда → food
  'еда': 'food',
  'гастрономия': 'food',
  'кулинария': 'food',
  'кухня': 'food',
  // Праздники, фестивали → holiday
  'праздники': 'holiday',
  'праздник': 'holiday',
  'фестивали': 'holiday',
  'фестиваль': 'holiday',
  'день рождения': 'holiday',
  // Книги → books
  'книги': 'books',
  'литература': 'books',
  'чтение': 'books',
  'библиотека': 'books',
  // Квесты, игры → gaming
  'квесты': 'gaming',
  'квест': 'gaming',
  'игры': 'gaming',
  'настольные игры': 'gaming',
  // Wellness
  'медитация': 'wellness',
  'здоровье': 'wellness',
  'психология': 'wellness',
};

function deriveCategory(raw: string, categoriesJson: string, tagsJson: string): string {
  if (raw && raw.trim() && raw.toLowerCase() !== 'other') {
    const rawLow = raw.toLowerCase().trim();
    // Keep raw if it's canonical OR if it's a known display form
    if (CANONICAL_CATEGORIES.has(rawLow)) return rawLow;
    if (CATEGORY_ALIASES[raw]) return CATEGORY_ALIASES[raw];
    if (RU_CATEGORY_ALIASES[rawLow]) return RU_CATEGORY_ALIASES[rawLow];
    return raw; // Preserve pre-existing non-canonical values to avoid regressions
  }
  const pool: string[] = [];
  try { pool.push(...(JSON.parse(categoriesJson) as string[])); } catch {}
  try { pool.push(...(JSON.parse(tagsJson) as string[])); } catch {}
  // 1) Try EN alias map (handles "Art", "Children's Activities", etc.)
  for (const c of pool) {
    if (!c) continue;
    if (CATEGORY_ALIASES[c]) return CATEGORY_ALIASES[c];
  }
  // 2) Try RU alias map
  for (const c of pool) {
    const low = String(c).toLowerCase().trim();
    if (RU_CATEGORY_ALIASES[low]) return RU_CATEGORY_ALIASES[low];
  }
  // 3) Try direct canonical match (lowercased)
  for (const c of pool) {
    const low = String(c).toLowerCase();
    if (CANONICAL_CATEGORIES.has(low)) return low;
  }
  // 4) Give up — let the filter fall back to tag/category JSON lookup at query time
  return '';
}

// BUG_007 (monitoring only): log how many events have no geocode so we can
// track the trend across CSV drops. We don't auto-geocode here.
function countMissingGeo(lat: number | null, lon: number | null): number {
  return (lat === null || lon === null) ? 1 : 0;
}

const insert = db.prepare(`
  INSERT INTO events (
    id, external_id, title, short_title, tagline, description, description_source,
    source_url, image_url,
    venue_name, subway, address, city, city_district, city_locality, country_county,
    lat, lon, timezone,
    schedule, occurrences, schedule_confidence, schedule_source,
    next_start_at, next_end_at,
    age_min, age_label, age_best_from, age_best_to,
    is_free, price_summary, price_min, price_max,
    category_l1, category_l2, category_l3, categories, tags,
    format, motivation, class_meta,
    reviews, derisk,
    rating_avg, rating_count, favorites_count, comments_count,
    data, status, disabled, archived, created_at, updated_at)
  VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?)
`);

let imported = 0;
let skipped = 0;
// Counters for the post-import normalization report
const norm = {
  age_clamped: 0,
  free_price_reconciled: 0,
  end_date_nullified: 0,
  category_derived: 0,
  missing_geo: 0,
  past_events_skipped: 0,
  outside_moscow_skipped: 0,
};

// BUG_008: skip events that have ALREADY ENDED. We previously cut on
// `next_start_at < now` alone, which dropped recurring exhibitions /
// long-running shows whose start was yesterday but end in 2 weeks. Now we
// keep an event if ANY of these hold:
//   1. next_start_at is in the future
//   2. next_end_at is in the future (still running)
//   3. schedule.items contains any future date
//   4. no date at all (safe default)
const NOW_MS = Date.now();
const NOW_DATE = new Date().toISOString().slice(0, 10);
function isPastEvent(row: Record<string, string>): boolean {
  const start = row.next_start_at;
  const end = row.next_end_at;

  // 1. start is in the future → keep
  if (start && start.trim() !== '' && start !== 'None' && start !== 'null') {
    const startMs = new Date(start).getTime();
    if (Number.isFinite(startMs) && startMs >= NOW_MS) return false;
  } else {
    // No start → keep (unknown / recurring)
    return false;
  }

  // 2. end is in the future → still running → keep
  if (end && end.trim() !== '' && end !== 'None' && end !== 'null') {
    const endMs = new Date(end).getTime();
    if (Number.isFinite(endMs) && endMs >= NOW_MS) return false;
  }

  // 3. schedule.items has any future date → keep
  const sched = row.schedule;
  if (sched && sched.includes('items')) {
    try {
      const parsed = JSON.parse(
        sched.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'),
      );
      if (parsed && Array.isArray(parsed.items)) {
        for (const it of parsed.items) {
          const d = it && (it.date || it.start_at);
          if (typeof d === 'string' && d.slice(0, 10) >= NOW_DATE) return false;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Otherwise — past
  return true;
}

// Moscow geo sanity check: skip events that are clearly outside Moscow
// (e.g. St. Petersburg events that occasionally appear in the Kudago feed).
// Events with no city field are kept (unknown location = keep, safe default).
const MOSCOW_CITY_ALIASES = new Set([
  'москва', 'moscow', 'г. москва', 'г.москва', 'город москва',
]);

function isOutsideMoscow(row: Record<string, string>): boolean {
  const city = (row.city || '').trim().toLowerCase();
  if (!city || city === '') return false; // no city → keep
  // Keep if it's a known Moscow variant
  if (MOSCOW_CITY_ALIASES.has(city)) return false;
  // Keep if it starts with "москва" (handles "Москва, ЦАО" etc.)
  if (city.startsWith('москва')) return false;
  // If a non-empty city is set and it's not Moscow, skip it
  return true;
}

const insertMany = db.transaction((rows: Record<string, string>[]) => {
  for (const row of rows) {
    try {
      // Postgres CSV export uses 't'/'f' (single chars); older dumps 'True'/'False'.
      const truthy = (v: string | undefined) => v === 'True' || v === 't' || v === 'true' || v === '1';
      if (row.status === 'disabled' || truthy(row.disabled) || truthy(row.archived)) {
        skipped++;
        continue;
      }

      // BUG_008 — skip events that have fully ended (start, end, AND all
      // scheduled dates are past). Recurring / long-running events stay.
      if (isPastEvent(row)) {
        skipped++;
        norm.past_events_skipped++;
        continue;
      }

      // Skip non-Moscow events (e.g. St. Petersburg events in Kudago feed)
      if (isOutsideMoscow(row)) {
        skipped++;
        norm.outside_moscow_skipped++;
        continue;
      }

      const lat = row.lat ? parseFloat(row.lat) : null;
      const lon = row.lon ? parseFloat(row.lon) : null;
      norm.missing_geo += countMissingGeo(lat, lon);

      // BUG_005 — clamp ages
      const rawMin = row.age_min ? parseInt(row.age_min) : null;
      const rawBestFrom = row.age_best_from ? parseInt(row.age_best_from) : null;
      const rawBestTo = row.age_best_to ? parseInt(row.age_best_to) : null;
      const ageMin = clampAge(rawMin);
      const ageBestFrom = clampAge(rawBestFrom);
      const ageBestTo = clampAge(rawBestTo);
      if (ageMin !== rawMin || ageBestFrom !== rawBestFrom || ageBestTo !== rawBestTo) {
        norm.age_clamped++;
      }

      // BUG_006 — reconcile is_free with price.
      // CSV uses Postgres boolean export 't'/'f' (single chars). Older
      // dumps used 'True'/'False'. Accept both.
      const isFreeFlag =
        (row.is_free === 'True' || row.is_free === 't' || row.is_free === 'true' || row.is_free === '1')
          ? 1 : 0;
      const rawPriceMin = row.price_min ? parseFloat(row.price_min) : 0;
      const rawPriceMax = row.price_max ? parseFloat(row.price_max) : 0;
      const { priceMin, priceMax } = reconcileFreeAndPrice(isFreeFlag, rawPriceMin, rawPriceMax);
      if (priceMin !== rawPriceMin || priceMax !== rawPriceMax) norm.free_price_reconciled++;

      // BUG_004 — empty end_date -> NULL (count both empty-string and whitespace cases)
      const rawEndAt = row.next_end_at;
      const nextEndAt = normalizeDate(rawEndAt);
      if (rawEndAt !== undefined && rawEndAt !== nextEndAt && nextEndAt === null) {
        norm.end_date_nullified++;
      }

      // BUG_003 — derive category if missing
      const categoriesJson = JSON.stringify(parsePythonList(row.categories || ''));
      const tagsJson = JSON.stringify(parsePythonList(row.tags || ''));
      const rawCategory = row.category_l1 || '';
      const categoryL1 = deriveCategory(rawCategory, categoriesJson, tagsJson);
      if (!rawCategory && categoryL1) norm.category_derived++;

      // Normalize Python-style booleans / None to proper JS values
      const toFlag = (v: string | undefined) => v === 'True' ? 1 : 0;
      const normText = (v: string | undefined) => {
        if (v === undefined || v === null) return '';
        const s = String(v).trim();
        if (s === '' || s === 'None' || s === 'null' || s === 'nan' || s === 'NaN') return '';
        return s;
      };
      const normInt = (v: string | undefined): number | null => {
        const s = normText(v);
        if (s === '') return null;
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      };

      // Schedule / occurrences are Python-dict strings → normalize to proper JSON
      const scheduleJson = row.schedule ? JSON.stringify(parsePythonDict(row.schedule)) : '{}';
      const occurrencesJson = row.occurrences ? JSON.stringify(parsePythonList(row.occurrences).length
        ? parsePythonList(row.occurrences)
        : parsePythonDict(row.occurrences)) : '[]';
      // class_meta can be dict or string
      const classMetaJson = row.class_meta ? JSON.stringify(parsePythonDict(row.class_meta)) : '{}';

      insert.run(
        parseInt(row.id),
        normText(row.external_id),
        row.title || '',
        row.short_title || '',
        row.tagline || '',
        row.description || '',
        normText(row.description_source),
        getSourceUrl(row),
        getImageUrl(row),
        row.venue_name || '',
        row.subway || '',
        row.address || '',
        row.city || '',
        normText(row.city_district),
        normText(row.city_locality),
        normText(row.country_county),
        lat,
        lon,
        normText(row.timezone),
        scheduleJson,
        occurrencesJson,
        normInt(row.schedule_confidence),
        normText(row.schedule_source),
        row.next_start_at || '',
        nextEndAt,
        ageMin,
        row.age_label || '',
        ageBestFrom,
        ageBestTo,
        isFreeFlag,
        row.price_summary || '',
        priceMin,
        priceMax,
        categoryL1,
        normText(row.category_l2),
        normText(row.category_l3),
        categoriesJson,
        tagsJson,
        normText(row.format),
        normText(row.motivation),
        classMetaJson,
        JSON.stringify(parseReviews(row.reviews || '')),
        JSON.stringify(parsePythonDict(row.derisk || '')),
        row.rating_avg ? parseFloat(row.rating_avg) : 0,
        row.rating_count ? parseInt(row.rating_count) : 0,
        row.favorites_count ? parseInt(row.favorites_count) : 0,
        row.comments_count ? parseInt(row.comments_count) : 0,
        JSON.stringify(parsePythonDict(row.data || '')),
        row.status || 'published',
        toFlag(row.disabled),
        toFlag(row.archived),
        row.created_at || '',
        row.updated_at || ''
      );
      imported++;
    } catch (e) {
      console.error(`Error importing row ${row.id}: ${(e as Error).message}`);
      skipped++;
    }
  }
});

insertMany(records);

console.log(`\nImported: ${imported}, Skipped: ${skipped}`);
console.log(`Database: ${dbPath}`);

// Verify
const count = db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
console.log(`Total events in DB: ${count.count}`);

const withCoords = db.prepare('SELECT COUNT(*) as count FROM events WHERE lat IS NOT NULL AND lon IS NOT NULL').get() as { count: number };
console.log(`Events with coordinates: ${withCoords.count}`);

const categories = db.prepare("SELECT DISTINCT category_l1 FROM events WHERE category_l1 != '' ORDER BY category_l1").all();
console.log(`Categories: ${categories.map((c: any) => c.category_l1).join(', ')}`);

console.log(`\n=== Normalization applied ===`);
console.log(`  BUG_005 ages clamped to [0,18]:        ${norm.age_clamped} rows`);
console.log(`  BUG_006 free/price reconciled:         ${norm.free_price_reconciled} rows`);
console.log(`  BUG_004 empty next_end_at -> NULL:     ${norm.end_date_nullified} rows`);
console.log(`  BUG_003 category_l1 derived:           ${norm.category_derived} rows`);
console.log(`  BUG_007 missing lat/lon (monitoring):  ${norm.missing_geo} rows`);
console.log(`  BUG_008 past events skipped:           ${norm.past_events_skipped} rows`);
console.log(`         non-Moscow events skipped:      ${norm.outside_moscow_skipped} rows`);

db.close();
