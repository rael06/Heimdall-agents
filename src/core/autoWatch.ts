import { AgentSession } from '../model/types';

/** Sessions currently working, which is what the marker follows. */
export function runningIds(sessions: AgentSession[]): string[] {
  return sessions.filter((session) => session.status === 'running').map((session) => session.id);
}

/**
 * Sessions to watch automatically, decided on the transition into `running`
 * rather than on the running state itself.
 *
 * Remembering which sessions were merely *seen once* made dismissing final: an
 * old conversation that had been considered before was never marked again, even
 * when the user resumed it and it started working. Remembering which ones were
 * already running instead keeps both properties: dismissing during a turn holds,
 * since nothing changes state, and a session that starts working again is a new
 * transition, so it is watched again.
 */
export function sessionsToAutoWatch(
  sessions: AgentSession[],
  previouslyRunning: ReadonlySet<string>,
  watched: ReadonlySet<string>,
): string[] {
  return runningIds(sessions).filter(
    (id) => !previouslyRunning.has(id) && !watched.has(id),
  );
}
