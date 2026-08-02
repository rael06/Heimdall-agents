import {
  AgentSession,
  DEFAULT_SORT,
  NO_MARKS,
  SessionFilters,
  SessionMarks,
  SessionMatch,
  SessionSnapshot,
  SortOption,
} from '../model/types';
import { ScanOptions, SessionProvider } from '../providers/provider';
import { selectSessions } from './filter';
import { tokenize } from './text';

const EMPTY_SNAPSHOT: SessionSnapshot = {
  sessions: [],
  providers: [],
  scannedAt: new Date(0).toISOString(),
  truncated: 0,
};

export interface QueryResult {
  matches: SessionMatch[];
  snapshot: SessionSnapshot;
}

/**
 * Aggregates the providers, caches the latest snapshot and applies search and
 * filters. Only one scan runs at a time; concurrent requests are merged so the
 * disk is never hammered by overlapping scans.
 */
export class SessionStore {
  private snapshot: SessionSnapshot = EMPTY_SNAPSHOT;
  private inFlight?: Promise<SessionSnapshot>;
  private inFlightIsFull = false;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();

  constructor(
    private readonly providers: () => SessionProvider[],
    private readonly options: () => ScanOptions,
  ) {}

  get current(): SessionSnapshot {
    return this.snapshot;
  }

  onDidChange(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * `focusIds` limits the disk reads to those sessions; the others are served
   * from the previous scan, with their status graded again. Absent means a full
   * scan. A focused scan never satisfies a request for a full one, which waits
   * for it instead of being dropped.
   */
  async refresh(focusIds?: ReadonlySet<string>): Promise<SessionSnapshot> {
    if (this.inFlight && (focusIds || this.inFlightIsFull)) {
      return this.inFlight;
    }
    const pending = this.inFlight;
    const run = (async () => {
      if (pending) {
        await pending.catch(() => undefined);
      }
      return this.scan(focusIds);
    })();
    this.inFlight = run;
    this.inFlightIsFull = !focusIds;
    return run.finally(() => {
      if (this.inFlight === run) {
        this.inFlight = undefined;
        this.inFlightIsFull = false;
      }
    });
  }

  private async scan(focusIds?: ReadonlySet<string>): Promise<SessionSnapshot> {
    const options = { ...this.options(), focusIds };
    const results = await Promise.all(
      this.providers().map(async (provider) => {
        try {
          return await provider.scan(options);
        } catch (error) {
          // A failing provider must never hide the sessions of the other one.
          return {
            sessions: [] as AgentSession[],
            truncated: 0,
            state: {
              provider: provider.id,
              available: false,
              root: provider.root,
              count: 0,
              error: String(error),
            },
          };
        }
      }),
    );

    const sessions = results.flatMap((result) => result.sessions);
    this.snapshot = {
      sessions,
      providers: results.map((result) => result.state),
      truncated: results.reduce((total, result) => total + result.truncated, 0),
      scannedAt: new Date(options.now).toISOString(),
    };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
    return this.snapshot;
  }

  /** Applies filters, search and ordering to the latest known snapshot. */
  async query(
    filters: SessionFilters,
    sort: SortOption = DEFAULT_SORT,
    marks: SessionMarks = NO_MARKS,
  ): Promise<QueryResult> {
    const terms = tokenize(filters.query);
    const byProvider = new Map(this.providers().map((provider) => [provider.id, provider]));
    const matches = await selectSessions(
      this.snapshot.sessions,
      filters,
      sort,
      async (session) => {
        const provider = byProvider.get(session.provider);
        if (!provider) {
          return false;
        }
        try {
          return await provider.matchesContent(session, terms);
        } catch {
          return false;
        }
      },
      marks,
    );
    return { matches, snapshot: this.snapshot };
  }
}
