import { ScanOptions, StatusVerdict, TurnState, gradeTurnState } from './provider';

/**
 * Status inference for a Claude Code session, based on the end of its transcript.
 * Pure function: disk reads are performed by the provider.
 */

/**
 * Tools whose call stops the session on a user answer.
 *
 * Claude Code writes these into the transcript, so a question is read rather
 * than guessed at. They do not produce a status of their own: the session has
 * stopped working, which is `idle`, exactly like a turn that ended.
 */
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

const INTERRUPTION_MARKERS = [
  'request interrupted by user',
  "doesn't want to proceed",
  "doesn't want to take this action",
];

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

function contentBlocks(entry: Json): Json[] {
  const message = asObject(entry.message);
  const content = message?.content;
  if (Array.isArray(content)) {
    return content.map(asObject).filter((block): block is Json => Boolean(block));
  }
  return [];
}

function plainText(entry: Json): string {
  const message = asObject(entry.message);
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  return contentBlocks(entry)
    .map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      if (block.type === 'tool_result') {
        const inner = block.content;
        if (typeof inner === 'string') {
          return inner;
        }
        if (Array.isArray(inner)) {
          return inner
            .map(asObject)
            .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
            .join(' ');
        }
      }
      return '';
    })
    .join(' ');
}

/**
 * Why the model stopped, as the Messages API defines it.
 *
 * `end_turn` is "a natural stopping point", `tool_use` is "the model invoked one
 * or more tools", `pause_turn` is "we paused a long-running turn", and the field
 * is null "in the `message_start` event" — that is, while the answer is being
 * streamed.
 *
 * Null and absent are deliberately not the same thing. Null is the API stating
 * that the answer is still coming; absent is the field not being there at all,
 * which never happened once across the 26 911 assistant entries this was built
 * on. Should a future format drop it, reading that as "streaming" would report
 * every session as running forever, so it falls back to the content instead.
 *
 * @see https://platform.claude.com/docs/en/api/messages
 */
const STREAMING = Symbol('streaming');

function stopReason(entry: Json): string | typeof STREAMING | undefined {
  const message = asObject(entry.message);
  if (!message || !('stop_reason' in message)) {
    return undefined;
  }
  const value = message.stop_reason;
  return typeof value === 'string' ? value : STREAMING;
}

function isInterruption(entry: Json): boolean {
  const text = plainText(entry).toLowerCase();
  return INTERRUPTION_MARKERS.some((marker) => text.includes(marker));
}

/** Bookkeeping entries (titles, snapshots, queue) carry no conversation state. */
export function isConversationEntry(entry: Json): boolean {
  return entry.type === 'user' || entry.type === 'assistant';
}

/** What the end of the transcript says, before the clock has its say. */
export function claudeTurnState(tail: unknown[]): TurnState {
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const entry = asObject(tail[index]);
    if (!entry || !isConversationEntry(entry)) {
      continue;
    }

    if (entry.isApiErrorMessage === true) {
      return { kind: 'settled', status: 'failed', reason: 'The last turn ended on an API error.' };
    }

    if (entry.type === 'assistant') {
      const reason = stopReason(entry);

      // Written by the model itself, and the only thing in the file that states
      // whether the turn is over. Read before the content: a turn cut short by
      // the context window or a refusal also ends without a tool call, and
      // counting tool blocks would call both of those a clean answer.
      if (reason === 'refusal') {
        return {
          kind: 'settled',
          status: 'failed',
          reason: 'The turn was stopped by a safety classifier.',
        };
      }
      if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {
        return {
          kind: 'settled',
          status: 'failed',
          reason: 'The turn was cut short before the answer was finished.',
        };
      }
      // "we paused a long-running turn" — the model has more to say, and a long
      // thinking phase must never be mistaken for an answer.
      if (reason === 'pause_turn') {
        return {
          kind: 'pending',
          running: 'The turn was paused mid-flight and is being continued.',
          unknown: 'Turn paused long ago and never continued.',
        };
      }
      // Null while streaming, so this entry is the answer being written right
      // now. Positive evidence of work, which no delay could have provided.
      if (reason === STREAMING) {
        return {
          kind: 'pending',
          running: 'The answer is being written.',
          unknown: 'An answer was left half-written.',
        };
      }

      const toolUses = contentBlocks(entry).filter((block) => block.type === 'tool_use');
      // With nothing stated, the content decides, as it did before the field was
      // read: tool calls mean the turn is open, prose means it is over.
      if (toolUses.length === 0 || (reason !== undefined && reason !== 'tool_use')) {
        // end_turn or stop_sequence: "a natural stopping point".
        return {
          kind: 'settled',
          status: 'idle',
          reason: 'The turn ended, nothing more happens without you.',
        };
      }
      // A question left unanswered is the turn still being open, and the model
      // no longer working — which is the only thing the notification cares
      // about. Codex has no such tool and ends its turn to ask instead, so both
      // reach the same state by their own means.
      const asking = toolUses.find(
        (block) => typeof block.name === 'string' && ASKING_TOOLS.has(block.name),
      );
      if (asking) {
        return {
          kind: 'settled',
          status: 'idle',
          reason: `The session stopped to ask you something (${String(asking.name)}).`,
        };
      }
      return {
        kind: 'pending',
        running: 'A tool is running.',
        unknown: 'Turn interrupted during a tool call, state is inconclusive.',
      };
    }

    // entry.type === 'user'
    if (isInterruption(entry)) {
      return {
        kind: 'settled',
        status: 'failed',
        reason: 'The last turn was interrupted or denied.',
      };
    }
    const isToolResult = contentBlocks(entry).some((block) => block.type === 'tool_result');
    if (isToolResult) {
      return {
        kind: 'pending',
        running: 'Tool result received, the assistant is still working.',
        unknown: 'Nothing happened after the last tool result.',
      };
    }
    return {
      kind: 'pending',
      running: 'New request sent, answer in progress.',
      unknown: 'Request sent without any usable answer.',
    };
  }

  return {
    kind: 'settled',
    status: 'unknown',
    reason: 'No usable exchange at the end of the transcript.',
  };
}

export function inferClaudeStatus(
  tail: unknown[],
  ageMs: number,
  options: ScanOptions,
): StatusVerdict {
  return gradeTurnState(claudeTurnState(tail), ageMs, options);
}
