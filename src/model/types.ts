/** Data model shared by the providers, the store and the view. */

export type ProviderId = 'claude' | 'codex';

/**
 * What a session can be, and nothing more.
 *
 * These four are the intersection of what every provider states in its own
 * transcript. Claude Code writes `stop_reason` on each assistant entry; Codex
 * pairs `task_started` with `task_complete`. Both therefore say whether a turn
 * is open, whether it closed cleanly, and whether it closed badly.
 *
 * There is deliberately no *needs action*. Neither provider writes a pending
 * permission anywhere — measured: 41 seconds passed between a tool starting and
 * a rejection with not one byte written in between, and Codex has zero approval
 * events across some 32 000. A status only one provider could support, or that
 * only a delay could produce, is a guess, and a guess raises false alarms.
 *
 * `idle` therefore means *not working*, not *succeeded*: a finished answer and
 * a question left unanswered are the same thing here — the model has stopped
 * and nothing more happens without you. Claude Code uses `idle_prompt` for the
 * same notion in its own notification events.
 *
 * Declaration order is not meaningful: display priority is {@link STATUS_ORDER}.
 */
export type SessionStatus = 'running' | 'failed' | 'idle' | 'unknown';

/** Display priority: running, failed, idle, unknown. */
export const STATUS_ORDER: SessionStatus[] = ['running', 'failed', 'idle', 'unknown'];

export function statusRank(status: SessionStatus): number {
  const rank = STATUS_ORDER.indexOf(status);
  return rank === -1 ? STATUS_ORDER.length : rank;
}

export interface AgentSession {
  /** Stable identifier, prefixed with the provider id. */
  id: string;
  provider: ProviderId;
  /** Identifier used by the provider itself. */
  nativeId: string;
  /**
   * The name the session keeps. Claude rewrites its generated title as the
   * subject drifts; this is the first one, because a name that changes under
   * you cannot be learned.
   */
  title: string;
  status: SessionStatus;
  /** Human readable explanation of the inferred status, shown in the tooltip. */
  statusReason: string;
  /** Session creation date (ISO). */
  createdAt: string;
  /** Last known activity date (ISO). */
  updatedAt: string;
  /** Working directory of the session, when known. */
  cwd?: string;
  /** Local transcript file. */
  filePath: string;
}

export type MatchField = 'title' | 'content';

export interface SessionMatch {
  session: AgentSession;
  /** Fields that produced the match; empty when no search is active. */
  matchedOn: MatchField[];
}

/** Where the search terms are looked up. */
export type SearchScope = 'both' | 'title' | 'content';

export const SEARCH_SCOPES: SearchScope[] = ['both', 'title', 'content'];

export interface SessionFilters {
  /** Free text search terms, combined with AND. */
  query: string;
  /** Fields the search applies to. */
  scope: SearchScope;
  /** Selected statuses. Empty means all. */
  statuses: SessionStatus[];
  /** Selected providers. Empty means all. */
  providers: ProviderId[];
  /** Selected workspace paths. Empty means all. */
  workspaces: string[];
  /** Restrict the list to the sessions the user starred. */
  favoritesOnly: boolean;
  /** Restrict the list to the sessions currently watched. */
  watchedOnly: boolean;
  /** Inclusive lower bound on the creation date (YYYY-MM-DD). */
  createdFrom?: string;
  /** Inclusive upper bound on the creation date (YYYY-MM-DD). */
  createdTo?: string;
  /**
   * How the active filters combine. The search is deliberately not part of it:
   * it narrows whatever the filters selected, since a search widened by an OR
   * would return sessions that do not contain what you typed.
   */
  match: MatchMode;
}

export const EMPTY_FILTERS: SessionFilters = {
  query: '',
  scope: 'both',
  statuses: [],
  providers: [],
  workspaces: [],
  favoritesOnly: false,
  watchedOnly: false,
  match: 'all',
};

/**
 * Markers a session can carry, independently of its status. A watched session is
 * also running, idle or failed: these are attention markers, not states of the
 * conversation, which is why they are not part of {@link SessionStatus}.
 */
export interface SessionMarks {
  /** Set automatically when a session becomes active, until dismissed. */
  watched: ReadonlySet<string>;
  /** Set by the user, and never automatically. */
  favorites: ReadonlySet<string>;
}

export const NO_MARKS: SessionMarks = { watched: new Set(), favorites: new Set() };

/**
 * Ordering applied to the result list, independently of the active filters.
 *
 * Every column sorts, both ways, so the header is a control rather than a
 * label. `status-asc` is the priority order — needs action first — because it
 * ascends the display rank rather than the alphabet.
 */
export type SortKey = 'status' | 'created' | 'updated' | 'provider' | 'workspace' | 'title';

export const SORT_KEYS: SortKey[] = [
  'status',
  'created',
  'updated',
  'provider',
  'workspace',
  'title',
];

export type SortOption = `${SortKey}-asc` | `${SortKey}-desc`;

export const SORT_OPTIONS: SortOption[] = SORT_KEYS.flatMap(
  (key): SortOption[] => [`${key}-asc`, `${key}-desc`],
);

export const DEFAULT_SORT: SortOption = 'created-desc';

/**
 * Accepts what earlier versions wrote. `status` and `title` had no direction,
 * and a bookmarked URL or a shell alias from before must not silently fall back
 * to the default ordering.
 */
export function normalizeSort(value: string | undefined): SortOption {
  if (!value) {
    return DEFAULT_SORT;
  }
  if (value === 'status' || value === 'title') {
    return `${value}-asc`;
  }
  return (SORT_OPTIONS as string[]).includes(value) ? (value as SortOption) : DEFAULT_SORT;
}

export function splitSort(sort: SortOption): { key: SortKey; ascending: boolean } {
  const ascending = sort.endsWith('-asc');
  return { key: sort.slice(0, sort.lastIndexOf('-')) as SortKey, ascending };
}

/**
 * How the active filters combine. `all` is the usual reading — every condition
 * has to hold. `any` widens instead of narrowing, which is what you want to ask
 * "what is running, or anything at all on webshop".
 */
export type MatchMode = 'all' | 'any';

export const MATCH_MODES: MatchMode[] = ['all', 'any'];

export interface ProviderState {
  provider: ProviderId;
  /** The provider directory exists on this machine. */
  available: boolean;
  /** Root directory that was inspected. */
  root: string;
  /** Error message when the scan failed. */
  error?: string;
  /** Number of sessions kept for this provider. */
  count: number;
}

export interface SessionSnapshot {
  sessions: AgentSession[];
  providers: ProviderState[];
  /** End of the last scan (ISO). */
  scannedAt: string;
  /** Sessions dropped by the history window or the session cap. */
  truncated: number;
}
