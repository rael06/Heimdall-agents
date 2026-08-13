import { ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A service of its own for each run: its own transcripts, its own port, and its
 * own shared directory — the tests must never touch the marks of the machine
 * they run on.
 */
export interface RunningService {
  url: string;
  home: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

interface Entry {
  type: string;
  timestamp?: string;
  cwd?: string;
  message?: unknown;
  customTitle?: string;
  aiTitle?: string;
}

function transcript(
  title: string,
  workspace: string,
  finished: boolean,
  /** A later generated title, as Claude writes when the subject drifts. */
  drifted?: string,
): string {
  const entries: Entry[] = [
    {
      type: 'user',
      timestamp: '2026-07-27T10:00:00.000Z',
      cwd: workspace,
      message: { role: 'user', content: [{ type: 'text', text: 'Start the work' }] },
    },
    { type: 'custom-title', customTitle: title },
  ];
  if (drifted) {
    entries.push({ type: 'ai-title', aiTitle: 'The first generated name' });
    entries.push({ type: 'ai-title', aiTitle: drifted });
  }
  // `stop_reason` is what the real transcripts carry on every assistant entry,
  // and it is what says whether the turn is over. A fixture without it would be
  // exercising a file shape that does not exist on disk.
  if (finished) {
    entries.push({
      type: 'assistant',
      timestamp: '2026-07-27T10:05:00.000Z',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'All done.' }],
      },
    });
  } else {
    entries.push({
      type: 'assistant',
      timestamp: '2026-07-27T10:05:00.000Z',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: {} }],
      },
    });
  }
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

/**
 * Ends the turn of the session left mid-tool, by appending what the CLI would
 * have written. The service is watching, so this is a real status change
 * arriving through `fs.watch` rather than a simulated one.
 */
export async function finishRunningSession(home: string): Promise<void> {
  const file = path.join(
    home,
    'claude',
    'projects',
    'c--Users-dev-projects-app',
    '22222222-2222-2222-2222-222222222222.jsonl',
  );
  const entry = {
    type: 'assistant',
    timestamp: '2026-07-27T10:06:00.000Z',
    message: {
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'The test was a race.' }],
    },
  };
  await fs.appendFile(file, `\n${JSON.stringify(entry)}`);
}

const SITE_SESSION = path.join(
  'claude',
  'projects',
  'c--Users-dev-projects-site',
  '33333333-3333-3333-3333-333333333333.jsonl',
);

async function append(home: string, entry: unknown): Promise<void> {
  await fs.appendFile(path.join(home, SITE_SESSION), `\n${JSON.stringify(entry)}`);
}

/**
 * Puts the finished session in the other project back to work.
 *
 * A session only becomes unseen by stopping, so producing one to acknowledge
 * means moving it through both states. Split in two so the caller can wait for
 * the first to be observed before asking for the second: the service has to see
 * the session running, or the stop is a transition from idle to idle and no
 * marker lights.
 */
export async function startSiteSession(home: string): Promise<void> {
  await append(home, {
    type: 'assistant',
    timestamp: '2026-07-27T11:00:00.000Z',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'call-2', name: 'Bash', input: {} }],
    },
  });
}

/** Ends that turn, which is what leaves something on the row you have not seen. */
export async function stopSiteSession(home: string): Promise<void> {
  await append(home, {
    type: 'assistant',
    timestamp: '2026-07-27T11:01:00.000Z',
    message: {
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Finished the second pass.' }],
    },
  });
}

export async function startService(): Promise<RunningService> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'asm-e2e-'));
  const project = path.join(home, 'claude', 'projects', 'c--Users-dev-projects-app');
  const other = path.join(home, 'claude', 'projects', 'c--Users-dev-projects-site');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(other, { recursive: true });
  await fs.mkdir(path.join(home, 'codex'), { recursive: true });
  await fs.mkdir(path.join(home, 'shared'), { recursive: true });

  await fs.writeFile(
    path.join(project, '11111111-1111-1111-1111-111111111111.jsonl'),
    transcript('Refactor the importer', 'c:\\Users\\dev\\projects\\app', true),
  );
  await fs.writeFile(
    path.join(project, '22222222-2222-2222-2222-222222222222.jsonl'),
    transcript('Chase a flaky test', 'c:\\Users\\dev\\projects\\app', false),
  );
  await fs.writeFile(
    path.join(other, '33333333-3333-3333-3333-333333333333.jsonl'),
    transcript(
      'Rewrite the landing page',
      'c:\\Users\\dev\\projects\\site',
      true,
      'Argue about the hero image',
    ),
  );

  const port = await freePort();
  const child: ChildProcess = spawn(
    process.execPath,
    [
      path.join('dist', 'cli', 'main.js'),
      'serve',
      '--port',
      String(port),
      '--claude-home',
      path.join(home, 'claude'),
      '--codex-home',
      path.join(home, 'codex'),
      '--shared-dir',
      path.join(home, 'shared'),
      '--history-days',
      '0',
      // Old transcripts: without this they would all age into "unknown".
      '--stale-after',
      '5256000',
      // The tests must never raise a toast on the machine running them, the way
      // they never touch its marks.
      '--notify=false',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Service did not start:\n${output}`)), 20000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);
      if (found) {
        clearTimeout(timer);
        resolve(found[0]);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Service exited with ${code}:\n${output}`));
    });
  });

  return {
    url,
    home,
    stop: async () => {
      child.kill();
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
