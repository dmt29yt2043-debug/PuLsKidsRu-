/**
 * Digest orchestrator — the single entry point used by the API routes.
 *
 * All 20 digests are defined in code (no DB rows). Events come from the live
 * events pool and are scored on every request. Filters (from the URL) are
 * applied to the events pool BEFORE scoring, so the shelf reacts to what
 * the user selected in the sidebar.
 */

import Database from 'better-sqlite3';
import path from 'path';
import type { EventRow, DigestResult, DigestMeta, EnrichedEvent } from './types';
import { LIVE_STATUS_FILTER, MOSCOW_DISTRICTS } from './constants';
import { enrich } from './event-parser';
import { getWeekendDigest } from './weekend';
import { getIndoorDigest } from './indoor';
import { getEasyDigest } from './easy';
import { getAffordableDigest } from './affordable';
import { getWorthItDigest } from './worth-it';
import { EXTRA_DIGEST_RUNNERS } from './extras';

const DB_PATH = path.join(process.cwd(), 'data', 'events.db');

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface DigestFilters {
  /** Category l1 slugs (theater/music/education/...). Any-of match. */
  categories?: string[];
  /** Child age ceiling — show events with age_label ≤ ageMax. */
  ageMax?: number;
  /** Moscow districts (ЦАО, САО, …). Any-of match. */
  neighborhoods?: string[];
  /** Only free events. */
  isFree?: boolean;
  /** Max price ceiling (RUB). Events above price_max are dropped. */
  priceMax?: number;
  /** Only events starting on/after this date (YYYY-MM-DD, MSK). */
  dateFrom?: string;
  /** Only events starting on/before this date (YYYY-MM-DD, MSK). */
  dateTo?: string;
}

function loadLiveEvents(): EventRow[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT * FROM events
      WHERE ${LIVE_STATUS_FILTER}
        AND disabled = 0 AND archived = 0
    `).all() as EventRow[];
    return rows;
  } finally {
    db.close();
  }
}

/** Parse numeric age from labels like "6+", "12+". 0 = no restriction. */
function ageLabelLowerBound(label: string | null | undefined): number {
  const s = (label ?? '').trim();
  if (!s || s === '0') return 0;
  const m = s.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function eventMatchesFilters(ev: EnrichedEvent, f: DigestFilters): boolean {
  // Category
  if (f.categories && f.categories.length > 0) {
    const cat = ev.category_l1 ?? '';
    const cats = ev.categoriesParsed;
    const hit = f.categories.some((c) => cat === c || cats.includes(c));
    if (!hit) return false;
  }
  // Age ceiling — child is ageMax years old, event must be age-appropriate
  if (f.ageMax !== undefined) {
    const lo = ageLabelLowerBound(ev.age_label);
    if (lo > f.ageMax) return false;
  }
  // Neighborhoods — match by bbox (like lib/db.ts does for the feed)
  if (f.neighborhoods && f.neighborhoods.length > 0 && !f.neighborhoods.includes('Вся Москва')) {
    if (ev.lat == null || ev.lon == null) return false;
    const inAny = f.neighborhoods.some((nb) => {
      const d = MOSCOW_DISTRICTS.find((x) => x.name === nb);
      if (!d) return false;
      return ev.lat! >= d.latMin && ev.lat! <= d.latMax && ev.lon! >= d.lonMin && ev.lon! <= d.lonMax;
    });
    if (!inAny) return false;
  }
  // Price
  if (f.isFree === true && ev.is_free !== 1) return false;
  if (f.priceMax !== undefined) {
    if (ev.is_free === 1) {/* always passes */}
    else if ((ev.price_max ?? 0) > f.priceMax) return false;
  }
  // Date window
  if (f.dateFrom && ev.next_start_at) {
    if (ev.next_start_at.slice(0, 10) < f.dateFrom) return false;
  }
  if (f.dateTo && ev.next_start_at) {
    if (ev.next_start_at.slice(0, 10) > f.dateTo) return false;
  }
  return true;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

/**
 * Run all 20 digests. Events are enriched once and passed to each digest.
 * Order is fixed — reflects the product-desired order on the shelf.
 *
 * If `filters` is provided, events are pre-filtered BEFORE scoring so the
 * whole shelf reacts to what the user selected.
 */
export function runAllDigests(filters?: DigestFilters): DigestResult[] {
  const rows = loadLiveEvents();
  const enriched = rows.map(enrich);
  const pool = filters
    ? enriched.filter((ev) => eventMatchesFilters(ev, filters))
    : enriched;
  const now = Date.now();

  const coreRunners: Array<(evs: EnrichedEvent[]) => DigestResult> = [
    (evs) => getWeekendDigest(evs, now),
    getIndoorDigest,
    getEasyDigest,
    getAffordableDigest,
    getWorthItDigest,
  ];

  const results: DigestResult[] = [
    ...coreRunners.map((run) => run(pool)),
    ...EXTRA_DIGEST_RUNNERS.map((run) => run(pool)),
  ];

  // Post-process: unique cover images across the shelf.
  diversifyCoverImages(results);
  return results;
}

/**
 * Walk through digests in order; each one claims a cover image. If the first
 * pick collides with a previously-claimed image, drop down the scored list
 * until we find a unique one. Mutates `meta.cover_image` on each digest.
 */
function diversifyCoverImages(results: DigestResult[]): void {
  const claimed = new Set<string>();
  for (const r of results) {
    const candidates = r.scored
      .map((s) => s.event.image_url)
      .filter((u): u is string => !!u);
    const pick = candidates.find((u) => !claimed.has(u)) ?? candidates[0] ?? null;
    r.meta.cover_image = pick;
    if (pick) claimed.add(pick);
  }
}

/**
 * List digests as shelf entries (no events inline — events are fetched per
 * slug when the user clicks into one). Groups by `category` to match the
 * legacy API shape consumed by components/DigestShelf.tsx.
 *
 * Empty digests (event_count === 0) are dropped — they have nothing to show.
 */
export function listShelfCategories(filters?: DigestFilters): Array<{ name: string; digests: DigestMeta[] }> {
  const results = runAllDigests(filters).filter((r) => r.meta.event_count > 0);
  const grouped = new Map<string, DigestMeta[]>();
  for (const r of results) {
    const cat = r.meta.category;
    const list = grouped.get(cat) ?? [];
    list.push(r.meta);
    grouped.set(cat, list);
  }
  return Array.from(grouped.entries()).map(([name, digests]) => ({ name, digests }));
}

/**
 * Return a digest by slug with its events. Used by /api/digests/[slug].
 * Returns null if the slug doesn't match any of our digests.
 */
export function getDigestBySlug(slug: string, filters?: DigestFilters): { digest: DigestMeta; events: EventRow[] } | null {
  const all = runAllDigests(filters);
  const found = all.find((r) => r.meta.slug === slug);
  if (!found) return null;
  return { digest: found.meta, events: found.events };
}

/** All slugs — useful for validation / routing. */
export function allSlugs(): string[] {
  return [
    'weekend', 'indoor', 'easy', 'budget', 'popular',
    'tonight', 'tomorrow', 'sunday-chill', 'after-work',
    'tiny-kids', 'preschool', 'teens',
    'theater', 'music', 'workshops', 'museums', 'tours', 'cinema',
    'near-metro', 'rare',
  ];
}
