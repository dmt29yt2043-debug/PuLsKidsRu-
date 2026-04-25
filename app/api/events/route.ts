import { type NextRequest } from 'next/server';
import { getEvents } from '@/lib/db';
import type { Event, FilterState } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Fields the card grid + map markers + filtering logic actually need.
 *  Stripping the rest cut the page_size=500 response from ~5 MB to ~600 KB. */
const HEAVY_FIELDS = [
  'data',
  'derisk',
  'description',
  'description_source',
  'class_meta',
  'schedule',
  'occurrences',
  'reviews',
] as const;

function stripHeavyFields(ev: Event): Event {
  const out = { ...ev } as Record<string, unknown>;
  for (const f of HEAVY_FIELDS) delete out[f];
  return out as unknown as Event;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const page_size = Math.min(600, Math.max(1, parseInt(searchParams.get('page_size') || '20', 10) || 20));

    const filters: FilterState & { page: number; page_size: number } = {
      page,
      page_size,
    };

    const categoriesParam = searchParams.get('categories');
    if (categoriesParam) {
      filters.categories = categoriesParam.split(',').map((s) => s.trim());
    }

    // Support both camelCase and snake_case param names
    const excludeCategoriesParam = searchParams.get('excludeCategories') || searchParams.get('exclude_categories');
    if (excludeCategoriesParam) {
      filters.excludeCategories = excludeCategoriesParam.split(',').map((s) => s.trim());
    }

    const priceMin = searchParams.get('price_min');
    if (priceMin !== null && priceMin !== '') filters.priceMin = parseFloat(priceMin);

    const priceMax = searchParams.get('price_max');
    if (priceMax !== null && priceMax !== '') filters.priceMax = parseFloat(priceMax);

    const isFree = searchParams.get('is_free');
    if (isFree !== null) filters.isFree = isFree === 'true';

    const age = searchParams.get('age');
    if (age) filters.ageMax = parseInt(age, 10);

    // Multi-child filter: comma-separated list of ages, e.g. "5,9".
    // When provided, this overrides single-age behavior — events must
    // suit at least one of the children.
    const childAgesParam = searchParams.get('child_ages');
    if (childAgesParam) {
      const ages = childAgesParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 18);
      if (ages.length > 0) filters.childAges = ages;
    }

    // Child genders for gender-fit filtering
    const childGendersParam = searchParams.get('child_genders');
    if (childGendersParam) {
      const genders = childGendersParam
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((g): g is 'boy' | 'girl' => ['boy', 'girl'].includes(g));
      if (genders.length > 0) filters.childGenders = genders;
    }

    const dateFrom = searchParams.get('date_from');
    if (dateFrom) filters.dateFrom = dateFrom;

    const dateTo = searchParams.get('date_to');
    if (dateTo) filters.dateTo = dateTo;

    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const distance = searchParams.get('distance');
    if (lat && lon && distance) {
      filters.lat = parseFloat(lat);
      filters.lon = parseFloat(lon);
      filters.distance = parseFloat(distance);
    }

    const search = searchParams.get('search');
    if (search) filters.search = search;

    const neighborhoods = searchParams.get('neighborhoods');
    if (neighborhoods) filters.neighborhoods = neighborhoods.split(',').map((s) => s.trim());

    const ratingMin = searchParams.get('rating_min');
    if (ratingMin !== null && ratingMin !== '') filters.ratingMin = parseFloat(ratingMin);

    const result = getEvents(filters);

    // Heavy fields used only by EventDetail are stripped from the feed
    // response — `data` alone was 75% of payload (~3.4 MB on a 500-event
    // page). The card grid + map markers don't need them; the detail view
    // re-fetches the full event via /api/events/[id].
    // Pass `?full=1` to opt out of stripping (audit/debug only).
    const full = searchParams.get('full') === '1';
    const events = full ? result.events : result.events.map(stripHeavyFields);

    return Response.json({
      total: result.total,
      page,
      page_size,
      events,
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return Response.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}
