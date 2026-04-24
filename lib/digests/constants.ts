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

/** District labels (kept empty — city_district is not populated in the RU DB,
 *  so this map is intentionally blank. Geo signal relies on bbox + city name). */
export const CITY_DISTRICT_MAP: Record<string, string> = {};

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

/** Central district bbox (ЦАО) — for "центр города" bonus. */
export const CENTER_BBOX = {
  latMin: 55.720, latMax: 55.785,
  lonMin: 37.555, lonMax: 37.685,
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
