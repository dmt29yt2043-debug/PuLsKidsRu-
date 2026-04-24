import { NextRequest } from 'next/server';
import { addFlag, removeFlag, getActiveSession } from '@/lib/debug-sessions';
import type { FilterState } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface FlagBody {
  event_id: number;
  title?: string;
  age_label?: string | null;
  age_min?: number | null;
  age_best_from?: number | null;
  age_best_to?: number | null;
  filters?: FilterState;
}

export async function GET() {
  const session = getActiveSession();
  return Response.json({
    session,
    flagged_ids: session ? session.flags.map((f) => f.event_id) : [],
  });
}

export async function POST(req: NextRequest) {
  let body: FlagBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.event_id !== 'number') {
    return Response.json({ error: 'event_id is required' }, { status: 400 });
  }

  const session = addFlag(
    {
      event_id: body.event_id,
      title: body.title ?? '',
      age_label: body.age_label ?? null,
      age_min: body.age_min ?? null,
      age_best_from: body.age_best_from ?? null,
      age_best_to: body.age_best_to ?? null,
    },
    body.filters ?? {},
  );

  return Response.json({ ok: true, session });
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idStr = sp.get('event_id');
  const id = idStr ? parseInt(idStr, 10) : NaN;
  if (!Number.isFinite(id)) {
    return Response.json({ error: 'event_id is required' }, { status: 400 });
  }
  const session = removeFlag(id);
  return Response.json({ ok: true, session });
}
