import {
  AgentSession,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  MatchField,
  NO_MARKS,
  SessionFilters,
  SessionMarks,
  SessionMatch,
  SortKey,
  SortOption,
  normalizeSort,
  splitSort,
  statusRank,
} from '../model/types';
import { matchesAllTerms, tokenize } from './text';

/** Parses an ISO date, pushing unparsable values to the end of a descending sort. */
function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

/** Compares two sessions by status priority, then by most recent activity. */
export function compareSessions(a: AgentSession, b: AgentSession): number {
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) {
    return byStatus;
  }
  const byActivity = timeOf(b.updatedAt) - timeOf(a.updatedAt);
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.title.localeCompare(b.title);
}

/**
 * Comparator for a given ordering. Every comparator falls back to the title so
 * the list stays stable when the primary key ties — otherwise two sessions
 * created in the same minute would swap places between two scans for no reason.
 */
export function comparatorFor(sort: SortOption): (a: AgentSession, b: AgentSession) => number {
  const byTitle = (a: AgentSession, b: AgentSession) => a.title.localeCompare(b.title);
  const { key, ascending } = splitSort(normalizeSort(sort));

  // Ascending is defined per column and then flipped, rather than written twice.
  const ascendingBy: Record<SortKey, (a: AgentSession, b: AgentSession) => number> = {
    // Rank ascending, so running comes first: the priority order.
    status: (a, b) => statusRank(a.status) - statusRank(b.status) || timeOf(b.updatedAt) - timeOf(a.updatedAt),
    created: (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt),
    updated: (a, b) => timeOf(a.updatedAt) - timeOf(b.updatedAt),
    provider: (a, b) => a.provider.localeCompare(b.provider),
    workspace: (a, b) => (a.cwd ?? '').localeCompare(b.cwd ?? ''),
    title: byTitle,
  };

  const primary = ascendingBy[key];
  return (a, b) => (ascending ? primary(a, b) : -primary(a, b)) || byTitle(a, b);
}

/** Local day of an ISO date, as YYYY-MM-DD, to compare with the filter bounds. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function withinDateBounds(session: AgentSession, filters: SessionFilters): boolean {
  const day = localDay(session.createdAt);
  if (!day) {
    // Unknown creation date: only excluded when a bound is actually requested.
    return !filters.createdFrom && !filters.createdTo;
  }
  if (filters.createdFrom && day < filters.createdFrom) {
    return false;
  }
  if (filters.createdTo && day > filters.createdTo) {
    return false;
  }
  return true;
}

/**
 * Applies the structural filters (status, provider, dates) with AND logic. Text
 * search is handled separately because it may require disk reads.
 */
export function applyStructuralFilters(
  sessions: AgentSession[],
  filters: SessionFilters,
  marks: SessionMarks = NO_MARKS,
): AgentSession[] {
  return sessions.filter((session) => {
    // One entry per filter the user actually turned on. An inactive filter is
    // absent rather than "true", which is what lets `any` mean "matches one of
    // the things I asked for" instead of "matches everything".
    const verdicts: boolean[] = [];
    if (filters.favoritesOnly) {
      verdicts.push(marks.favorites.has(session.id));
    }
    if (filters.watchedOnly) {
      verdicts.push(marks.watched.has(session.id));
    }
    if (filters.statuses.length > 0) {
      verdicts.push(filters.statuses.includes(session.status));
    }
    if (filters.providers.length > 0) {
      verdicts.push(filters.providers.includes(session.provider));
    }
    if (filters.workspaces.length > 0) {
      // A session without a folder cannot match a workspace the user picked.
      verdicts.push(Boolean(session.cwd) && filters.workspaces.includes(session.cwd as string));
    }
    if (filters.createdFrom || filters.createdTo) {
      verdicts.push(withinDateBounds(session, filters));
    }

    if (verdicts.length === 0) {
      return true;
    }
    return filters.match === 'any' ? verdicts.some(Boolean) : verdicts.every(Boolean);
  });
}

/**
 * Marked sessions come first whatever the ordering: watched ones, then starred
 * ones, then the rest. Watched sits above favorites because it is the transient
 * marker, set when a session needs attention now, while a favorite is a lasting
 * choice. The chosen comparator still orders each group.
 */
export function withMarksFirst(
  comparator: (a: AgentSession, b: AgentSession) => number,
  marks: SessionMarks,
): (a: AgentSession, b: AgentSession) => number {
  if (marks.watched.size === 0 && marks.favorites.size === 0) {
    return comparator;
  }
  const rank = (session: AgentSession): number => {
    if (marks.watched.has(session.id)) {
      return 0;
    }
    return marks.favorites.has(session.id) ? 1 : 2;
  };
  return (a, b) => rank(a) - rank(b) || comparator(a, b);
}

/** Title-only match, which never reads the transcript. */
export function matchTitle(session: AgentSession, terms: string[]): boolean {
  return matchesAllTerms(session.title, terms);
}

/**
 * Builds the final result: structural filters first, then search. `contentMatcher`
 * is only called for sessions whose title does not already match.
 */
export async function selectSessions(
  sessions: AgentSession[],
  filters: SessionFilters,
  sort: SortOption = DEFAULT_SORT,
  contentMatcher?: (session: AgentSession, terms: string[]) => Promise<boolean>,
  marks: SessionMarks = NO_MARKS,
): Promise<SessionMatch[]> {
  const filtered = applyStructuralFilters(sessions, filters, marks);
  const terms = tokenize(filters.query);
  const results: SessionMatch[] = [];

  for (const session of filtered) {
    if (terms.length === 0) {
      results.push({ session, matchedOn: [] });
      continue;
    }
    const matchedOn: MatchField[] = [];
    if (filters.scope !== 'content' && matchTitle(session, terms)) {
      matchedOn.push('title');
    }
    // The transcript is only read when the title cannot answer the query.
    if (matchedOn.length === 0 && filters.scope !== 'title' && contentMatcher) {
      if (await contentMatcher(session, terms)) {
        matchedOn.push('content');
      }
    }
    if (matchedOn.length > 0) {
      results.push({ session, matchedOn });
    }
  }

  const comparator = withMarksFirst(comparatorFor(sort), marks);
  results.sort((a, b) => comparator(a.session, b.session));
  return results;
}

export function hasActiveFilters(filters: SessionFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.scope !== EMPTY_FILTERS.scope ||
    filters.favoritesOnly ||
    filters.watchedOnly ||
    filters.statuses.length > 0 ||
    filters.providers.length > 0 ||
    filters.workspaces.length > 0 ||
    Boolean(filters.createdFrom) ||
    Boolean(filters.createdTo)
  );
}
