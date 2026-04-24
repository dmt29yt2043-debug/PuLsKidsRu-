import { insertAnalyticsEvents, getSummary, getFunnel, getDailyUniqueUsers, getReturningUsersPct, getUtmPerformance, getTopClickedEvents, getAvgRecommendationsLatency, getRecentEvents } from '@/lib/analytics-db';
import type { AnalyticsEventInput } from '@/lib/analytics-db';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics
 * Accepts the same payload as /api/analytics/event for backward-compat:
 *   { events: [...] }  or  { ...singleEvent }
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
    console.error('Analytics POST error:', error);
    // Never break UX — return 204 even on internal errors
    return new Response(null, { status: 204 });
  }
}

/**
 * GET /api/analytics?view=...&key=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Views: summary | funnel | daily | retention | utm | top_events | latency | recent
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const view = searchParams.get('view') || 'summary';
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  const password = searchParams.get('key');
  const expected = process.env.ANALYTICS_KEY || 'pulse-analytics-2026';
  if (password !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    switch (view) {
      case 'summary':    return Response.json(getSummary(from, to));
      case 'funnel':     return Response.json(getFunnel(from, to));
      case 'daily':      return Response.json(getDailyUniqueUsers(from, to));
      case 'retention':  return Response.json({ returning_pct: getReturningUsersPct(from, to) });
      case 'utm':        return Response.json(getUtmPerformance(from, to));
      case 'top_events': return Response.json(getTopClickedEvents(from, to));
      case 'latency':    return Response.json({ avg_ms: getAvgRecommendationsLatency(from, to) });
      case 'recent':     return Response.json(getRecentEvents(from, to));
      default:           return Response.json({ error: 'Unknown view' }, { status: 400 });
    }
  } catch (error) {
    console.error('Analytics GET error:', error);
    return Response.json({ error: 'Failed to query analytics' }, { status: 500 });
  }
}
