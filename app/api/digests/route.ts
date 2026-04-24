/**
 * GET /api/digests — returns the 20 curated digests as a shelf.
 *
 * Accepts the same filter params as /api/events so the shelf reacts to what
 * the user has selected in the sidebar:
 *   - categories=theater,music       (any-of)
 *   - age_max=6
 *   - neighborhoods=ЦАО,САО          (any-of)
 *   - is_free=true
 *   - price_max=1500
 *   - date_from=2026-04-25
 *   - date_to=2026-04-27
 *
 * Digests with 0 events after filtering are omitted from `categories` but
 * still present in `digests` (so the client can know they exist but are
 * empty for this filter set, if desired).
 */

import { NextRequest } from 'next/server';
import { runAllDigests, listShelfCategories, type DigestFilters } from '@/lib/digests';

export const dynamic = 'force-dynamic';

function parseFilters(req: NextRequest): DigestFilters {
  const sp = req.nextUrl.searchParams;
  const f: DigestFilters = {};

  const cats = sp.get('categories');
  if (cats) f.categories = cats.split(',').map((s) => s.trim()).filter(Boolean);

  const ageMax = sp.get('age_max') ?? sp.get('ageMax');
  if (ageMax !== null && ageMax !== '') {
    const n = Number(ageMax);
    if (Number.isFinite(n)) f.ageMax = n;
  }

  const nbs = sp.get('neighborhoods');
  if (nbs) f.neighborhoods = nbs.split(',').map((s) => s.trim()).filter(Boolean);

  const isFree = sp.get('is_free') ?? sp.get('isFree');
  if (isFree === 'true' || isFree === '1') f.isFree = true;

  const priceMax = sp.get('price_max') ?? sp.get('priceMax');
  if (priceMax !== null && priceMax !== '') {
    const n = Number(priceMax);
    if (Number.isFinite(n)) f.priceMax = n;
  }

  const dateFrom = sp.get('date_from') ?? sp.get('dateFrom');
  if (dateFrom) f.dateFrom = dateFrom;

  const dateTo = sp.get('date_to') ?? sp.get('dateTo');
  if (dateTo) f.dateTo = dateTo;

  return f;
}

export async function GET(req: NextRequest) {
  try {
    const filters = parseFilters(req);
    const hasFilters = Object.keys(filters).length > 0;
    const results = runAllDigests(hasFilters ? filters : undefined);
    const categories = listShelfCategories(hasFilters ? filters : undefined);
    return Response.json({
      digests: results.map((r) => r.meta),
      categories,
    });
  } catch (err) {
    console.error('Digests API error:', err);
    return Response.json({ error: 'Failed to compute digests' }, { status: 500 });
  }
}
