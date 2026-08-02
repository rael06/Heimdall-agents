import { AgentSession } from '../model/types';

/**
 * What changed between two scans, keyed by session. The browser applies this to
 * the rows it already has, so focus, selection and scroll survive an update —
 * a full re-render would lose all three, and retrofitting keyed updates later
 * means rewriting the rendering.
 */
export interface SessionDelta {
  /** Sessions that appeared, or whose displayed content moved. */
  upserted: AgentSession[];
  /** Identifiers that left the list. */
  removed: string[];
}

/**
 * Everything the row shows. Comparing this rather than the whole object keeps a
 * scan that re-read a transcript without finding anything new from waking every
 * connected browser.
 */
function signature(session: AgentSession): string {
  return [
    session.title,
    session.status,
    session.statusReason,
    session.createdAt,
    session.updatedAt,
    session.cwd ?? '',
    session.filePath,
  ].join(' ');
}

export function computeDelta(
  previous: readonly AgentSession[],
  next: readonly AgentSession[],
): SessionDelta {
  const before = new Map(previous.map((session) => [session.id, signature(session)]));
  const upserted: AgentSession[] = [];
  const seen = new Set<string>();

  for (const session of next) {
    seen.add(session.id);
    const known = before.get(session.id);
    if (known === undefined || known !== signature(session)) {
      upserted.push(session);
    }
  }

  const removed = previous
    .map((session) => session.id)
    .filter((id) => !seen.has(id));

  return { upserted, removed };
}

export function isEmptyDelta(delta: SessionDelta): boolean {
  return delta.upserted.length === 0 && delta.removed.length === 0;
}
