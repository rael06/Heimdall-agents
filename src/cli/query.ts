import {
  AgentSession,
  DEFAULT_SORT,
  MATCH_MODES,
  SEARCH_SCOPES,
  SORT_OPTIONS,
  STATUS_ORDER,
  SessionFilters,
  SortOption,
  normalizeSort,
} from '../model/types';
import { ParsedArgs, UsageError, manyOf, oneOf, value, values } from './args';

export const QUERY_OPTIONS = [
  'query',
  'scope',
  'status',
  'workspace',
  'created-from',
  'created-to',
  'sort',
  'match',
  'json',
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(args: ParsedArgs, name: string): string | undefined {
  const raw = value(args, name);
  if (raw === undefined) {
    return undefined;
  }
  if (!DAY.test(raw)) {
    throw new UsageError(`--${name} expects a YYYY-MM-DD date, got "${raw}".`);
  }
  return raw;
}

/**
 * The provider filter is deliberately absent: `--provider` already restricts
 * what is scanned, and filtering afterwards on the same flag would be a second
 * way to say the same thing.
 */
export function filtersFrom(args: ParsedArgs, workspaces: string[]): SessionFilters {
  return {
    query: value(args, 'query') ?? '',
    scope: oneOf(args, 'scope', SEARCH_SCOPES, 'both'),
    statuses: manyOf(args, 'status', STATUS_ORDER),
    providers: [],
    workspaces,
    favoritesOnly: false,
    watchedOnly: false,
    createdFrom: day(args, 'created-from'),
    createdTo: day(args, 'created-to'),
    match: oneOf(args, 'match', MATCH_MODES, 'all'),
  };
}

/** Accepts the names earlier versions wrote, so an existing alias keeps working. */
export function sortFrom(args: ParsedArgs): SortOption {
  const raw = value(args, 'sort');
  if (raw === undefined) {
    return DEFAULT_SORT;
  }
  const normalized = normalizeSort(raw);
  if (normalized === DEFAULT_SORT && raw !== DEFAULT_SORT && raw !== 'created-desc') {
    throw new UsageError(
      `--sort expects one of ${SORT_OPTIONS.join(', ')}, got "${raw}".`,
    );
  }
  return normalized;
}

/**
 * The filter matches a workspace path exactly, which is unusable from a shell.
 * `--workspace` therefore takes a fragment and resolves it against the paths the
 * scan actually found. A fragment matching nothing is an error: silently
 * resolving to no path would mean "every workspace", which is the opposite of
 * what was asked.
 */
export function resolveWorkspaces(args: ParsedArgs, sessions: readonly AgentSession[]): string[] {
  const fragments = values(args, 'workspace').map((fragment) => fragment.toLowerCase());
  if (!fragments.length) {
    return [];
  }
  const known = [...new Set(sessions.map((session) => session.cwd).filter((cwd): cwd is string => !!cwd))];
  const resolved = new Set<string>();
  for (const fragment of fragments) {
    const matches = known.filter((cwd) => cwd.toLowerCase().includes(fragment));
    if (!matches.length) {
      throw new UsageError(`--workspace "${fragment}" matches none of the listed workspaces.`);
    }
    for (const match of matches) {
      resolved.add(match);
    }
  }
  return [...resolved];
}

export type Resolution =
  | { kind: 'found'; session: AgentSession }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: AgentSession[] };

/**
 * Names a session the way git names a commit: the full identifier, the native
 * one, or any unambiguous prefix of it. An ambiguous prefix is reported rather
 * than resolved to the first hit, since acting on the wrong session is silent.
 */
export function resolveSession(sessions: readonly AgentSession[], needle: string): Resolution {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) {
    return { kind: 'none' };
  }
  const exact = sessions.find(
    (session) => session.id.toLowerCase() === wanted || session.nativeId.toLowerCase() === wanted,
  );
  if (exact) {
    return { kind: 'found', session: exact };
  }
  const candidates = sessions.filter((session) => session.nativeId.toLowerCase().startsWith(wanted));
  if (!candidates.length) {
    return { kind: 'none' };
  }
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates };
  }
  return { kind: 'found', session: candidates[0] };
}
