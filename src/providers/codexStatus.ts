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

/** What the end of the rollout says, before the clock has its say. */
export function codexTurnState(tail: unknown[]): TurnState {
  const pendingCall = hasPendingToolCall(tail);

  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const entry = asObject(tail[index]);
    if (!entry || entry.type !== 'event_msg') {
      continue;
    }
    const payload = payloadOf(entry);
    const type = payload && typeof payload.type === 'string' ? payload.type : '';

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
      case 'task_started':
      case 'user_message':
      case 'agent_message':
      case 'agent_reasoning':
        // `task_started` with no matching `task_complete` is Codex saying the
        // turn is open, in its own words. Nothing has to be inferred from it.
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
