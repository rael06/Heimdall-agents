import { ScanOptions, StatusVerdict, TurnState, gradeTurnState } from './provider';

/**
 * Status inference for a Codex session, based on the end of its rollout file.
 * Pure function: disk reads are performed by the provider.
 */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

function payloadOf(entry: Json): Json | undefined {
  return asObject(entry.payload);
}

/** Tool calls emitted without a matching output: the session is busy or blocked. */
export function hasPendingToolCall(tail: unknown[]): boolean {
  const pending = new Set<string>();
  for (const raw of tail) {
    const entry = asObject(raw);
    const payload = entry ? payloadOf(entry) : undefined;
    if (!payload || typeof payload.type !== 'string') {
      continue;
    }
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    if (!callId) {
      continue;
    }
    if (payload.type.endsWith('_call')) {
      pending.add(callId);
    } else if (payload.type.endsWith('_call_output')) {
      pending.delete(callId);
    }
  }
  return pending.size > 0;
}

/**
 * The turns this window has seen end, by `turn_id`.
 *
 * Codex records an item finishing *after* the turn it belongs to has completed:
 * measured on one session, a `CommandExecution` was written nine minutes past
 * the `task_complete` of another turn, and it was the last line in the file. A
 * walk that meets that item first reads it as work in progress and never gets
 * to the ending one line above.
 *
 * So an item is read against its own turn rather than against its position.
 * That pairing is Codex's own — `task_started` and `task_complete` already
 * carry the same identifier — and it is the difference between "the last thing
 * written" and "the last thing that happened".
 */
function completedTurns(tail: unknown[]): Set<string> {
  const done = new Set<string>();
  for (const raw of tail) {
    const entry = asObject(raw);
    const payload = entry ? payloadOf(entry) : undefined;
    if (payload?.type === 'task_complete' && typeof payload.turn_id === 'string') {
      done.add(payload.turn_id);
    }
  }
  return done;
}

/** What the end of the rollout says, before the clock has its say. */
export function codexTurnState(tail: unknown[]): TurnState {
  const pendingCall = hasPendingToolCall(tail);
  const finished = completedTurns(tail);

  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const entry = asObject(tail[index]);
    if (!entry || entry.type !== 'event_msg') {
      continue;
    }
    const payload = payloadOf(entry);
    const type = payload && typeof payload.type === 'string' ? payload.type : '';

    // An item belonging to a turn this window has already seen end is a late
    // record of finished work, not work in progress: keep walking back to
    // whatever actually ended last. Before the switch rather than inside it,
    // because a `case` that falls into the next one is a `case` somebody edits
    // wrongly later — and TypeScript refuses it outright.
    if (
      type === 'item_completed' &&
      typeof payload?.turn_id === 'string' &&
      finished.has(payload.turn_id)
    ) {
      continue;
    }

    switch (type) {
      case 'task_complete':
        // Codex states the end of a turn itself, and it is the only way it ever
        // asks you anything: having no tool for that, it finishes its turn to
        // put the question to you. So this one event covers both.
        return {
          kind: 'settled',
          status: 'idle',
          reason: 'The turn ended, nothing more happens without you.',
        };
      case 'turn_aborted': {
        const reason = typeof payload?.reason === 'string' ? payload.reason : '';
        if (reason === 'replaced') {
          return {
            kind: 'pending',
            running: 'Turn replaced by a newer request, still running.',
            unknown: 'Turn replaced without any usable follow-up.',
          };
        }
        return {
          kind: 'settled',
          status: 'failed',
          reason: 'The last turn was interrupted or cancelled.',
        };
      }
      case 'error':
      case 'stream_error':
        return { kind: 'settled', status: 'failed', reason: 'The last turn ended on an error.' };
      /*
       * Codex saying the turn is open, in its own words. Nothing is inferred
       * from any of these: `task_started` with no matching `task_complete` is
       * an open turn, and so is anything the model produced with no ending
       * written after it.
       *
       * `item_completed` is the same thing said in the vocabulary Codex moved
       * to. A newer release folds the message, the reasoning and the rest into
       * one event carrying the real kind in `item.type`, and stops emitting the
       * three names above it. Measured on a session written by that release:
       * 345 entries, of which exactly **two** the reader recognised —
       * `task_started` at the top and `task_complete` at the end, 343 lines
       * apart. The window holds 120, so for 224 of its 345 states there was no
       * usable event in it at all, and the row read *inconclusive* for most of
       * the time the session spent working.
       *
       * It needed no new meaning, only the new name: an item finishing with no
       * `task_complete` after it says the turn is open, exactly as an agent
       * message did.
       */
      case 'task_started':
      case 'user_message':
      case 'agent_message':
      case 'agent_reasoning':
      case 'item_completed':
        return {
          kind: 'pending',
          running: pendingCall ? 'A tool is running.' : 'Turn in progress.',
          unknown: 'Turn interrupted with no final event to rely on.',
        };
      default:
        // Irrelevant event (token_count, settings) or an event added by a newer
        // Codex release: keep walking back through the transcript.
        continue;
    }
  }

  /*
   * Nothing the walk knows how to read — but a tool call with no output is
   * still the file saying a turn is open, in a part of it the vocabulary above
   * does not cover.
   *
   * This is the net under the next rename. Codex has changed the names of its
   * events once already, and the reader went on reporting *inconclusive* for
   * most of every session until somebody noticed; a call left unclosed is
   * evidence of the same kind as an event, and it does not depend on knowing
   * what the events are called this year.
   */
  if (pendingCall) {
    return {
      kind: 'pending',
      running: 'A tool is running.',
      unknown: 'A tool was left running with nothing said about it since.',
    };
  }

  return {
    kind: 'settled',
    status: 'unknown',
    reason: 'No usable event at the end of the transcript.',
  };
}

export function inferCodexStatus(
  tail: unknown[],
  ageMs: number,
  options: ScanOptions,
): StatusVerdict {
  return gradeTurnState(codexTurnState(tail), ageMs, options);
}
