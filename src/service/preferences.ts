import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from '../core/fileLock';
import { STATUS_ORDER, SessionStatus } from '../model/types';
import { DEFAULT_NOTIFY_ON, DEFAULT_NOTIFY_SCOPE, NOTIFY_SCOPES, NotifyScope } from './notifications';

/**
 * What the user changed from the interface, kept across restarts.
 *
 * The command line seeds these; the interface then owns them. That split exists
 * because the desktop application has no command line of its own — a setting it
 * cannot remember is a setting it does not really have.
 *
 * Its own file, like the acknowledgements: `marks.json` is written by the
 * extension too, in a shape both sides agree on, and anything added to it is
 * dropped on the next write from the other side.
 */

/**
 * 2 dropped `unknown` from the notification list, once.
 *
 * Once, and not on every read: a chip you can tick that quietly un-ticks itself
 * at the next start is a setting that pretends to save. The choice is made for
 * you the first time, on the grounds that a stale file is not the model
 * stopping — and it stays yours afterwards.
 */
const VERSION = 2;
const FILE_NAME = 'preferences.json';

export interface NotificationPreferences {
  enabled: boolean;
  on: SessionStatus[];
  scope: NotifyScope;
}

/**
 * Carries a stored list of statuses across the renaming.
 *
 * `completed` became `idle`, and `needs-action` stopped existing — neither
 * provider ever wrote a pending permission, so the status was a guess. Both are
 * folded into `idle`, which is what they now describe: the model has stopped
 * and the next move is yours.
 *
 * Dropping them instead would have emptied the list of somebody who had asked
 * to be told, and a setting that silently stops doing what it says is worse
 * than one that was never offered.
 */
const RENAMED: Record<string, SessionStatus> = {
  completed: 'idle',
  'needs-action': 'idle',
};

/**
 * Dropped from a stored notification list rather than carried across.
 *
 * `unknown` does not mean the model stopped working — it means an open turn has
 * been silent long enough that the file is no longer believed. That is a fact
 * about a stale file, not about the session, and waking someone for it is the
 * kind of alert that teaches people to ignore the channel. It stays available
 * as a column and a filter; only the sound goes.
 */
const NEVER_NOTIFIED: ReadonlySet<string> = new Set(['unknown']);

export function migrateStatuses(stored: readonly unknown[], from = VERSION): SessionStatus[] {
  const kept = new Set<SessionStatus>();
  for (const value of stored) {
    if (typeof value !== 'string' || (from < 2 && NEVER_NOTIFIED.has(value))) {
      continue;
    }
    const status = RENAMED[value] ?? (value as SessionStatus);
    if ((STATUS_ORDER as string[]).includes(status)) {
      kept.add(status);
    }
  }
  return STATUS_ORDER.filter((status) => kept.has(status));
}

/**
 * Where the transcripts are, when they are not where they usually are. Empty
 * means "wherever the default says", so a machine that never needed to be told
 * keeps working if the default ever changes.
 */
export interface ProviderPreferences {
  claudeHome: string;
  codexHome: string;
}

/**
 * What the providers are built with. Every one of these is read once, when they
 * are constructed, which is why changing any of them asks for a restart rather
 * than taking effect on the next scan.
 */
export interface ScanPreferences {
  maxSessions: number;
  /** 0 means everything. */
  historyDays: number;
  staleAfterMinutes: number;
  includeSubagents: boolean;
  autoWatch: boolean;
  handoffDelaySeconds: number;
}

/**
 * What each of those numbers may actually be.
 *
 * The interface offers these as `min` and `max` on the inputs, which is a hint
 * to a form and nothing to a service: `POST /api/settings` took whatever number
 * arrived. The route is behind the token, so this was never a way in — it was a
 * way to persist `maxSessions: 1e9` and have the providers built with it, which
 * surfaces much later as an application that reads nothing.
 *
 * The markup mirrors these, and this is the side that decides.
 */
export const SCAN_BOUNDS: Readonly<Record<string, { min: number; max: number }>> = {
  maxSessions: { min: 10, max: 5000 },
  // 0 means everything, which is why the floor is not 1.
  historyDays: { min: 0, max: 3650 },
  staleAfterMinutes: { min: 1, max: 10080 },
  handoffDelaySeconds: { min: 0, max: 30 },
};

export const DEFAULT_SCAN: ScanPreferences = {
  maxSessions: 300,
  historyDays: 30,
  // Measured over 68 782 silences inside an open turn: 99.9 % last under ten
  // minutes and only 22 exceed an hour — and those turned out to be turns
  // abandoned and picked up the next day, where *inconclusive* was the truthful
  // label anyway. Thirty minutes clears normal work three times over while
  // cutting the window a dead session spends claiming to run.
  staleAfterMinutes: 30,
  includeSubagents: false,
  autoWatch: true,
  handoffDelaySeconds: 2,
};

/** Properties of the window rather than of the service. */
export interface AppPreferences {
  showTray: boolean;
}

export const DEFAULT_APP: AppPreferences = { showTray: true };

export interface Preferences {
  version: number;
  notifications: NotificationPreferences;
  providers: ProviderPreferences;
  scan: ScanPreferences;
  app: AppPreferences;
}

export const NO_PROVIDER_PATHS: ProviderPreferences = { claudeHome: '', codexHome: '' };

export function preferencesFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

export function sanitizePreferences(value: unknown, fallback: NotificationPreferences): Preferences {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const notifications = (
    typeof raw.notifications === 'object' && raw.notifications !== null ? raw.notifications : {}
  ) as Record<string, unknown>;

  const storedVersion = typeof raw.version === 'number' ? raw.version : VERSION;
  const on = Array.isArray(notifications.on)
    ? migrateStatuses(notifications.on, storedVersion)
    : undefined;

  const providers = (
    typeof raw.providers === 'object' && raw.providers !== null ? raw.providers : {}
  ) as Record<string, unknown>;
  const providerPath = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const scanRaw = (typeof raw.scan === 'object' && raw.scan !== null ? raw.scan : {}) as Record<
    string,
    unknown
  >;
  const appRaw = (typeof raw.app === 'object' && raw.app !== null ? raw.app : {}) as Record<
    string,
    unknown
  >;
  const scan = { ...DEFAULT_SCAN };
  for (const key of Object.keys(DEFAULT_SCAN) as (keyof ScanPreferences)[]) {
    const value = scanRaw[key];
    const wanted = typeof DEFAULT_SCAN[key];
    // A value of the wrong shape is dropped rather than carried: these are
    // written by an interface, and a string where a number belongs would only
    // surface much later, as a provider that quietly reads nothing.
    if (typeof value !== wanted || (wanted === 'number' && !Number.isFinite(value as number))) {
      continue;
    }
    if (wanted !== 'number') {
      (scan as Record<string, unknown>)[key] = value;
      continue;
    }
    // Clamped rather than rejected: a number out of range is a slider pushed too
    // far, and the nearest legal value is what was meant. A fraction is not —
    // these all count things.
    const bounds = SCAN_BOUNDS[key];
    const rounded = Math.round(value as number);
    (scan as Record<string, unknown>)[key] = bounds
      ? Math.min(bounds.max, Math.max(bounds.min, rounded))
      : rounded;
  }

  return {
    version: storedVersion,
    providers: {
      claudeHome: providerPath(providers.claudeHome),
      codexHome: providerPath(providers.codexHome),
    },
    scan,
    app: {
      showTray:
        typeof appRaw.showTray === 'boolean' ? appRaw.showTray : DEFAULT_APP.showTray,
    },
    notifications: {
      enabled:
        typeof notifications.enabled === 'boolean' ? notifications.enabled : fallback.enabled,
      // An empty list is kept: it means "notify me about nothing", which is a
      // choice, and not the same as never having chosen.
      on: on ?? fallback.on,
      scope: NOTIFY_SCOPES.includes(notifications.scope as NotifyScope)
        ? (notifications.scope as NotifyScope)
        : fallback.scope,
    },
  };
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  enabled: true,
  on: DEFAULT_NOTIFY_ON,
  scope: DEFAULT_NOTIFY_SCOPE,
};

export class PreferencesStore {
  constructor(private readonly filePath: string) {}

  /** `fallback` is what the command line asked for, used until a choice is made. */
  async read(fallback: NotificationPreferences = DEFAULT_NOTIFICATIONS): Promise<Preferences> {
    try {
      return sanitizePreferences(JSON.parse(await fs.readFile(this.filePath, 'utf8')), fallback);
    } catch {
      // Nothing chosen yet: the command line, or the defaults, still hold.
      return {
        version: VERSION,
        notifications: fallback,
        providers: NO_PROVIDER_PATHS,
        scan: DEFAULT_SCAN,
        app: DEFAULT_APP,
      };
    }
  }

  async write(notifications: NotificationPreferences): Promise<void> {
    await this.update((current) => ({ ...current, notifications }));
  }

  async writeProviders(providers: ProviderPreferences): Promise<void> {
    await this.update((current) => ({ ...current, providers }));
  }

  async writeScan(scan: ScanPreferences): Promise<void> {
    await this.update((current) => ({ ...current, scan }));
  }

  async writeApp(appPreferences: AppPreferences): Promise<void> {
    await this.update((current) => ({ ...current, app: appPreferences }));
  }

  /** Read, change, write back: one half must never drop the other. */
  private async update(mutate: (current: Preferences) => Preferences): Promise<void> {
    await withFileLock(this.filePath, async () => {
      let current: Preferences = {
        version: VERSION,
        notifications: DEFAULT_NOTIFICATIONS,
        providers: NO_PROVIDER_PATHS,
        scan: DEFAULT_SCAN,
        app: DEFAULT_APP,
      };
      try {
        current = sanitizePreferences(
          JSON.parse(await fs.readFile(this.filePath, 'utf8')),
          DEFAULT_NOTIFICATIONS,
        );
      } catch {
        // Nothing written yet.
      }
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = temporaryPathFor(this.filePath);
      await fs.writeFile(
        temporary,
        `${JSON.stringify({ ...mutate(current), version: VERSION }, null, 2)}\n`,
        'utf8',
      );
      await fs.rename(temporary, this.filePath);
    });
  }
}
