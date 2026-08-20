import { sessionsToAutoWatch } from '../core/autoWatch';
import { MarksStore, add, toggle } from '../core/marksStore';
import { SessionStore } from '../core/store';
import {
  AgentSession,
  EMPTY_FILTERS,
  MatchField,
  ProviderState,
  SearchScope,
  SessionStatus,
} from '../model/types';
import { overrideReason, releaseOvertaken } from '../core/statusOverride';
import { AckStore, applyStatusChanges } from './acks';
import { SessionDelta, computeDelta, isEmptyDelta } from './delta';
import { Desktop } from './desktop';
import { HandoverResult, HandoverTarget, handover } from './handover';
import { NotificationQueue } from './notificationQueue';
import { NotifyScope, chooseNotifications } from './notifications';
import { NotificationPreferences, PreferencesStore } from './preferences';
import { Notifier } from './notifier';
import { OverrideStore } from './statusOverrides';
import { ToastAction, soundForStatus } from './toast';
import { Tracked, trackTransitions } from './transitions';
import { RootWatcher, WatchFailure } from './watcher';

export interface EngineOptions {
  /** Transcript roots handed to `fs.watch`. */
  roots: string[];
  /** Quiet period collapsing a burst of writes into one scan. */
  debounceMs: number;
  /** Longest a burst may delay a scan, so a session mid-turn is still reported. */
  maxDebounceMs: number;
  /** Slow full scan, kept whatever the watcher says, as a safety net. */
  fullScanIntervalMs: number;
  /** Mark a session as watched when it starts working. */
  autoWatch: boolean;
  /** Asks the operating system to open a URI. */
  desktop: Desktop;
  /** Raises a native notification. */
  notifier: Notifier;
  /** Statuses a session must enter for a notification to go out. */
  notifyOn: SessionStatus[];
  /** Which sessions may raise one at all. */
  notifyScope: NotifyScope;
  /**
   * How long a session must stay stopped before it is worth telling you about.
   * A turn that ends and resumes within this window is never reported.
   */
  notifyDelayMs: number;
  notificationsEnabled: boolean;
  /**
   * Where a notification sends the user, and which buttons it offers. The
   * browser and the desktop application answer this differently: one has to go
   * back through a page, the other owns a protocol of its own.
   */
  notificationTarget: (id: string) => { launchUri: string; actions: ToastAction[] };
  /**
   * Time a window is given to come up before it is asked to reveal a session.
   * VS Code routes a URI to the focused window, so this is the mechanism.
   */
  handoffDelayMs: number;
}

/** What the browser needs beyond the session itself. */
export interface SessionView extends AgentSession {
  /** When the current status began (ISO), observed where possible. */
  statusChangedAt: string;
}

export interface MarksView {
  watched: string[];
  favorites: string[];
  unacknowledged: string[];
}

export interface EngineState {
  paused: boolean;
  /** Roots `fs.watch` accepted. Empty means the full scan is the only source. */
  watching: string[];
  watchFailures: WatchFailure[];
  providers: ProviderState[];
  truncated: number;
  sessions: number;
  scannedAt: string;
  notifications: {
    enabled: boolean;
    on: SessionStatus[];
    scope: NotifyScope;
    delaySeconds: number;
  };
}

export interface DeltaEvent extends SessionDelta {
  scannedAt: string;
}

const NO_MARKS: MarksView = { watched: [], favorites: [], unacknowledged: [] };

/**
 * Owns the scanning: what triggers it, when it is allowed, what changed, and the
 * markers that ride alongside. The HTTP layer above only forwards.
 */
export class ServiceEngine {
  private readonly watcher: RootWatcher;
  private fullScan?: ReturnType<typeof setInterval>;
  private previous: SessionView[] = [];
  /**
   * The same sessions before any hand-set status is applied.
   *
   * Kept apart because it is what releases an override: comparing an entry
   * against `previous` would compare it against itself and drop it on the spot.
   */
  private inferred: SessionView[] = [];
  private tracked = new Map<string, Tracked>();
  private marks: MarksView = NO_MARKS;
  private paused = false;
  /**
   * Owned by the interface once the user touches them, and remembered across
   * restarts: the desktop application has no command line, so a setting it
   * cannot remember is a setting it does not really have.
   */
  private notifications: NotificationPreferences;
  /** Sessions already notified in their current turn. */
  private notified = new Set<string>();
  private readonly queue: NotificationQueue;
  private watching: string[] = [];
  private watchFailures: WatchFailure[] = [];
  private readonly deltaListeners = new Set<(event: DeltaEvent) => void>();
  private readonly stateListeners = new Set<(state: EngineState) => void>();
  private readonly marksListeners = new Set<(marks: MarksView) => void>();

  constructor(
    private readonly store: SessionStore,
    private readonly marksStore: MarksStore,
    private readonly ackStore: AckStore,
    private readonly overrideStore: OverrideStore,
    private readonly preferences: PreferencesStore,
    private readonly options: EngineOptions,
  ) {
    this.notifications = {
      enabled: options.notificationsEnabled,
      on: options.notifyOn,
      scope: options.notifyScope,
      delaySeconds: Math.round(options.notifyDelayMs / 1000),
    };
    this.queue = new NotificationQueue(options.notifyDelayMs, (id) => this.deliver(id));
    this.watcher = new RootWatcher(
      options.roots,
      () => void this.scan(),
      options.debounceMs,
      options.maxDebounceMs,
    );
  }

  get state(): EngineState {
    const snapshot = this.store.current;
    return {
      paused: this.paused,
      watching: this.watching,
      watchFailures: this.watchFailures,
      providers: snapshot.providers,
      truncated: snapshot.truncated,
      sessions: snapshot.sessions.length,
      scannedAt: snapshot.scannedAt,
      notifications: {
        enabled: this.notifications.enabled,
        on: this.notifications.on,
        scope: this.notifications.scope,
        delaySeconds: this.notifications.delaySeconds,
      },
    };
  }

  /** Visible in the interface, not buried, and written down so it survives. */
  async setNotifications(next: Partial<NotificationPreferences>): Promise<EngineState> {
    this.notifications = { ...this.notifications, ...next };
    // Straight onto the queue, so the choice holds from here rather than from
    // the next start. The delay was built into it once and could not be changed
    // afterwards, which is why it was a command-line flag and nothing else.
    this.queue.delay = this.notifications.delaySeconds * 1000;
    try {
      await this.preferences.write(this.notifications);
    } catch {
      // The choice still applies to this run; only remembering it failed.
    }
    this.emitState();
    return this.state;
  }

  /** Applies what was stored, without writing it back. */
  applyStoredNotifications(stored: NotificationPreferences): void {
    this.notifications = stored;
    this.queue.delay = stored.delaySeconds * 1000;
  }

  get sessions(): SessionView[] {
    return this.previous;
  }

  get currentMarks(): MarksView {
    return this.marks;
  }

  onDelta(listener: (event: DeltaEvent) => void): () => void {
    this.deltaListeners.add(listener);
    return () => this.deltaListeners.delete(listener);
  }

  onState(listener: (state: EngineState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onMarks(listener: (marks: MarksView) => void): () => void {
    this.marksListeners.add(listener);
    return () => this.marksListeners.delete(listener);
  }

  async start(): Promise<void> {
    this.startWatching();
    await this.scan();
  }

  stop(): void {
    this.stopWatching();
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    // Watching too: a paused service that keeps its watchers open is not paused,
    // it is only silent.
    this.stopWatching();
    this.emitState();
  }

  async resume(): Promise<void> {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.startWatching();
    // Whatever happened while paused is caught up in one pass.
    await this.scan();
  }

  /** Forces a scan, even while paused: asking explicitly is not watching. */
  async refresh(): Promise<void> {
    await this.scan(true);
  }

  /**
   * Full text search, which stays here because it reads the transcripts. The
   * browser filters on everything else itself, instantly; only this needs disk.
   * The answer says which field matched, so the interface can show why a row is
   * in the list.
   */
  async search(query: string, scope: SearchScope): Promise<Record<string, MatchField[]>> {
    const { matches } = await this.store.query({ ...EMPTY_FILTERS, query, scope });
    const found: Record<string, MatchField[]> = {};
    for (const match of matches) {
      found[match.session.id] = match.matchedOn;
    }
    return found;
  }

  /**
   * Hands a session over to VS Code. Opening it counts as seeing it, so the
   * acknowledgement goes out at the same time.
   */
  async open(id: string, target: HandoverTarget): Promise<HandoverResult | undefined> {
    const session = this.previous.find((candidate) => candidate.id === id);
    if (!session) {
      return undefined;
    }
    const result = await handover(
      this.options.desktop,
      session,
      target,
      this.options.handoffDelayMs,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    await this.acknowledge([id]);
    return result;
  }

  /**
   * Replaces the status of the sessions you have corrected, and forgets the
   * corrections the transcripts have overtaken.
   *
   * Written back only when something was actually released, so the common case
   * — no overrides, or none stale — costs one read and no write.
   */
  private async withOverrides(sessions: SessionView[]): Promise<SessionView[]> {
    const stored = await this.overrideStore.read();
    if (Object.keys(stored.entries).length === 0) {
      return sessions;
    }
    const inferredById = new Map(sessions.map((session) => [session.id, session.status]));
    const { kept, released } = releaseOvertaken(stored.entries, inferredById);
    if (released.length > 0) {
      await this.overrideStore.update((current) => {
        for (const id of released) delete current.entries[id];
      });
    }
    return sessions.map((session) => {
      const override = kept[session.id];
      if (!override) {
        return session;
      }
      return {
        ...session,
        status: override.status,
        statusReason: overrideReason(override, session.statusReason),
      };
    });
  }

  /**
   * Sets or clears the status of one session by hand.
   *
   * `inferred` is recorded from what the session currently says, because that
   * is what releases the override later. Setting one counts as having looked at
   * the row, so it is acknowledged at the same time — you cannot correct a
   * status without having read it.
   */
  async setStatus(id: string, status: SessionStatus | null): Promise<SessionView[]> {
    // From the inferred view, never from `previous`: what releases the override
    // later is what the transcript says, not what the row is currently showing.
    const said = this.inferred.find((candidate) => candidate.id === id)?.status;
    await this.overrideStore.update((overrides) => {
      if (status === null) {
        delete overrides.entries[id];
        return;
      }
      overrides.entries[id] = {
        status,
        inferred: said ?? status,
        at: new Date().toISOString(),
      };
    });
    if (status !== null) {
      await this.acknowledge([id]);
    }
    this.previous = await this.withOverrides(this.inferred);
    this.emitState();
    return this.previous;
  }

  async toggleWatched(id: string): Promise<MarksView> {
    const marks = await this.marksStore.update((current) => {
      current.watched = toggle(current.watched, id);
    });
    return this.publishMarks(marks.watched, marks.favorites);
  }

  async toggleFavorite(id: string): Promise<MarksView> {
    const marks = await this.marksStore.update((current) => {
      current.favorites = toggle(current.favorites, id);
    });
    return this.publishMarks(marks.watched, marks.favorites);
  }

  /**
   * Acknowledges the given sessions. The caller passes the identifiers it can
   * actually see, so a global acknowledgement settles what is on screen and
   * never a hundred rows hidden by a filter.
   */
  /**
   * Puts the marker back on, which is the other half of clicking a status.
   *
   * It says "there is something here I have not dealt with", and until now that
   * sentence could only be written by a scan and erased by you. Being able to
   * write it yourself is what makes it a marker rather than a receipt: the two
   * beside it have always toggled.
   *
   * Nothing special is needed to make it behave: a mark set by hand is cleared
   * by the same event that clears an automatic one — the session next starting
   * to work — because {@link applyStatusChanges} looks at the transition and
   * not at who wrote the mark.
   */
  async unacknowledge(ids: readonly string[]): Promise<MarksView> {
    const acks = await this.ackStore.update((current) => {
      current.unacknowledged = [...new Set([...current.unacknowledged, ...ids])];
    });
    this.marks = { ...this.marks, unacknowledged: acks.unacknowledged };
    this.emitMarks();
    return this.marks;
  }

  async acknowledge(ids: readonly string[]): Promise<MarksView> {
    const wanted = new Set(ids);
    const acks = await this.ackStore.update((current) => {
      current.unacknowledged = current.unacknowledged.filter((id) => !wanted.has(id));
    });
    this.marks = { ...this.marks, unacknowledged: acks.unacknowledged };
    this.emitMarks();
    return this.marks;
  }

  private async publishMarks(watched: string[], favorites: string[]): Promise<MarksView> {
    this.marks = { watched, favorites, unacknowledged: this.marks.unacknowledged };
    this.emitMarks();
    return this.marks;
  }

  private startWatching(): void {
    const report = this.watcher.start();
    this.watching = report.watched;
    this.watchFailures = report.failed;
    this.fullScan = setInterval(() => void this.scan(), this.options.fullScanIntervalMs);
  }

  private stopWatching(): void {
    this.watcher.stop();
    if (this.fullScan) {
      clearInterval(this.fullScan);
      this.fullScan = undefined;
    }
  }

  private async scan(force = false): Promise<void> {
    if (this.paused && !force) {
      return;
    }
    let snapshot;
    try {
      snapshot = await this.store.refresh();
    } catch {
      // A scan that failed says nothing about the sessions; the next one will
      // try again, and the service must outlive it either way.
      return;
    }

    const now = Date.now();
    const { tracked, transitions } = trackTransitions(this.tracked, snapshot.sessions, now);
    this.tracked = tracked;

    const inferred: SessionView[] = snapshot.sessions.map((session) => ({
      ...session,
      statusChangedAt: new Date(tracked.get(session.id)?.changedAt ?? now).toISOString(),
    }));

    // Applied here and not a line earlier: `trackTransitions` above and
    // `notify` below must both go on seeing what the transcripts say. A status
    // you set by hand changes what the row shows, never what the service
    // believes happened — otherwise correcting a row would either raise a
    // notification or swallow the next real one.
    const sessions = await this.withOverrides(inferred);

    const delta = computeDelta(this.previous, sessions);
    this.inferred = inferred;
    this.previous = sessions;

    // Marks first: whether a session is watched decides whether it may notify,
    // and a session that just started running has only now become watched.
    await this.updateMarks(snapshot.sessions, transitions);
    this.notify(transitions, inferred);

    if (!isEmptyDelta(delta)) {
      const event: DeltaEvent = { ...delta, scannedAt: snapshot.scannedAt };
      for (const listener of this.deltaListeners) {
        listener(event);
      }
    }
    this.emitState();
  }

  /**
   * The marks are re-read from disk on every scan rather than cached: the
   * extension writes the same file while both are installed, and a starred
   * session must not depend on which of the two you starred it from.
   */
  private async updateMarks(
    sessions: AgentSession[],
    transitions: readonly { id: string; from?: string; to: string }[],
  ): Promise<void> {
    try {
      const running = sessions
        .filter((session) => session.status === 'running')
        .map((session) => session.id);

      const marks = await this.marksStore.update((current) => {
        if (this.options.autoWatch) {
          // Decided on the transition into running, so dismissing during a turn
          // holds and a session starting again is marked again.
          current.watched = add(
            current.watched,
            sessionsToAutoWatch(sessions, new Set(current.running), new Set(current.watched)),
          );
        }
        current.running = running;
      });

      const acks = await this.ackStore.update((current) => {
        current.unacknowledged = applyStatusChanges(current.unacknowledged, transitions);
      });

      const next: MarksView = {
        watched: marks.watched,
        favorites: marks.favorites,
        unacknowledged: acks.unacknowledged,
      };
      const changed = JSON.stringify(next) !== JSON.stringify(this.marks);
      this.marks = next;
      if (changed) {
        this.emitMarks();
      }
    } catch {
      // A locked or unreadable marks file must not stop the list from updating.
    }
  }

  /**
   * Toasts are sent without being waited for. Showing one costs about a second
   * on Windows, and a scan must not be held up by it — nor may a notifier that
   * is missing or broken ever take the service down.
   */
  private notify(
    transitions: readonly { id: string; from?: SessionStatus; to: SessionStatus }[],
    sessions: readonly SessionView[],
  ): void {
    const policy = {
      enabled: this.notifications.enabled,
      on: new Set(this.notifications.on),
      scope: this.notifications.scope,
    };
    const decision = chooseNotifications({
      transitions,
      watched: new Set(this.marks.watched),
      unacknowledged: new Set(this.marks.unacknowledged),
      notified: this.notified,
      policy,
    });
    this.notified = decision.notified;

    // Held back rather than sent: a turn can end and resume within a second, and
    // the transcript cannot tell the two apart until a moment has passed.
    for (const id of decision.notify) {
      this.queue.schedule(id);
    }
    // Anything that stopped qualifying while it waited — a session working
    // again, most often — never gets told about.
    this.queue.retain(
      new Set(
        sessions
          .filter((session) => policy.enabled && policy.on.has(session.status))
          .map((session) => session.id),
      ),
    );
  }

  /**
   * Sent once the quiet period has passed and the session is still in the state
   * that earned it.
   */
  private deliver(id: string): void {
    const session = this.previous.find((candidate) => candidate.id === id);
    if (!session || !this.notifications.enabled || !this.notifications.on.includes(session.status)) {
      return;
    }
    const folder = session.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? 'no workspace';
    void this.options.notifier
      .send({
        heading: `${folder} — ${session.provider}`,
        title: session.title,
        // Enough to decide without opening anything.
        body: session.statusReason,
        sound: soundForStatus(session.status),
        ...this.options.notificationTarget(id),
      })
      .catch(() => undefined);
  }

  private emitState(): void {
    const state = this.state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private emitMarks(): void {
    for (const listener of this.marksListeners) {
      listener(this.marks);
    }
  }
}
