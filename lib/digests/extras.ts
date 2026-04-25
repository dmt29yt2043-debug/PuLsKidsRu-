/**
 * The "extras" — 15 additional dynamic digests beyond the 5 hand-crafted
 * pipelines (weekend/indoor/easy/budget/popular). These share one factory
 * helper `buildDigest()` to avoid duplicating the scaffolding 15×.
 *
 * Each digest is a { meta, gate, score } triplet:
 *   - `gate(ev)`: hard filter — skip this event entirely if false
 *   - `score(ev)`: numeric score + reasons for the top-N picker
 *
 * Base score (Moscow + district + completeness, ~0–50) is added by
 * `baseGeoAndCompleteness()` and shared by every digest so rankings are
 * consistent across the shelf.
 */

import type { EnrichedEvent, DigestResult, ScoredEvent, DigestMeta, EventRow } from './types';
import { THRESHOLDS, ENGAGEMENT_KEYWORDS } from './constants';
import {
  classifyFamily, classifyIndoor, classifyEasy, classifyWeekend,
  classifyCity,
} from './signals';
import { baseGeoAndCompleteness, dedupe, pickWithFallback } from './scoring-helpers';
import { matchedKeywords, countKeywordHits } from './event-parser';

// ─── Shared factory ──────────────────────────────────────────────────────────

interface DigestConfig {
  meta: Omit<DigestMeta, 'cover_image' | 'event_count'>;
  /** Hard filter — skip event if returns false. */
  gate: (ev: EnrichedEvent) => boolean;
  /** Returns score + reasons (base score is added separately). */
  score: (ev: EnrichedEvent) => { score: number; reasons: string[] };
  /** How many events to aim for. Default 10. */
  target?: number;
  /** Thresholds for the fallback picker. */
  strongFloor?: number;
  weakFloor?: number;
}

function buildDigest(events: EnrichedEvent[], config: DigestConfig): DigestResult {
  const { meta: metaTpl, gate, score: scoreFn, target = 10, strongFloor = 55, weakFloor = 35 } = config;

  const scored: ScoredEvent[] = [];
  for (const ev of events) {
    if (!gate(ev)) continue;
    const base = baseGeoAndCompleteness(ev);
    const extra = scoreFn(ev);
    scored.push({
      event: ev,
      score: base.score + extra.score,
      reasons: [...base.reasons, ...extra.reasons],
    });
  }

  const deduped = dedupe(scored);
  const { picks, strong, weak, skipped } = pickWithFallback(deduped, {
    target,
    strongFloor,
    weakFloor,
    absoluteFloor: THRESHOLDS.ABSOLUTE_FLOOR,
  });

  const meta: DigestMeta = {
    ...metaTpl,
    cover_image: picks[0]?.event.image_url ?? null,
    event_count: picks.length,
  };
  return {
    meta,
    events: picks.map((s) => s.event) as EventRow[],
    coverage: { strong_candidates: strong, weak_candidates: weak, skipped_low_quality: skipped, notes: [] },
    scored: picks,
  };
}

// ─── Shared helpers used by several digests ──────────────────────────────────

function baseMeta(
  id: number, slug: string, title: string, subtitle: string, tag: string, contextTags: string[],
): Omit<DigestMeta, 'cover_image' | 'event_count'> {
  return {
    id, slug, title, subtitle,
    category: 'Подборки редакции',
    category_tag: tag,
    curator_name: 'Pulse',
    curator_role: 'Подборка от PulseUp',
    context_tags: JSON.stringify(contextTags),
  };
}

/** Parse how many distinct dates this event has in its schedule JSON. */
function scheduleDates(ev: EnrichedEvent): number {
  try {
    const s = JSON.parse(ev.schedule);
    if (s && Array.isArray(s.items)) {
      const set = new Set<string>();
      for (const it of s.items) if (it && typeof it.date === 'string') set.add(it.date);
      return set.size;
    }
  } catch { /* noop */ }
  return 0;
}

/** Returns Date object for ev.next_start_at in Moscow timezone, or null. */
function mskDate(iso: string | null | undefined): { date: Date; dow: number; hour: number } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // Moscow is UTC+3, so add 3h manually.
  const msk = new Date(ms + 3 * 60 * 60 * 1000);
  return { date: d, dow: msk.getUTCDay(), hour: msk.getUTCHours() };
}

/** Age-label match: event is "appropriate for" the given childAge. */
function ageFits(ev: EnrichedEvent, minAge: number, maxAge: number): boolean {
  const label = (ev.age_label ?? '').trim();
  if (!label || label === '0') return true;                         // no restriction
  const m = label.match(/^(\d+)\+$/);
  if (m) {
    const lo = Number(m[1]);
    return lo <= maxAge;                                            // "12+" fits a teen
  }
  const m2 = label.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m2) {
    const lo = Number(m2[1]), hi = Number(m2[2]);
    return !(hi < minAge || lo > maxAge);
  }
  return true; // unknown shape — allow
}

const ADULT_AGE_LABELS = new Set(['18+']);
const TEEN_PLUS_LABELS = new Set(['16+', '18+']);

/** Strict 18+ / nightlife filter — used by digests that explicitly target
 *  teens or accept the 12-17 range (e.g. /teens). */
function isAdultOnly(ev: EnrichedEvent): boolean {
  return ADULT_AGE_LABELS.has((ev.age_label ?? '').trim())
    || (ev.category_l1 === 'nightlife');
}

/** Family-appropriate filter — also rejects 16+ events. Use in digests
 *  whose audience is parents with kids 12 and under (tonight, weekend,
 *  workshops, etc.). The /teens digest deliberately uses isAdultOnly so it
 *  CAN include 16+ events. */
function isNotFamilyAppropriate(ev: EnrichedEvent): boolean {
  return TEEN_PLUS_LABELS.has((ev.age_label ?? '').trim())
    || (ev.category_l1 === 'nightlife');
}

// ─── Digest definitions ──────────────────────────────────────────────────────

// 1. Сегодня вечером
export function getTonightDigest(events: EnrichedEvent[]): DigestResult {
  const now = Date.now();
  const todayStr = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  return buildDigest(events, {
    meta: baseMeta(201, 'tonight', 'Что сегодня вечером',
      'Успеть выйти сегодня — планы без лишнего.', 'СЕГОДНЯ',
      ['today', 'evening', 'quick-plan']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      const t = mskDate(ev.next_start_at);
      if (!t) return false;
      if (ev.next_start_at?.slice(0, 10) !== todayStr) return false;
      return t.hour >= 17 && t.hour <= 23;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 30;                                                   // time-fit bonus
      reasons.push('сегодня вечером (+30)');
      if (ev.subway && ev.subway.trim().length > 0) {
        s += 10;
        reasons.push('рядом с метро (+10)');
      }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 15);
      return { score: s, reasons };
    },
    strongFloor: 60, weakFloor: 40,
  });
}

// 2. На завтра
export function getTomorrowDigest(events: EnrichedEvent[]): DigestResult {
  const tomorrow = new Date(Date.now() + 24 * 3600_000 + 3 * 3600_000).toISOString().slice(0, 10);
  return buildDigest(events, {
    meta: baseMeta(202, 'tomorrow', 'На завтра',
      'Планируем сегодня — идём завтра.', 'ЗАВТРА',
      ['tomorrow', 'planning']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      return ev.next_start_at?.slice(0, 10) === tomorrow;
    },
    score: (ev) => {
      const fam = classifyFamily(ev);
      return {
        score: 25 + Math.round(fam.confidence * 25),
        reasons: ['завтра (+25)', ...(fam.confidence > 0.3 ? ['семейное'] : [])],
      };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 3. Спокойное воскресенье
export function getSundayChillDigest(events: EnrichedEvent[]): DigestResult {
  const CHILL = new Set(['museum-visit', 'exhibition', 'guided-walk', 'tour', 'lecture', 'screening']);
  return buildDigest(events, {
    meta: baseMeta(203, 'sunday-chill', 'Спокойное воскресенье',
      'Без беготни и громких звуков — просто побыть вместе.', 'СПОКОЙНО',
      ['sunday', 'chill', 'family']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      if (ev.category_l1 === 'nightlife') return false;
      const t = mskDate(ev.next_start_at);
      if (!t) return false;
      if (t.dow !== 0) return false;                                // Sunday only
      if (!ev.formatParsed.some((f) => CHILL.has(f))) return false;
      return true;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      reasons.push('воскресенье (+20)');
      const chillCount = ev.formatParsed.filter((f) => CHILL.has(f)).length;
      s += chillCount * 8;
      if (chillCount > 0) reasons.push(`тихий формат ×${chillCount}`);
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 15);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 4. После работы в будни
export function getAfterWorkDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(204, 'after-work', 'После работы',
      'Вечер буднего дня — рядом с метро и недолго.', 'ПОСЛЕ РАБОТЫ',
      ['weekday', 'evening', 'after-work']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      const t = mskDate(ev.next_start_at);
      if (!t) return false;
      if (t.dow === 0 || t.dow === 6) return false;                 // weekdays only
      return t.hour >= 18 && t.hour <= 21;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 25;
      reasons.push('будний вечер (+25)');
      if (ev.subway && ev.subway.trim().length > 0) { s += 12; reasons.push('метро рядом'); }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 12);
      return { score: s, reasons };
    },
    strongFloor: 60, weakFloor: 40,
  });
}

// 5. Для малышей 0-3
export function getTinyKidsDigest(events: EnrichedEvent[]): DigestResult {
  const QUIET = new Set(['workshop', 'kids-playgroup', 'exhibition', 'museum-visit', 'theater-show']);
  const NOISY = new Set(['concert', 'party', 'club-night', 'sports-event']);
  return buildDigest(events, {
    meta: baseMeta(205, 'tiny-kids', 'Для малышей (0–3)',
      'Тихо, коляска проходит, без громких звуков.', 'МАЛЫШИ',
      ['0-3', 'toddler', 'stroller']),
    gate: (ev) => {
      if (ev.age_label !== '0') return false;                       // "0" = no age restriction, treat as all-ages family-safe
      if (ev.formatParsed.some((f) => NOISY.has(f))) return false;
      if (ev.category_l1 === 'nightlife') return false;
      return true;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 15;
      const quietCount = ev.formatParsed.filter((f) => QUIET.has(f)).length;
      s += quietCount * 10;
      if (quietCount > 0) reasons.push(`спокойный формат ×${quietCount}`);
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 20);
      // Strollercheck
      const stroller = ev.dataParsed.venue_stroller_friendly;
      if (stroller === true) { s += 10; reasons.push('с коляской (+10)'); }
      return { score: s, reasons };
    },
    strongFloor: 50, weakFloor: 30,
  });
}

// 6. Для дошкольников 4-6
export function getPreschoolDigest(events: EnrichedEvent[]): DigestResult {
  const KID_FORMATS = new Set(['workshop', 'kids-playgroup', 'theater-show', 'exhibition', 'museum-visit', 'screening']);
  return buildDigest(events, {
    meta: baseMeta(206, 'preschool', 'Для дошкольников (4–6)',
      'Интересно, но с учётом короткого внимания.', 'ДОШКОЛЬНИКИ',
      ['4-6', 'preschool']),
    gate: (ev) => {
      if (!['0', '6+'].includes((ev.age_label ?? '').trim())) return false;
      if (ev.category_l1 === 'nightlife') return false;
      return true;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 10;
      if (ev.age_label === '6+') { s += 10; reasons.push('6+ целевой'); }
      const goodFormat = ev.formatParsed.filter((f) => KID_FORMATS.has(f)).length;
      s += goodFormat * 8;
      if (goodFormat > 0) reasons.push(`детский формат ×${goodFormat}`);
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 20);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 7. Для подростков 12+
export function getTeensDigest(events: EnrichedEvent[]): DigestResult {
  const TEEN_CATS = new Set(['education', 'arts', 'film', 'music', 'theater']);
  return buildDigest(events, {
    meta: baseMeta(207, 'teens', 'Для подростков (12+)',
      'Уже не детское, но ещё не 18+.', 'ПОДРОСТКИ',
      ['12+', 'teens']),
    gate: (ev) => {
      if (!['12+', '16+'].includes((ev.age_label ?? '').trim())) return false;
      if (ev.category_l1 === 'nightlife') return false;
      return true;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 15;
      if (TEEN_CATS.has(ev.category_l1 ?? '')) { s += 15; reasons.push(`${ev.category_l1}`); }
      if (ev.age_label === '12+') { s += 8; reasons.push('12+ целевой'); }
      // Engagement keywords — teens value interactive
      const eng = countKeywordHits(ev.textBlob, ENGAGEMENT_KEYWORDS);
      if (eng > 0) { s += Math.min(12, eng * 4); reasons.push(`вовлечение ×${eng}`); }
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 8. Театр и спектакли
export function getTheaterDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(208, 'theater', 'Театр и спектакли',
      'Лучшие театральные выходы для всей семьи.', 'ТЕАТР',
      ['theater', 'show']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      const isTheater = ev.category_l1 === 'theater' || ev.formatParsed.includes('theater-show');
      if (!isTheater) return false;
      return ['0', '6+', '12+'].includes((ev.age_label ?? '').trim());
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      reasons.push('театр (+20)');
      // Bonus for concrete kid-friendly age
      if (['0', '6+'].includes(ev.age_label ?? '')) { s += 10; reasons.push('для детей'); }
      // Schedule depth: a theater with many dates = reliably running
      const dates = scheduleDates(ev);
      if (dates >= 4) { s += 10; reasons.push(`${dates} дат`); }
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35, target: 12,
  });
}

// 9. Музыкальные впечатления
export function getMusicDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(209, 'music', 'Музыкальные впечатления',
      'Концерты, оперы, живая музыка — приобщаем к звуку.', 'МУЗЫКА',
      ['music', 'concert']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      // 'live-performance' is too generic — it tags both theater-shows AND
      // concerts, so including it pulls all kid theater into the music
      // shelf. Use category_l1='music' (authoritative) or explicit
      // 'concert' format instead. Theater-show is excluded.
      if (ev.formatParsed.includes('theater-show')) return false;
      const isMusic =
        ev.category_l1 === 'music'
        || ev.formatParsed.includes('concert')
        || ev.categoriesParsed.includes('concert')
        || ev.categoriesParsed.includes('music');
      if (!isMusic) return false;
      return !['18+'].includes((ev.age_label ?? '').trim());
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      reasons.push('музыка (+20)');
      if (['0', '6+', '12+'].includes(ev.age_label ?? '')) { s += 10; reasons.push('для детей/подростков'); }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 10);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 10. Мастер-классы и творчество
export function getWorkshopsDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(210, 'workshops', 'Мастер-классы',
      'Своими руками — лепка, керамика, рисование, эксперименты.', 'МАСТЕР-КЛАССЫ',
      ['workshop', 'hands-on']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      return ev.formatParsed.some((f) => f === 'workshop' || f === 'class')
        || ev.motivationParsed.includes('create');
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      reasons.push('мастер-класс (+20)');
      if (ev.motivationParsed.includes('create')) { s += 10; reasons.push('create'); }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 15);
      const eng = countKeywordHits(ev.textBlob, ENGAGEMENT_KEYWORDS);
      if (eng > 0) s += Math.min(10, eng * 3);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 11. Музеи и выставки
export function getMuseumsDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(211, 'museums', 'Музеи и выставки',
      'Полезное время — познавательные экспозиции в Москве.', 'МУЗЕИ',
      ['museum', 'exhibition', 'educational']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      return ev.formatParsed.some((f) => f === 'museum-visit' || f === 'exhibition')
        || /музе|выставк|галере/i.test(ev.textBlob);
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      reasons.push('музей/выставка (+20)');
      const dates = scheduleDates(ev);
      if (dates >= 10) { s += 15; reasons.push(`${dates} дат`); }
      else if (dates >= 4) { s += 8; }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 12);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 12. Экскурсии по Москве
export function getToursDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(212, 'tours', 'Экскурсии по Москве',
      'Открываем город — пешком, с рассказом, с историей.', 'ЭКСКУРСИИ',
      ['tour', 'walk', 'history']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      return ev.formatParsed.some((f) => f === 'guided-walk' || f === 'tour');
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 25;
      reasons.push('экскурсия (+25)');
      if (ev.formatParsed.includes('guided-walk')) { s += 8; reasons.push('пешеходная'); }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 15);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35,
  });
}

// 13. Кино для семьи
export function getCinemaDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(213, 'cinema', 'Кино для семьи',
      'Просмотры с попкорном — семейный релакс.', 'КИНО',
      ['film', 'screening']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      return ev.category_l1 === 'film'
        || ev.formatParsed.includes('screening');
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 25;
      reasons.push('кино (+25)');
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 15);
      return { score: s, reasons };
    },
    strongFloor: 50, weakFloor: 30,
  });
}

// 14. Рядом с метро
export function getNearMetroDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(214, 'near-metro', 'Рядом с метро',
      'Без машины, без пересадок — прямо от станции.', 'МЕТРО',
      ['transit', 'metro', 'easy-to-reach']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      const s = (ev.subway ?? '').trim();
      return s.length > 0 && s.toLowerCase() !== 'n/a';
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 15;
      reasons.push('метро рядом');
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 20);
      // Short commute signal: if subway field has only 1-2 stations = close to center
      const stations = (ev.subway ?? '').split(/[,;]/).filter((x) => x.trim().length > 0);
      if (stations.length >= 1 && stations.length <= 2) { s += 5; reasons.push('у одной станции'); }
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35, target: 12,
  });
}

// 15. Необычное и редкое
const RARE_KEYWORDS = [
  'премьера', 'единственн', 'уникальн', 'впервые', 'редк',
  'эксклюзив', 'только один раз',
  'premiere', 'unique', 'exclusive', 'first time',
];

export function getRareDigest(events: EnrichedEvent[]): DigestResult {
  return buildDigest(events, {
    meta: baseMeta(215, 'rare', 'Необычное и редкое',
      'Единичные даты, премьеры — успеть до конца сезона.', 'РЕДКОЕ',
      ['rare', 'premiere', 'fomo']),
    gate: (ev) => {
      if (isNotFamilyAppropriate(ev)) return false;
      const dates = scheduleDates(ev);
      // Rare = few dates (but not zero — zero usually means no schedule at all)
      if (dates > 0 && dates > 3) return false;
      // Must have rare-signal keyword OR be a one-off non-free event
      const hasRareKw = countKeywordHits(ev.textBlob, RARE_KEYWORDS) > 0;
      if (!hasRareKw && dates !== 1) return false;
      return true;
    },
    score: (ev) => {
      const reasons: string[] = [];
      let s = 20;
      const kw = matchedKeywords(ev.textBlob, RARE_KEYWORDS);
      if (kw.length > 0) { s += 20; reasons.push(`редкое: ${kw.slice(0, 2).join(', ')}`); }
      const dates = scheduleDates(ev);
      if (dates === 1) { s += 10; reasons.push('только одна дата'); }
      const fam = classifyFamily(ev);
      s += Math.round(fam.confidence * 12);
      return { score: s, reasons };
    },
    strongFloor: 55, weakFloor: 35, target: 10,
  });
}

// ─── Aggregate: run all extras ───────────────────────────────────────────────

/** All 15 extra digest runners, in display order. */
export const EXTRA_DIGEST_RUNNERS: Array<(events: EnrichedEvent[]) => DigestResult> = [
  getTonightDigest,
  getTomorrowDigest,
  getSundayChillDigest,
  getAfterWorkDigest,
  getTinyKidsDigest,
  getPreschoolDigest,
  getTeensDigest,
  getTheaterDigest,
  getMusicDigest,
  getWorkshopsDigest,
  getMuseumsDigest,
  getToursDigest,
  getCinemaDigest,
  getNearMetroDigest,
  getRareDigest,
];
