import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodexSessionProvider, parseRolloutFileName } from './codex';
import { ScanOptions } from './provider';

/**
 * The Claude provider has had fixtures since it was written; this one had two
 * tests for a file-name regex, against 414 lines. "One behaviour, whatever the
 * provider" is a rule this project holds itself to, and it was held by tests on
 * one side only.
 */

const options: ScanOptions = {
  now: Date.parse('2026-07-27T14:00:00.000Z'),
  staleAfterMs: 30 * 60 * 1000,
  historyMs: 0,
  maxSessions: 100,
};

const meta = (extra: Record<string, unknown> = {}) => ({
  type: 'session_meta',
  timestamp: '2026-07-27T13:35:38.000Z',
  payload: { session_id: 'thread-app', cwd: 'C:\\Users\\dev\\projects\\app', ...extra },
});

const userMessage = (message: string, timestamp = '2026-07-27T13:36:00.000Z') => ({
  type: 'event_msg',
  timestamp,
  payload: { type: 'user_message', message },
});

const event = (type: string, timestamp = '2026-07-27T13:50:00.000Z') => ({
  type: 'event_msg',
  timestamp,
  payload: { type },
});

const responseItem = (type: string, extra: Record<string, unknown> = {}) => ({
  type: 'response_item',
  timestamp: '2026-07-27T13:50:00.000Z',
  payload: { type, ...extra },
});

let home: string;

async function rollout(name: string, entries: unknown[]): Promise<string> {
  const day = path.join(home, 'sessions', '2026', '07', '27');
  await fs.mkdir(day, { recursive: true });
  const file = path.join(day, name);
  await fs.writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
  return file;
}

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-provider-'));

  // Finished: the turn ended on task_complete.
  await rollout('rollout-2026-07-27T13-35-38-thread-app.jsonl', [
    meta(),
    userMessage('Refactor the importer'),
    event('task_started'),
    event('task_complete'),
  ]);

  // Still working: a tool call with no output after it.
  await rollout('rollout-2026-07-27T13-40-00-thread-busy.jsonl', [
    meta({ session_id: 'thread-busy', cwd: 'C:\\Users\\dev\\projects\\site' }),
    userMessage('Chase a flaky test', '2026-07-27T13:41:00.000Z'),
    event('task_started', '2026-07-27T13:41:00.000Z'),
    responseItem('function_call', { call_id: 'call-1' }),
  ]);

  // A sub-agent transcript belonging to thread-app. It carries the parent's
  // thread id, which is how the two are grouped back together.
  await rollout('rollout-2026-07-27T13-45-00-sub-1.jsonl', [
    meta({ session_id: 'thread-app', parent_thread_id: 'thread-app', thread_source: 'subagent' }),
    userMessage('Do the sub task', '2026-07-27T13:45:00.000Z'),
    event('task_complete', '2026-07-27T13:46:00.000Z'),
  ]);

  // An orphan: a sub-agent whose parent thread is nowhere in scope. This is the
  // one `includeSubagents` decides about — it never splits a sub-agent away
  // from a parent that is present.
  await rollout('rollout-2026-07-27T13-47-00-thread-orphan.jsonl', [
    meta({
      session_id: 'thread-orphan',
      parent_thread_id: 'thread-long-gone',
      thread_source: 'subagent',
    }),
    userMessage('Work with no parent in sight', '2026-07-27T13:47:00.000Z'),
    event('task_complete', '2026-07-27T13:48:00.000Z'),
  ]);

  // A human name for one thread, and none for the other.
  await fs.writeFile(
    path.join(home, 'session_index.jsonl'),
    JSON.stringify({ id: 'thread-app', thread_name: 'The importer work' }),
    'utf8',
  );
});

afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
});

describe('parseRolloutFileName', () => {
  it('extracts the session id and the creation date', () => {
    const parsed = parseRolloutFileName(
      'rollout-2026-07-27T13-35-38-019fa35b-eb9b-7002-a6cf-8c7a67429d26.jsonl',
    );
    expect(parsed.id).toBe('019fa35b-eb9b-7002-a6cf-8c7a67429d26');
    expect(parsed.createdAtMs).toBe(Date.parse('2026-07-27T13:35:38'));
  });

  it('returns nothing for an unexpected file name', () => {
    expect(parseRolloutFileName('session.jsonl')).toEqual({});
  });
});

describe('CodexSessionProvider.scan', () => {
  it('finds the rollouts nested under year, month and day', async () => {
    const { sessions, state } = await new CodexSessionProvider(home).scan(options);
    expect(state.available).toBe(true);
    expect(state.error).toBeUndefined();
    // The sub-agent is folded into its parent rather than listed on its own.
    expect(sessions.map((session) => session.id).sort()).toEqual([
      'codex:thread-app',
      'codex:thread-busy',
    ]);
  });

  it('reads the workspace out of the session meta', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan(options);
    const app = sessions.find((session) => session.id === 'codex:thread-app');
    expect(app?.cwd?.toLowerCase()).toContain('projects');
    expect(app?.provider).toBe('codex');
    expect(app?.nativeId).toBe('thread-app');
  });

  it('prefers the name from the index over the first prompt', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan(options);
    expect(sessions.find((s) => s.id === 'codex:thread-app')?.title).toBe('The importer work');
    // No index entry, so the first genuine user message names it.
    expect(sessions.find((s) => s.id === 'codex:thread-busy')?.title).toBe('Chase a flaky test');
  });

  it('grades a completed turn and an open one differently', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan(options);
    expect(sessions.find((s) => s.id === 'codex:thread-app')?.status).toBe('idle');
    // Written minutes ago with a tool call still outstanding.
    expect(sessions.find((s) => s.id === 'codex:thread-busy')?.status).toBe('running');
  });

  it('says a thread carries sub-agent transcripts, in its reason', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan(options);
    const app = sessions.find((session) => session.id === 'codex:thread-app');
    expect(app?.statusReason).toMatch(/sub-agent transcript/);
  });

  it('drops a sub-agent whose parent is nowhere in scope, by default', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan(options);
    expect(sessions.map((session) => session.id)).not.toContain('codex:thread-orphan');
  });

  it('keeps that orphan when asked to, rather than losing it silently', async () => {
    // This is what `includeSubagents` decides, and only this: a sub-agent whose
    // parent *is* present is always folded into it.
    const { sessions } = await new CodexSessionProvider(home, true).scan(options);
    expect(sessions.map((session) => session.id)).toContain('codex:thread-orphan');
    expect(sessions.map((session) => session.id)).toContain('codex:thread-app');
  });

  it('reports a missing home rather than throwing', async () => {
    const provider = new CodexSessionProvider(path.join(home, 'nowhere'));
    const { sessions, state } = await provider.scan(options);
    expect(sessions).toEqual([]);
    expect(state.available).toBe(false);
    // Nothing to read is not an error to shout about.
    expect(state.error).toBeUndefined();
  });

  it('caps what it returns and says how much it left out', async () => {
    const { sessions, truncated } = await new CodexSessionProvider(home).scan({
      ...options,
      maxSessions: 1,
    });
    expect(sessions).toHaveLength(1);
    expect(truncated).toBe(1);
  });

  it('drops everything older than the history window', async () => {
    const { sessions } = await new CodexSessionProvider(home).scan({
      ...options,
      now: Date.parse('2027-01-01T00:00:00.000Z'),
      historyMs: 24 * 60 * 60 * 1000,
    });
    expect(sessions).toEqual([]);
  });
});

describe('CodexSessionProvider.matchesContent', () => {
  it('matches a term in the thread transcript', async () => {
    const provider = new CodexSessionProvider(home);
    const { sessions } = await provider.scan(options);
    const app = sessions.find((session) => session.id === 'codex:thread-app')!;
    expect(await provider.matchesContent(app, ['importer'])).toBe(true);
    expect(await provider.matchesContent(app, ['nothing-in-here'])).toBe(false);
  });

  it('reaches into a sub-agent transcript, not only the primary one', async () => {
    const provider = new CodexSessionProvider(home);
    const { sessions } = await provider.scan(options);
    const app = sessions.find((session) => session.id === 'codex:thread-app')!;
    // "Do the sub task" is written only in the sub-agent's file.
    expect(await provider.matchesContent(app, ['sub task'])).toBe(true);
  });

  it('knows nothing about a session it never scanned', async () => {
    const provider = new CodexSessionProvider(home);
    const stranger = { id: 'codex:never-seen' } as Parameters<typeof provider.matchesContent>[0];
    expect(await provider.matchesContent(stranger, ['anything'])).toBe(false);
  });
});
