/**
 * GET /api/digests/[slug] — returns a digest's metadata + its events.
 *
 * Supports the same filter query params as /api/digests — when the user has
 * an active filter and opens a specific digest, the contents are filtered.
 */

import { NextRequest } from 'next/server';
import { getDigestBySlug, type DigestFilters } from '@/lib/digests';
import { parseEventRow } from '@/lib/db';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const filters = parseFilters(req);
    const hasFilters = Object.keys(filters).length > 0;
    const result = getDigestBySlug(slug, hasFilters ? filters : undefined);
    if (!result) {
      return Response.json({ error: 'Digest not found' }, { status: 404 });
    }
    // Parse JSON fields (categories, tags, reviews, derisk, data) and coerce
    // is_free → boolean. `/api/events` does this via parseEventRow; the digest
    // endpoint used to return raw DB rows which crashed the frontend
    // (event.categories.map is not a function in OverviewTab).
    const events = result.events.map((row) =>
      parseEventRow(row as unknown as Record<string, unknown>),
    );
    return Response.json({ digest: result.digest, events });
  } catch (err) {
    console.error('Digest detail API error:', err);
    return Response.json({ error: 'Failed to fetch digest' }, { status: 500 });
  }
}
