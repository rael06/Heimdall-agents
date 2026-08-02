import { SessionMatch, SessionSnapshot } from '../model/types';
import { ParsedArgs, UsageError, unknownOptions } from './args';
import { buildStore } from './context';
import { formatDate, renderRows, shortId, workspaceLabel } from './format';
import { write, writeError } from './output';
import { QUERY_OPTIONS, filtersFrom, resolveWorkspaces, sortFrom } from './query';
import { SETTINGS_OPTIONS, settingsFrom } from './settings';

const HEADER = ['ID', 'STATUS', 'CREATED', 'UPDATED', 'PROVIDER', 'WORKSPACE', 'TITLE'];

export function renderTable(matches: readonly SessionMatch[]): string[] {
  const rows = matches.map(({ session }) => [
    shortId(session),
    session.status,
    formatDate(session.createdAt),
    formatDate(session.updatedAt),
    session.provider,
    workspaceLabel(session.cwd),
    session.title,
  ]);
  return renderRows([HEADER, ...rows]);
}

/**
 * What went wrong, or what was left out — on stderr, so a pipe still carries
 * only the list. A provider that is missing or failed has to say so, and name
 * the directory it looked in: an empty list is otherwise indistinguishable from
 * a broken one.
 */
export function reportProviderStates(snapshot: SessionSnapshot, shown: number): void {
  for (const state of snapshot.providers) {
    if (state.error) {
      writeError(`${state.provider}: scan failed in ${state.root} — ${state.error}`);
    } else if (!state.available) {
      writeError(`${state.provider}: nothing found in ${state.root}`);
    }
  }
  if (snapshot.truncated > 0) {
    writeError(
      `${snapshot.truncated} session(s) left out by the history window or the session cap.`,
    );
  }
  if (shown === 0 && snapshot.sessions.length > 0) {
    writeError(`No session matches; ${snapshot.sessions.length} were scanned.`);
  }
}

function toJson(matches: readonly SessionMatch[], snapshot: SessionSnapshot): string {
  return JSON.stringify(
    {
      scannedAt: snapshot.scannedAt,
      truncated: snapshot.truncated,
      providers: snapshot.providers,
      sessions: matches.map(({ session, matchedOn }) => ({ ...session, matchedOn })),
    },
    null,
    2,
  );
}

export async function list(args: ParsedArgs): Promise<number> {
  const unknown = unknownOptions(args, [...SETTINGS_OPTIONS, ...QUERY_OPTIONS]);
  if (unknown.length) {
    throw new UsageError(`Unknown option(s) for \`asm list\`: ${unknown.map((n) => `--${n}`).join(', ')}`);
  }

  const settings = settingsFrom(args);
  const store = buildStore(settings);
  const snapshot = await store.refresh();
  const workspaces = resolveWorkspaces(args, snapshot.sessions);
  const { matches } = await store.query(filtersFrom(args, workspaces), sortFrom(args));

  if (args.options.has('json')) {
    write(toJson(matches, snapshot));
  } else {
    for (const line of renderTable(matches)) {
      write(line);
    }
  }
  reportProviderStates(snapshot, matches.length);
  return 0;
}
