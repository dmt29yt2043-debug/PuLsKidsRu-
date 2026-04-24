import { insertAnalyticsEvents } from '@/lib/analytics-db';
import type { AnalyticsEventInput } from '@/lib/analytics-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics/event
 * Accepts either a single event:
 *   { event_name: "card_clicked", anonymous_id, session_id, ... }
 * Or a batch:
 *   { events: [ {...}, {...} ] }
 *
 * Always returns 204 to avoid breaking UX. Bad rows are silently dropped.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const events: AnalyticsEventInput[] = Array.isArray(body?.events)
      ? body.events
      : body?.event_name
        ? [body]
        : [];

    if (events.length === 0) {
      return new Response(null, { status: 204 });
    }
    if (events.length > 50) {
      return Response.json({ error: 'max 50 events per batch' }, { status: 400 });
    }

    insertAnalyticsEvents(events);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('analytics/event POST error:', error);
    return new Response(null, { status: 204 });
  }
}
