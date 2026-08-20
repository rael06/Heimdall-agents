import { AgentSession, ProviderId, ProviderState, SessionStatus } from '../model/types';

export interface ScanOptions {
  /** Reference timestamp of the scan (ms). */
  now: number;
  /** Delay after which a session still mid-turn becomes unknown (ms). 0 means never. */
  staleAfterMs: number;
  /** History window based on the last activity (ms). 0 means unlimited. */
  historyMs: number;
  /** Maximum number of sessions returned. */
  maxSessions: number;
  /**
   * Sessions to re-read from disk. Every other session is served from the last
   * scan, with its status graded again against the current time. Absent means a
   * full scan: the directories are walked and every changed file is read.
   */
  focusIds?: ReadonlySet<string>;
  /**
   * When a hook last reported this session as waiting for an answer, in ms, or
   * nothing. Absent altogether when no shared directory is configured, which is
   * how every existing caller keeps its old behaviour.
   *
   * On the options rather than inside a provider, because both of them have to
   * reach the same verdict from it and neither should own the rule.
   */
  waitingSince?: (provider: ProviderId, nativeId: string) => Promise<number | undefined>;
}

export interface ScanResult {
  sessions: AgentSession[];
  state: ProviderState;
  /** Sessions dropped by the history window or the session cap. */
  truncated: number;
}

export interface SessionProvider {
  readonly id: ProviderId;
  /** Inspected root directory, surfaced in the empty states. */
  readonly root: string;
  scan(options: ScanOptions): Promise<ScanResult>;
  /** Local full text search inside the transcript of one session. */
  matchesContent(session: AgentSession, terms: string[]): Promise<boolean>;
}

export interface StatusVerdict {
  status: SessionStatus;
  reason: string;
}

/**
 * What the transcript says about the last turn, before the clock has its say.
 *
 * Reading a transcript is expensive and its conclusion never changes while the
 * file does not, whereas the status does: a turn left mid-tool is running, then
 * waiting, then inconclusive, without a single byte being written. Splitting the
 * two lets a scan keep this small value and grade it again on every refresh
 * instead of parsing the file anew.
 */
export type TurnState =
  /** Nothing left to weigh: the transcript alone settles the status. */
  | { kind: 'settled'; status: SessionStatus; reason: string }
  /**
   * A turn the transcript says is still open.
   *
   * It is running, and stays running: the file said the turn had not ended, and
   * no amount of waiting turns that into evidence of anything else. The clock
   * only decides when to stop believing the file at all.
   */
  | {
      kind: 'pending';
      running: string;
      unknown: string;
      /**
       * What a file gone cold means here, when it means more than "this can no
       * longer be trusted". Defaults to `unknown`, which is what an open turn
       * deserves: nothing in the transcript says whether it ever ended.
       *
       * A background task is the case that needed this. It belongs to the
       * process that launched it, so a transcript that has not moved in the
       * stale window says that process is gone and the task with it — and then
       * the turn really did end, which is a conclusion and not an absence of
       * one.
       */
      staleStatus?: SessionStatus;
    };

/** Grades what the transcript said against the current time and the settings. */
export function gradeTurnState(
  state: TurnState,
  ageMs: number,
  options: ScanOptions,
): StatusVerdict {
  switch (state.kind) {
    case 'settled':
      return { status: state.status, reason: state.reason };
    case 'pending':
      return pendingVerdict(ageMs, options, state);
  }
}

/**
 * Status of a session whose turn the transcript leaves open.
 *
 * It used to become *needs action* past a delay, on the theory that a turn
 * stopped for long enough was waiting for a permission. It was a guess, and it
 * was wrong on every command that simply takes minutes: on disk, a pending
 * permission and a slow tool are the same object — a turn that has not ended.
 * Neither provider writes anything while it waits, so no delay can separate
 * them, and a notification raised on that guess is a false alarm.
 *
 * So an open turn is running. Past the stale delay it becomes inconclusive,
 * which says the only true thing left: the file has not moved in a long time
 * and nothing in it can be trusted to still describe the session.
 */
/**
 * The verdict for one session: what its transcript said, against the clock and
 * against anything a hook reported.
 *
 * The hook is only consulted on a turn the transcript leaves open, which is the
 * only state a permission request can be sitting in — and it only counts if it
 * is not older than the last thing written to the transcript. That comparison
 * is what makes it self-clearing: the moment you answer, the tool runs and
 * writes its result, and the report is behind again.
 *
 * `idle` rather than a state of its own, and settled rather than ageing into
 * inconclusive: a permission does not stop waiting for you because it has been
 * waiting a long time. That is the case where the old status was worst — the
 * longer it mattered, the further the row drifted from what it meant.
 */
export async function verdictFor(
  state: TurnState,
  session: { provider: ProviderId; nativeId: string; updatedAtMs: number },
  options: ScanOptions,
): Promise<StatusVerdict> {
  if (state.kind === 'pending' && options.waitingSince) {
    const asked = await options.waitingSince(session.provider, session.nativeId);
    if (asked !== undefined && asked >= session.updatedAtMs) {
      return { status: 'idle', reason: 'Stopped to ask you for a permission.' };
    }
  }
  return gradeTurnState(state, Math.max(0, options.now - session.updatedAtMs), options);
}

export function pendingVerdict(
  ageMs: number,
  options: ScanOptions,
  labels: { running: string; unknown: string; staleStatus?: SessionStatus },
): StatusVerdict {
  // Zero means never, as it already does for the history window. The clock is
  // then out of it entirely: an open turn stays open until the transcript says
  // otherwise, and nothing but the file decides.
  if (options.staleAfterMs === 0 || ageMs < options.staleAfterMs) {
    return { status: 'running', reason: labels.running };
  }
  return { status: labels.staleStatus ?? 'unknown', reason: labels.unknown };
}
