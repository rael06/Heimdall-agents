import { AgentSession, SessionStatus } from '../model/types';
import { ParsedArgs, UsageError, unknownOptions } from './args';
import { buildStore } from './context';
import { formatClock, renderRows, shortId, workspaceLabel } from './format';
import { renderTable, reportProviderStates } from './list';
import { write } from './output';
import { QUERY_OPTIONS, filtersFrom, resolveWorkspaces, sortFrom } from './query';
import { SETTINGS_OPTIONS, settingsFrom } from './settings';

/** What is remembered of a session between two scans. */
export interface Seen {
  status: SessionStatus;
}

export type Change =
  | { kind: 'appeared'; session: AgentSession }
  | { kind: 'status'; session: AgentSession; from: SessionStatus };

/**
 * Sessions that appeared, and statuses that moved. A session leaving the history
 * window is deliberately not reported: it says nothing about the session, only
 * about the window, and it would drown the changes that matter.
 */
export function diffSessions(
  seen: Map<string, Seen>,
  sessions: readonly AgentSession[],
): Change[] {
  const changes: Change[] = [];
  for (const session of sessions) {
    const known = seen.get(session.id);
    if (!known) {
      changes.push({ kind: 'appeared', session });
    } else if (known.status !== session.status) {
      changes.push({ kind: 'status', session, from: known.status });
    }
  }
  return changes;
}

export function remember(sessions: readonly AgentSession[]): Map<string, Seen> {
  return new Map(sessions.map((session) => [session.id, { status: session.status }]));
}

export function renderChange(change: Change, atMs: number): string {
  const { session } = change;
  const transition =
    change.kind === 'appeared' ? `new ${session.status}` : `${change.from} -> ${session.status}`;
  return renderRows([
    [formatClock(atMs), shortId(session), transition, workspaceLabel(session.cwd), session.title],
  ])[0];
}

/**
 * The timer is deliberately not unref'd: between two scans it is the only thing
 * keeping the event loop alive, and an unref'd one lets the process exit right
 * after the first list — which it did.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function watch(args: ParsedArgs): Promise<number> {
  const unknown = unknownOptions(args, [...SETTINGS_OPTIONS, ...QUERY_OPTIONS]);
  if (unknown.length) {
    throw new UsageError(
      `Unknown option(s) for \`asm watch\`: ${unknown.map((n) => `--${n}`).join(', ')}`,
    );
  }
  if (args.options.has('json')) {
    throw new UsageError('`asm watch` prints a live log; use `asm list --json` for a snapshot.');
  }

  const settings = settingsFrom(args);
  const store = buildStore(settings);
  const sort = sortFrom(args);

  const first = await store.refresh();
  const workspaces = resolveWorkspaces(args, first.sessions);
  const filters = filtersFrom(args, workspaces);
  const { matches } = await store.query(filters, sort);
  for (const line of renderTable(matches)) {
    write(line);
  }
  reportProviderStates(first, matches.length);
  write();
  write(`Watching every ${settings.refreshIntervalMs / 1000}s. Ctrl-C to stop.`);

  let seen = remember(matches.map((match) => match.session));
  // Polling, not `fs.watch`: watching the transcript roots is what M2 brings,
  // together with the service that will own it.
  for (;;) {
    await sleep(settings.refreshIntervalMs);
    await store.refresh();
    const current = await store.query(filters, sort);
    const sessions = current.matches.map((match) => match.session);
    for (const change of diffSessions(seen, sessions)) {
      write(renderChange(change, Date.now()));
    }
    seen = remember(sessions);
  }
}
