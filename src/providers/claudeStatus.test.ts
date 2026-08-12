import { describe, expect, it } from 'vitest';
import { inferClaudeStatus } from './claudeStatus';
import { ScanOptions } from './provider';

const options: ScanOptions = {
  now: Date.now(),
  staleAfterMs: 3 * 60 * 60 * 1000,
  historyMs: 0,
  maxSessions: 100,
};

const FRESH = 1_000;
const IDLE = 10 * 60 * 1000;
const OLD = 24 * 60 * 60 * 1000;

/**
 * Assistant entries carry `stop_reason` exactly as the Messages API defines it,
 * because the real transcripts do: measured over 60 files and 26 911 assistant
 * entries, every one of them had the field, `tool_use` 24 689 times, `end_turn`
 * 1 127, null 1 083 and `stop_sequence` 12. A fixture without it would be
 * testing a file shape that does not exist on disk.
 */
function assistantText(text: string, stop: string | null = 'end_turn') {
  return {
    type: 'assistant',
    message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text }] },
  };
}

function assistantTool(name: string) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name, input: {} }],
    },
  };
}

function userText(text: string) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
}

function toolResult(text: string) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: text }] },
  };
}

describe('inferClaudeStatus', () => {
  it('goes idle on a finished turn', () => {
    expect(inferClaudeStatus([userText('hi'), assistantText('here')], OLD, options).status).toBe(
      'idle',
    );
  });

  it('reads a final answer that asks something as the same thing: it stopped', () => {
    // No longer a status of its own. The model ended its turn, so the next move
    // is yours either way, and no text is searched for a question mark.
    const tail = [assistantText('Report ready.\n\nWhich option do you want, 1, 2 or 3?')];
    expect(inferClaudeStatus(tail, OLD, options).status).toBe('idle');
  });

  it('goes back to running when a new request arrives', () => {
    const tail = [assistantText('here'), userText('one more thing')];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
  });

  it('goes idle on a question left unanswered, however long it waits', () => {
    // The turn is open, but the model is not working: it stopped to ask. Codex
    // has no such tool and ends its turn to ask instead, so both providers
    // reach the same state by their own means.
    const tail = [assistantTool('AskUserQuestion')];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('idle');
    expect(inferClaudeStatus(tail, IDLE, options).status).toBe('idle');
    expect(inferClaudeStatus(tail, OLD, options).status).toBe('idle');
  });

  it('never turns a long tool call into a pending permission', () => {
    // The whole reason this file was rewritten. A command that takes four
    // minutes and a permission waiting on screen write the same thing to the
    // transcript — nothing — so a delay cannot tell them apart, and calling the
    // long one "waiting for you" is a false alarm on every slow command.
    const tail = [assistantTool('Bash')];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
    expect(inferClaudeStatus(tail, IDLE, options).status).toBe('running');
    expect(inferClaudeStatus(tail, OLD, options).status).toBe('unknown');
  });

  it('reads an answer still being streamed as work in progress', () => {
    // "null in the message_start event": the entry is the answer being written
    // right now. This is what keeps a long thinking phase from looking finished.
    const tail = [assistantText('Let me think', null)];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
    expect(inferClaudeStatus(tail, IDLE, options).status).toBe('running');
  });

  it('reads a paused turn as still going', () => {
    // "we paused a long-running turn": the model has more to say.
    const tail = [assistantText('part one', 'pause_turn')];
    expect(inferClaudeStatus(tail, IDLE, options).status).toBe('running');
  });

  it('reports a failure on a turn cut short by the context window', () => {
    expect(inferClaudeStatus([assistantText('half an ans', 'max_tokens')], OLD, options).status).toBe(
      'failed',
    );
  });

  it('reports a failure on a refusal', () => {
    expect(inferClaudeStatus([assistantText('', 'refusal')], OLD, options).status).toBe('failed');
  });

  it('treats a custom stop sequence as a finished turn', () => {
    expect(inferClaudeStatus([assistantText('done', 'stop_sequence')], OLD, options).status).toBe(
      'idle',
    );
  });

  it('falls back to the content when nothing states why the model stopped', () => {
    // Never seen on disk, but a format that dropped the field must not make
    // every session look like an answer being written forever.
    const bare = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } };
    expect(inferClaudeStatus([bare], OLD, options).status).toBe('idle');
  });

  it('goes back to running after a tool result', () => {
    const tail = [assistantTool('Bash'), toolResult('ok')];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
  });

  it('reports a failure on an explicit interruption', () => {
    const tail = [assistantTool('Bash'), toolResult('[Request interrupted by user]')];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('failed');
  });

  it('reports a failure on an API error', () => {
    const tail = [{ type: 'user', isApiErrorMessage: true, message: { content: 'API Error' } }];
    expect(inferClaudeStatus(tail, FRESH, options).status).toBe('failed');
  });

  it('skips bookkeeping entries and unknown events', () => {
    const tail = [
      assistantText('done'),
      { type: 'ai-title', aiTitle: 'Title' },
      { type: 'file-history-snapshot' },
      { type: 'some-future-unknown-event' },
    ];
    expect(inferClaudeStatus(tail, OLD, options).status).toBe('idle');
  });

  /**
   * A turn can end while something it started keeps going: the harness runs the
   * task and wakes the session when it finishes. The transcript said `end_turn`
   * and the session read as *idle* — "nothing more happens without you" — which
   * was the one case where that sentence is false.
   */
  describe('a background task outliving the turn that started it', () => {
    const launch = (id: string, description: string, input: Record<string, unknown> = {}) => ({
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id,
            name: 'Bash',
            input: { command: 'npm run dist', description, run_in_background: true, ...input },
          },
        ],
      },
    });

    /**
     * Written as a `queue-operation`, which is exactly the entry type the
     * conversation walk skips as bookkeeping — the reason this went unnoticed.
     */
    const notified = (id: string, status: string) => ({
      type: 'queue-operation',
      operation: 'enqueue',
      content: [
        '<task-notification>',
        '<task-id>bnuny9zh2</task-id>',
        `<tool-use-id>${id}</tool-use-id>`,
        `<status>${status}</status>`,
        '<summary>Background command "Build the installer" completed</summary>',
        '</task-notification>',
      ].join('\n'),
    });

    it('is running, and says which task', () => {
      const tail = [launch('toolu_1', 'Build the installer'), assistantText('Started the build.')];
      const verdict = inferClaudeStatus(tail, FRESH, options);
      expect(verdict.status).toBe('running');
      expect(verdict.reason).toContain('Build the installer');
    });

    it('goes idle rather than inconclusive once the file has gone cold', () => {
      // A task belongs to the process that launched it. Nothing written for a
      // day says that process is gone, so the turn did end after all. Reading it
      // as inconclusive would have turned 43 finished sessions on this machine
      // from idle into unknown, which is why this case is measured, not assumed.
      const tail = [launch('toolu_1', 'Build the installer'), assistantText('Started the build.')];
      expect(inferClaudeStatus(tail, OLD, options).status).toBe('idle');
    });

    it('is over once the notification pairs with it', () => {
      const tail = [
        launch('toolu_1', 'Build the installer'),
        notified('toolu_1', 'completed'),
        assistantText('The build is done.'),
      ];
      expect(inferClaudeStatus(tail, FRESH, options).status).toBe('idle');
    });

    it('is not ended by a progress ping', () => {
      // `running` is a status a notification really carries, and reading it as
      // an ending would clear a task that is still going.
      const tail = [
        launch('toolu_1', 'Build the installer'),
        notified('toolu_1', 'running'),
        assistantText('Still building.'),
      ];
      expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
    });

    it('pairs by identifier, so another task ending does not clear this one', () => {
      const tail = [
        launch('toolu_1', 'Build the installer'),
        notified('toolu_2', 'completed'),
        assistantText('One of them finished.'),
      ];
      expect(inferClaudeStatus(tail, FRESH, options).status).toBe('running');
    });

    it('counts an Agent unless it was told not to run in the background', () => {
      const agent = (background: boolean) => ({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_9',
              name: 'Agent',
              input: background ? { description: 'Sweep the tests' } : { run_in_background: false },
            },
          ],
        },
      });
      expect(inferClaudeStatus([agent(true), assistantText('off it goes')], FRESH, options).status)
        .toBe('running');
      expect(inferClaudeStatus([agent(false), assistantText('done')], FRESH, options).status)
        .toBe('idle');
    });

    it('leaves a turn that stopped to ask you something alone', () => {
      // Waiting on you outranks a task ticking over: the session cannot move
      // either way until you answer.
      const tail = [
        launch('toolu_1', 'Build the installer'),
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'toolu_2', name: 'AskUserQuestion', input: {} }],
          },
        },
      ];
      expect(inferClaudeStatus(tail, FRESH, options).status).toBe('idle');
    });
  });

  it('stays unknown when nothing is usable', () => {
    expect(inferClaudeStatus([{ type: 'queue-operation' }], FRESH, options).status).toBe('unknown');
    expect(inferClaudeStatus([], FRESH, options).status).toBe('unknown');
  });
});
