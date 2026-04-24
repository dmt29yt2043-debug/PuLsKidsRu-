import fs from 'fs';
import path from 'path';
import type { FilterState } from './types';

const SESSIONS_PATH = path.join(process.cwd(), 'data', 'debug_sessions.json');

export interface FlaggedEvent {
  event_id: number;
  title: string;
  age_label: string | null;
  age_min: number | null;
  age_best_from: number | null;
  age_best_to: number | null;
  reason: 'wrong_age_range';
  flagged_at: string;
}

export interface DebugSession {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'closed';
  // Snapshot of the filters at the moment the session became active.
  // We capture once on session start so the user can change filters mid-session
  // without losing the original context. (Re-snapshot only when session reopens.)
  filters: FilterState;
  flags: FlaggedEvent[];
  notes?: string;
}

interface SessionsFile {
  next_id: number;
  sessions: DebugSession[];
}

function readFile(): SessionsFile {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) {
      return { next_id: 1, sessions: [] };
    }
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { next_id: 1, sessions: [] };
    return {
      next_id: parsed.next_id ?? 1,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { next_id: 1, sessions: [] };
  }
}

function writeFile(data: SessionsFile) {
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function getActiveSession(): DebugSession | null {
  const file = readFile();
  return file.sessions.find((s) => s.status === 'active') ?? null;
}

export function getAllSessions(): DebugSession[] {
  return readFile().sessions;
}

/**
 * Ensure there is exactly one active session. Creates one with the provided
 * filter snapshot if none exists. Existing active session is returned as-is —
 * filters are NOT overwritten so the original context is preserved.
 */
export function ensureActiveSession(filters: FilterState): DebugSession {
  const file = readFile();
  const existing = file.sessions.find((s) => s.status === 'active');
  if (existing) return existing;

  const session: DebugSession = {
    id: file.next_id,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'active',
    filters,
    flags: [],
  };
  file.sessions.push(session);
  file.next_id += 1;
  writeFile(file);
  return session;
}

export function addFlag(eventData: Omit<FlaggedEvent, 'flagged_at' | 'reason'> & { reason?: FlaggedEvent['reason'] }, filters: FilterState): DebugSession {
  const file = readFile();
  let session = file.sessions.find((s) => s.status === 'active');
  if (!session) {
    session = {
      id: file.next_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      status: 'active',
      filters,
      flags: [],
    };
    file.sessions.push(session);
    file.next_id += 1;
  }

  // Replace existing flag for the same event so the list stays unique.
  session.flags = session.flags.filter((f) => f.event_id !== eventData.event_id);
  session.flags.push({
    ...eventData,
    reason: eventData.reason ?? 'wrong_age_range',
    flagged_at: new Date().toISOString(),
  });

  writeFile(file);
  return session;
}

export function removeFlag(eventId: number): DebugSession | null {
  const file = readFile();
  const session = file.sessions.find((s) => s.status === 'active');
  if (!session) return null;
  session.flags = session.flags.filter((f) => f.event_id !== eventId);
  writeFile(file);
  return session;
}

export function closeActiveSession(notes?: string): DebugSession | null {
  const file = readFile();
  const session = file.sessions.find((s) => s.status === 'active');
  if (!session) return null;
  session.status = 'closed';
  session.ended_at = new Date().toISOString();
  if (notes) session.notes = notes;
  writeFile(file);
  return session;
}
