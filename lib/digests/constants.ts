/**
 * Taxonomies and keyword sets used by digest signal extraction.
 *
 * These are tuned to the actual data in our events.db (audited on 2026-04-21
 * against 207 live events). If the data shape changes significantly, re-audit
 * with `scripts/digests-audit.ts` and adjust.
 */

// ─── Live-event SQL filter ────────────────────────────────────────────────────
// Must stay in sync with the pattern used in `lib/db.ts` and
// `app/api/events/personalized/route.ts`.
export const LIVE_STATUS_FILTER = `(status IN ('published', 'done', 'new') OR status LIKE '%.done')`;

// ─── Moscow geo ───────────────────────────────────────────────────────────────

/** Accept Moscow name variants (lower-cased, trimmed). */
export const CITY_NAMES = new Set([
  'москва',
  'moscow',
]);

/** Greater Moscow bbox — generous to catch near-city venues. */
export const CITY_BBOX = {
  latMin: 55.49, latMax: 55.97,
  lonMin: 37.29, lonMax: 37.97,
};

export interface DistrictBounds {
  name: string;        // short tag (ЦАО, САО, …)
  fullName: string;    // human-readable
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  /** weight used by digest scoring — higher = more central/desirable */
  weight: number;
}

/**
 * 9 административных округов Москвы + их приблизительные bbox.
 * `weight` подбирается под задачу "куда пойти с ребёнком":
 *   - ЦАО = 1.0 (максимум культурных мест, театров, музеев)
 *   - "ближний пояс" (САО, СВАО, СЗАО, ЗАО, ЮЗАО) = 0.7 (хорошая доступность)
 *   - "дальний пояс" (ВАО, ЮАО, ЮВАО) = 0.55
 * Совпадают с bbox в `lib/db.ts::NEIGHBORHOOD_BOUNDS` (единый источник истины).
 */
export const MOSCOW_DISTRICTS: DistrictBounds[] = [
  { name: 'ЦАО',  fullName: 'Центральный',      latMin: 55.720, latMax: 55.785, lonMin: 37.555, lonMax: 37.685, weight: 1.00 },
  { name: 'САО',  fullName: 'Северный',         latMin: 55.780, latMax: 55.900, lonMin: 37.390, lonMax: 37.660, weight: 0.70 },
  { name: 'СВАО', fullName: 'Северо-Восточный', latMin: 55.800, latMax: 55.930, lonMin: 37.620, lonMax: 37.870, weight: 0.70 },
  { name: 'СЗАО', fullName: 'Северо-Западный',  latMin: 55.790, latMax: 55.900, lonMin: 37.310, lonMax: 37.540, weight: 0.70 },
  { name: 'ЗАО',  fullName: 'Западный',         latMin: 55.700, latMax: 55.840, lonMin: 37.290, lonMax: 37.565, weight: 0.70 },
  { name: 'ЮЗАО', fullName: 'Юго-Западный',     latMin: 55.600, latMax: 55.740, lonMin: 37.390, lonMax: 37.600, weight: 0.70 },
  { name: 'ВАО',  fullName: 'Восточный',        latMin: 55.700, latMax: 55.850, lonMin: 37.720, lonMax: 37.960, weight: 0.55 },
  { name: 'ЮАО',  fullName: 'Южный',            latMin: 55.575, latMax: 55.700, lonMin: 37.560, lonMax: 37.760, weight: 0.55 },
  { name: 'ЮВАО', fullName: 'Юго-Восточный',    latMin: 55.610, latMax: 55.720, lonMin: 37.680, lonMax: 37.900, weight: 0.55 },
];

/** Fast lookup by district name. */
export const DISTRICT_BY_NAME: Record<string, DistrictBounds> = Object.fromEntries(
  MOSCOW_DISTRICTS.map((d) => [d.name, d]),
);

/** Backward compat — CENTER_BBOX still used by older callers. */
export const CENTER_BBOX = {
  latMin: MOSCOW_DISTRICTS[0].latMin,
  latMax: MOSCOW_DISTRICTS[0].latMax,
  lonMin: MOSCOW_DISTRICTS[0].lonMin,
  lonMax: MOSCOW_DISTRICTS[0].lonMax,
};

// ─── Format taxonomy (from data, 94% live coverage) ───────────────────────────
// Token values observed in live events (sorted by frequency):
//   workshop (78), kids-playgroup (71), live-performance (64), guided-walk (33),
//   class (25), museum-visit (23), meetup (19), community-service (18),
//   sports-event (17), festival (16), concert (16), theater-show (15),
//   tour (14), exhibition (13), competition (10), talk (9), party (7),
//   fair (5), open-day (5), market (5), training-session (4), screening (4),
//   networking-event (4), hike (2), lecture (2), conference (2),
//   online-event (1), club-night (1), camp (1).

/** format tokens that are unambiguously INDOOR. */
export const INDOOR_FORMATS = new Set([
  'workshop', 'class', 'museum-visit', 'theater-show',
  'exhibition', 'screening', 'lecture', 'talk',
  'conference', 'training-session', 'online-event',
]);

/** format tokens that are unambiguously OUTDOOR. */
export const OUTDOOR_FORMATS = new Set([
  'guided-walk', 'hike', 'fair', 'market', 'festival',
]);

/** format tokens that are mixed/ambiguous — signal, but weight lower. */
export const MIXED_FORMATS = new Set([
  'kids-playgroup', 'live-performance', 'concert', 'tour',
  'sports-event', 'competition', 'party', 'camp', 'open-day',
]);

/** format tokens that suggest a decidedly adult audience — used as a demerit. */
export const ADULT_FORMATS = new Set([
  'club-night', 'networking-event', 'conference',
]);

/** format tokens associated with "easy plan" (drop-in, predictable, recurring). */
export const EASY_FORMATS = new Set([
  'museum-visit', 'exhibition', 'kids-playgroup', 'open-day',
]);

// ─── Motivation taxonomy (from data, 94% live coverage) ───────────────────────
// Observed tokens (sorted by freq):
//   bond (147), learn (115), play (103), be-entertained (40), explore (30),
//   socialize (25), support-community (23), create (22), celebrate (19),
//   improve-health (18), be-inspired (13), relax (11), compete (4),
//   dance-party (3), discover-tech (2).

/** Motivations that strongly indicate family-oriented events. */
export const FAMILY_MOTIVATIONS = new Set([
  'bond', 'play', 'learn', 'celebrate',
]);

/** Motivations that indicate rich, engaging, "worth-it" experiences. */
export const WORTH_IT_MOTIVATIONS = new Set([
  'create', 'be-inspired', 'explore', 'discover-tech', 'learn', 'play',
]);

// ─── Indoor / outdoor text fallback (for the ~6% missing `format`) ───────────
export const INDOOR_KEYWORDS = [
  // English (kept for mixed content)
  'museum', 'library', 'theater', 'theatre', 'gallery', 'exhibition',
  'indoor', 'workshop', 'studio', 'lecture', 'screening',
  // Russian
  'музей', 'библиотек', 'театр', 'галере', 'выставк',
  'мастер-класс', 'мастеркласс', 'студи', 'лекци', 'кинотеатр',
  'филармони', 'концертн', 'опера', 'планетари', 'аквариум',
  'закрыт', 'в помещени', 'в здани',
];

export const OUTDOOR_KEYWORDS = [
  'park', 'outdoor', 'garden', 'playground', 'picnic',
  // Russian
  'парк', 'улиц', 'на открытом', 'под открытым небом',
  'прогулк', 'экскурси', 'набережн', 'сад ', 'сквер',
  'пешеходн', 'на свежем',
];

export const INDOOR_VENUE_TYPES = new Set([
  'museum', 'library', 'theater', 'theatre', 'gallery',
  'art center', 'arts center', 'indoor', 'opera', 'concert hall',
  'cinema', 'playroom', 'bookstore', 'science center',
  'planetarium', 'aquarium', 'studio',
  // Russian
  'музей', 'библиотека', 'театр', 'галерея', 'кинотеатр',
  'концертный зал', 'планетарий', 'студия',
]);

// ─── Family / kids text signals (fallback when motivation is missing) ─────────
export const FAMILY_KEYWORDS = [
  'kids', 'children', 'family', 'toddler', 'teen', 'preschool', 'child',
  // Russian
  'дети', 'ребёнок', 'ребенок', 'детск', 'семейн', 'для детей',
  'малыш', 'дошкольн', 'подростк', '0+', '3+', '6+', '12+',
];

export const ADULT_ONLY_MARKERS = [
  '21+', '18+', 'adults only',
  // Russian
  'только для взрослых', 'строго 18+', 'строго 21+',
];

// ─── Easy-plan text signals ───────────────────────────────────────────────────
export const EASY_POSITIVE = [
  'drop-in', 'no rsvp', 'no registration', 'free admission', 'walk-in',
  // Russian
  'без регистрации', 'без предварительной', 'свободный вход',
  'бесплатный вход', 'вход свободный',
];

export const EASY_NEGATIVE = [
  'sold out', 'registration required', 'rsvp required', 'must register',
  // Russian
  'по предварительной записи', 'обязательная регистрация',
  'мест нет', 'продано', 'необходима регистрация',
  'требуется регистрация', 'по записи',
];

// ─── Affordability / price text signals ───────────────────────────────────────
export const AFFORDABLE_TEXT = [
  'free', 'free admission', 'donation', 'low-cost',
  // Russian
  'бесплатно', 'бесплатн', 'свободный вход', 'по донат',
  'пожертвован', 'недорог',
];

export const EXPENSIVE_MARKERS = [
  'premium', 'vip', 'luxury', 'black tie',
  // Russian
  'премиум', 'вип', 'люкс',
];

// ─── Quality / engagement text signals ────────────────────────────────────────
export const ENGAGEMENT_KEYWORDS = [
  'hands-on', 'interactive', 'workshop', 'live music', 'participatory',
  'discover', 'explore', 'create',
  // Russian
  'интерактив', 'мастер-класс', 'живая музык', 'живое выступл',
  'своими руками', 'создать', 'попробовать', 'эксперимент',
  'иммерсив', 'вовлека',
];

export const LOW_QUALITY_MARKERS = [
  'placeholder', 'tbd', 'tba',
  // Russian
  'уточняется', 'скоро', 'будет объявлено', 'в процессе',
];

// ─── Thresholds ───────────────────────────────────────────────────────────────
export const THRESHOLDS = {
  /** Any event with final score below this is NEVER included (even as fallback). */
  ABSOLUTE_FLOOR: 20,

  /** Weekend: lookahead window in days for upcoming Sat/Sun. */
  WEEKEND_WINDOW_DAYS: 14,
  WEEKEND_FALLBACK_DAYS: 28,

  /** Affordable tiers. */
  AFFORDABLE_CEILING: 30,
  AFFORDABLE_HARD_CEILING: 75,

  /** Worth-it quality gates. */
  WORTH_IT_RATING_MIN: 4.3,
  WORTH_IT_RATING_COUNT_MIN: 5,
};
