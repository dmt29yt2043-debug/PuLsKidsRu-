import { NextRequest } from 'next/server';
import { closeActiveSession, getActiveSession, getAllSessions } from '@/lib/debug-sessions';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('all') === '1') {
    return Response.json({ sessions: getAllSessions() });
  }
  return Response.json({ session: getActiveSession() });
}

// POST closes the currently active session.
// Body: { notes?: string }
export async function POST(req: NextRequest) {
  let notes: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.notes === 'string') notes = body.notes;
  } catch {
    // empty body is fine
  }
  const closed = closeActiveSession(notes);
  return Response.json({ ok: true, closed });
}
