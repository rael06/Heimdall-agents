import { AgentSession, SessionStatus } from '../model/types';

export interface Transition {
  id: string;
  /** Absent when the session is being seen for the first time. */
  from?: SessionStatus;
  to: SessionStatus;
}

export interface Tracked {
  status: SessionStatus;
  /** When this status began (ms). */
  changedAt: number;
}

/**
 * Follows each session's status from one scan to the next, so the service knows
 * when a status *began* rather than only what it is.
 *
 * Nothing records that on disk, and it does not need to. A status seen changing
 * while the service watches is dated exactly. A session already in its status
 * when the service starts is dated from its last write, which is right whenever
 * the transcript is what settled the status, and early by at most the running
 * timeout when the clock is. That is the cold-start answer only: the first
 * transition observed replaces it with the real one.
 */
export function trackTransitions(
  known: ReadonlyMap<string, Tracked>,
  sessions: readonly AgentSession[],
  nowMs: number,
): { tracked: Map<string, Tracked>; transitions: Transition[] } {
  const tracked = new Map<string, Tracked>();
  const transitions: Transition[] = [];

  for (const session of sessions) {
    const before = known.get(session.id);
    if (!before) {
      const updatedAt = Date.parse(session.updatedAt);
      tracked.set(session.id, {
        status: session.status,
        changedAt: Number.isNaN(updatedAt) ? nowMs : updatedAt,
      });
      transitions.push({ id: session.id, to: session.status });
      continue;
    }
    if (before.status === session.status) {
      tracked.set(session.id, before);
      continue;
    }
    tracked.set(session.id, { status: session.status, changedAt: nowMs });
    transitions.push({ id: session.id, from: before.status, to: session.status });
  }

  return { tracked, transitions };
}

/**
 * Whole minutes since the status began, never negative — a transcript written by
 * a machine whose clock runs ahead would otherwise show a session changing in
 * the future.
 */
export function minutesSince(changedAt: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - changedAt) / 60000));
}
