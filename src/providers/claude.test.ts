import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSessionProvider } from './claude';
import { ScanOptions } from './provider';

const options: ScanOptions = {
  now: Date.now(),
  staleAfterMs: 3 * 60 * 60 * 1000,
  historyMs: 0,
  maxSessions: 100,
};

let home: string;

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-provider-'));
  const project = path.join(home, 'projects', 'c--Users-dev-projects-app');
  await fs.mkdir(project, { recursive: true });

  // The agent starts in the workspace, then works in sub folders, which is what
  // makes the last recorded directory the wrong answer.
  const entries = [
    {
      type: 'user',
      timestamp: '2026-07-27T10:00:00.000Z',
      cwd: 'c:\\Users\\dev\\projects\\app',
      message: { role: 'user', content: [{ type: 'text', text: 'Start the work' }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-07-27T10:05:00.000Z',
      cwd: 'C:\\Users\\dev\\projects\\app\\packages\\api',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    },
  ];
  await fs.writeFile(
    path.join(project, 'session-1.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n'),
    'utf8',
  );

  // A renamed session, whose rename is followed by more conversation: the entry
  // is written once and must still be found.
  const renamed = [
    {
      type: 'user',
      timestamp: '2026-07-27T10:00:00.000Z',
      cwd: 'C:\\Users\\dev\\projects\\app',
      message: { role: 'user', content: [{ type: 'text', text: 'Start' }] },
    },
    { type: 'ai-title', aiTitle: 'A generated title' },
    { type: 'custom-title', customTitle: 'The name I typed' },
    ...Array.from({ length: 120 }, (_, index) => ({
      type: 'assistant',
      timestamp: '2026-07-27T10:10:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: `Step ${index}` }] },
    })),
  ];
  await fs.writeFile(
    path.join(project, 'session-2.jsonl'),
    renamed.map((entry) => JSON.stringify(entry)).join('\n'),
    'utf8',
  );
});

afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('ClaudeSessionProvider', () => {
  it('reports the folder the session started in, not the last one it visited', async () => {
    const provider = new ClaudeSessionProvider(home);
    const { sessions } = await provider.scan(options);

    expect(sessions).toHaveLength(2);
    const session = sessions.find((item) => item.nativeId === 'session-1');
    expect(session?.cwd).toBe('C:\\Users\\dev\\projects\\app');
  });

  it('takes the title from the first user message when no title was generated', async () => {
    const provider = new ClaudeSessionProvider(home);
    const { sessions } = await provider.scan(options);
    const session = sessions.find((item) => item.nativeId === 'session-1');
    expect(session?.title).toBe('Start the work');
  });

  it('prefers a title the user typed over the generated one, long after the rename', async () => {
    const provider = new ClaudeSessionProvider(home);
    const { sessions } = await provider.scan(options);
    const session = sessions.find((item) => item.nativeId === 'session-2');
    expect(session?.title).toBe('The name I typed');
  });
});

describe('ClaudeSessionProvider renamed sessions', () => {
  let root: string;
  let file: string;
  let index: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-rename-'));
    index = path.join(root, 'titles.json');
    const project = path.join(root, 'projects', 'c--ws');
    await fs.mkdir(project, { recursive: true });
    file = path.join(project, 'long.jsonl');

    // A rename, then enough conversation to push it out of both the head and the
    // 256 KB the tail read covers. This is the case that kept showing the old
    // title: the entry is written once and never repeated.
    const padding = 'x'.repeat(4096);
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-07-27T10:00:00.000Z',
        cwd: 'C:\\ws',
        message: { role: 'user', content: [{ type: 'text', text: 'Open a worktree' }] },
      }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Initialise a worktree and open a PR' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Worktree feature-42' }),
      ...Array.from({ length: 200 }, (_, step) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-07-27T11:00:00.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: `${step} ${padding}` }] },
        }),
      ),
    ];
    await fs.writeFile(file, lines.join('\n'), 'utf8');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds a rename buried under later activity', async () => {
    // The fixture has to be past the tail window for this test to mean anything.
    expect((await fs.stat(file)).size).toBeGreaterThan(256 * 1024);

    const provider = new ClaudeSessionProvider(root, index);
    const { sessions } = await provider.scan(options);
    expect(sessions[0].title).toBe('Worktree feature-42');
  });

  it('shares what it found, so the history is read in full only once', async () => {
    await new ClaudeSessionProvider(root, index).scan(options);

    // Another window, its own provider, the same index on disk.
    const other = new ClaudeSessionProvider(root, index);
    const { sessions } = await other.scan(options);
    expect(sessions[0].title).toBe('Worktree feature-42');

    const stored = JSON.parse(await fs.readFile(index, 'utf8'));
    expect(stored.entries[file].custom).toBe('Worktree feature-42');
    expect(stored.entries[file].scannedBytes).toBe((await fs.stat(file)).size);
  });

  it('picks up a rename appended to a session already known', async () => {
    const provider = new ClaudeSessionProvider(root, index);
    await provider.scan(options);

    await fs.appendFile(
      file,
      `\n${JSON.stringify({ type: 'custom-title', customTitle: 'Renamed again' })}`,
      'utf8',
    );
    const { sessions } = await provider.scan({ ...options, now: Date.now() });
    expect(sessions[0].title).toBe('Renamed again');
  });
});

describe('ClaudeSessionProvider caching', () => {
  let root: string;
  let file: string;

  /** Rewrites the transcript, and only moves its mtime when asked to. */
  async function write(title: string, mtimeMs?: number): Promise<void> {
    const entries = [
      {
        type: 'user',
        timestamp: '2026-07-27T10:00:00.000Z',
        cwd: 'C:\\ws',
        message: { role: 'user', content: [{ type: 'text', text: title }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-07-27T10:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] },
      },
    ];
    await fs.writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
    if (mtimeMs !== undefined) {
      const date = new Date(mtimeMs);
      await fs.utimes(file, date, date);
    }
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cache-'));
    const project = path.join(root, 'projects', 'c--ws');
    await fs.mkdir(project, { recursive: true });
    file = path.join(project, 'cached.jsonl');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('serves a transcript that really did not change without reading it again', async () => {
    const provider = new ClaudeSessionProvider(root);
    await write('First title', 1_000_000);
    expect((await provider.scan(options)).sessions[0].title).toBe('First title');

    // Same bytes, same clock: nothing happened, and re-reading would be waste.
    await write('First title', 1_000_000);
    expect((await provider.scan(options)).sessions[0].title).toBe('First title');

    await write('Second title', 2_000_000);
    expect((await provider.scan(options)).sessions[0].title).toBe('Second title');
  });

  it('re-reads a file whose clock stood still while its content grew', async () => {
    // This is the bug that shipped: Windows does not move the modification time
    // while the writing process holds the file open, and both CLIs keep their
    // transcript open for the whole session. Measured on a real Codex rollout —
    // the file claimed 00:39:41 while its last line was written at 00:39:49, so
    // a finished turn was served as *running* for as long as the session lived.
    const provider = new ClaudeSessionProvider(root);
    await write('Frozen clock', 3_000_000);
    expect((await provider.scan(options)).sessions[0].title).toBe('Frozen clock');

    await write('Frozen clock but longer', 3_000_000);
    expect((await provider.scan(options)).sessions[0].title).toBe('Frozen clock but longer');
  });

  it('ages a session that nobody wrote to, without reading it again', async () => {
    const provider = new ClaudeSessionProvider(root);
    const now = Date.now();
    await write('Working', now);

    const running = await provider.scan({ ...options, now });
    expect(running.sessions[0].status).toBe('running');

    // Not a byte was written, and ten minutes of silence is not evidence of
    // anything: a build takes that long. It is still running.
    const later = await provider.scan({ ...options, now: now + 10 * 60 * 1000 });
    expect(later.sessions[0].status).toBe('running');

    // A day of it is another matter — not because the session is waiting, but
    // because nothing in the file can be trusted to still describe it.
    const muchLater = await provider.scan({ ...options, now: now + 24 * 3600 * 1000 });
    expect(muchLater.sessions[0].status).toBe('unknown');
  });

  it('only reads the sessions it was asked to follow', async () => {
    const provider = new ClaudeSessionProvider(root);
    await write('Before', 3_000_000);
    const first = await provider.scan(options);
    const id = first.sessions[0].id;

    await write('After', 4_000_000);
    const skipped = await provider.scan({ ...options, focusIds: new Set(['claude:other']) });
    expect(skipped.sessions[0].title).toBe('Before');

    const followed = await provider.scan({ ...options, focusIds: new Set([id]) });
    expect(followed.sessions[0].title).toBe('After');
  });
});
