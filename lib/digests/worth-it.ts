/**
 * Digest 5 — "10 впечатлений, которые запомнятся детям".
 *
 * The NYC version of this digest was built around user reviews + rating_avg +
 * rating_count. The RU dataset has NONE of those fields populated (0 events
 * with reviews or ratings), so we can't use "social proof" signals.
 *
 * Instead we score on what IS actually there for Moscow events:
 *   1. Schedule depth — how many distinct dates the event has scheduled.
 *      A one-off concert and a 30-date exhibition differ hugely in "commitment
 *      level" from the organiser. Recurring events = proven / stable.
 *   2. Description richness — longer, hand-written descriptions mean curators
 *      or organisers invested in it. Thin stubs tend to be placeholder events.
 *   3. Family signal — motivation/format/keyword match.
 *   4. Engagement keywords — "интерактив", "мастер-класс", "своими руками"
 *      etc. indicate hands-on experience, not passive viewing.
 *   5. "Derisk" block — we only generate it for events with enough context;
 *      its presence is a decent quality proxy.
 *   6. Base geo + completeness (same as other digests).
 *
 * Hard gate: event must pass a soft family filter (confidence ≥ 0.2) — a
 * karaoke-bar meetup might have many dates and rich description but it's not
 * what a parent wants to see here.
 */

import type { EnrichedEvent, DigestResult, ScoredEvent, DigestMeta, EventRow } from './types';
import { THRESHOLDS, ENGAGEMENT_KEYWORDS } from './constants';
import { classifyFamily } from './signals';
import { baseGeoAndCompleteness, dedupe, pickWithFallback } from './scoring-helpers';
import { matchedKeywords } from './event-parser';

const SLUG = 'popular';

const META: Omit<DigestMeta, 'cover_image' | 'event_count'> = {
  id: 105,
  slug: SLUG,
  title: '10 впечатлений, которые запомнятся детям',
  subtitle: 'Весело детям и не мучительно родителям — стоит времени.',
  category: 'Подборки редакции',
  category_tag: 'ПОПУЛЯРНОЕ',
  curator_name: 'Pulse',
  curator_role: 'Подборка от PulseUp',
  context_tags: JSON.stringify(['popular', 'worth-it', 'family']),
};

/** Count distinct dates in the `schedule` JSON blob. Handles both shapes we see. */
function countScheduleDates(rawSchedule: string | null | undefined): number {
  if (!rawSchedule) return 0;
  try {
    const parsed = JSON.parse(rawSchedule);
    if (parsed && Array.isArray(parsed.items)) {
      const dates = new Set<string>();
      for (const it of parsed.items) {
        if (it && typeof it === 'object' && typeof it.date === 'string') dates.add(it.date);
      }
      return dates.size;
    }
    // Alt shape: top-level array of occurrences.
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* malformed — treat as 0 */
  }
  return 0;
}

/** Derisk field is a JSON object with curator-generated quality notes. */
function hasDerisk(ev: EnrichedEvent): boolean {
  const raw = (ev as EnrichedEvent & { derisk?: string }).derisk;
  if (!raw || typeof raw !== 'string') return false;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return false;
    // Non-trivial derisk = at least 2 populated string fields.
    let populated = 0;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.trim().length > 20) populated++;
    }
    return populated >= 2;
  } catch {
    return false;
  }
}

export function scoreWorthIt(ev: EnrichedEvent): ScoredEvent | null {
  // Soft family gate — filters out adult-only events.
  const fam = classifyFamily(ev);
  if (fam.confidence < 0.2) return null;

  const reasons: string[] = [];
  let score = 0;

  // Base — Moscow + district + completeness (0..50)
  const base = baseGeoAndCompleteness(ev);
  score += base.score;
  reasons.push(...base.reasons);

  // Schedule depth — # of distinct dates.
  //   1 date     = one-off, 0 pts
  //   2-3 dates  = short run, +5
  //   4-9 dates  = weekly series, +12
  //   10-19      = monthly / ongoing, +20
  //   20+        = exhibition / recurring fixture, +25
  const dates = countScheduleDates(ev.schedule);
  let datePts = 0;
  if (dates >= 20) datePts = 25;
  else if (dates >= 10) datePts = 20;
  else if (dates >= 4) datePts = 12;
  else if (dates >= 2) datePts = 5;
  if (datePts > 0) {
    score += datePts;
    reasons.push(`расписание ×${dates} (+${datePts})`);
  }

  // Description richness (proxy for curation effort)
  const descLen = (ev.description ?? '').length;
  if (descLen >= 800)      { score += 10; reasons.push(`богатое описание (10)`); }
  else if (descLen >= 400) { score += 6;  reasons.push(`описание (6)`); }
  else if (descLen >= 150) { score += 3; }

  // Family signal — already passed the gate, but weight it in properly.
  const famPts = Math.round(fam.confidence * 18);
  score += famPts;
  if (famPts >= 10) reasons.push(`семейное (${famPts})`);

  // Engagement — hands-on signals (both RU + EN keywords).
  const eng = matchedKeywords(ev.textBlob, ENGAGEMENT_KEYWORDS);
  const engPts = Math.min(15, eng.length * 4);
  if (engPts > 0) {
    score += engPts;
    reasons.push(`вовлечение ×${eng.length} (+${engPts})`);
  }

  // Derisk block = curator thought about the event enough to write quality notes.
  if (hasDerisk(ev)) {
    score += 8;
    reasons.push('derisk-заметки (+8)');
  }

  return { event: ev, score, reasons };
}

export function getWorthItDigest(events: EnrichedEvent[]): DigestResult {
  const notes: string[] = [];

  const scored = events
    .map(scoreWorthIt)
    .filter((s): s is ScoredEvent => s !== null);

  const deduped = dedupe(scored);
  const { picks, strong, weak, skipped } = pickWithFallback(deduped, {
    target: 10,
    strongFloor: 65,
    weakFloor: 40,
    absoluteFloor: THRESHOLDS.ABSOLUTE_FLOOR,
  });

  if (strong < 5) notes.push(`Only ${strong} strong candidates — fallback tier used.`);
  if (picks.length < 10) notes.push(`Delivered ${picks.length}/10 — dataset thin on rich family events.`);

  const meta: DigestMeta = {
    ...META,
    cover_image: picks[0]?.event.image_url ?? null,
    event_count: picks.length,
  };

  return {
    meta,
    events: picks.map((s) => s.event) as EventRow[],
    coverage: { strong_candidates: strong, weak_candidates: weak, skipped_low_quality: skipped, notes },
    scored: picks,
  };
}
