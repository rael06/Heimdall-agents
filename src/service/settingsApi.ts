import { ProviderId, SessionStatus } from '../model/types';
import { Detection, detect } from './detect';
import { NotifyScope } from './notifications';
import { PreferencesStore, ProviderPreferences, ScanPreferences } from './preferences';

/**
 * What only the desktop application can do.
 *
 * Starting at login and showing a tray icon are properties of a window, not of
 * a service, and the service is shared with a command that has neither. So the
 * application passes these in and the command passes nothing — the interface
 * then offers exactly what the host it is talking to can actually do, rather
 * than a switch that silently does nothing.
 */
export interface HostControls {
  startsWithLogin(): boolean;
  setStartsWithLogin(enabled: boolean): void;
  trayVisible(): boolean;
  setTrayVisible(visible: boolean): void;
  /** Applies what only a fresh start can apply. */
  restart(): void;
}

export interface SettingsView {
  providers: ProviderPreferences;
  scan: ScanPreferences;
  notifications: { enabled: boolean; on: SessionStatus[]; scope: NotifyScope };
  /** Absent when the host cannot offer them, so the interface hides them. */
  host?: { startsWithLogin: boolean; trayVisible: boolean };
  /** Values in force right now, which differ from the stored ones until a restart. */
  effective: ProviderPreferences;
}

export interface SaveRequest {
  providers?: Partial<ProviderPreferences>;
  scan?: Partial<ScanPreferences>;
  host?: { startsWithLogin?: boolean; trayVisible?: boolean };
}

export interface SaveResult {
  saved: SettingsView;
  /** True when what changed only takes effect on a fresh scan of everything. */
  restartRequired: boolean;
}

/**
 * Which settings a running service cannot adopt in place.
 *
 * The providers are built once, with their paths and their caps, and the store
 * holds what they read. Changing any of that means building them again, which
 * is a restart rather than a setter.
 */
export function needsRestart(before: SettingsView, request: SaveRequest): boolean {
  const changed = <T extends object>(current: T, next: Partial<T> | undefined): boolean =>
    Boolean(next) &&
    Object.entries(next as Record<string, unknown>).some(
      ([key, value]) => value !== undefined && (current as Record<string, unknown>)[key] !== value,
    );
  return changed(before.providers, request.providers) || changed(before.scan, request.scan);
}

export class SettingsApi {
  constructor(
    private readonly preferences: PreferencesStore,
    private readonly effective: ProviderPreferences,
    private readonly host?: HostControls,
  ) {}

  /**
   * Whether the host has a menu of its own.
   *
   * The desktop application carries Settings under File on `Ctrl+,`, so the
   * button in the page is a second door to the same room. A bare `asm serve` is
   * read in a browser and has no menu, so there the button is the only door.
   * `HostControls` is present for exactly one of those, which makes it the
   * honest signal rather than sniffing a user agent.
   */
  get hasNativeMenu(): boolean {
    return Boolean(this.host);
  }

  async read(): Promise<SettingsView> {
    const stored = await this.preferences.read();
    return {
      providers: stored.providers,
      scan: stored.scan,
      notifications: stored.notifications,
      host: this.host
        ? { startsWithLogin: this.host.startsWithLogin(), trayVisible: this.host.trayVisible() }
        : undefined,
      effective: this.effective,
    };
  }

  /** Probes both providers at once; neither depends on the other. */
  async detect(): Promise<Detection[]> {
    const providers: ProviderId[] = ['claude', 'codex'];
    return Promise.all(providers.map((provider) => detect(provider)));
  }

  async save(request: SaveRequest): Promise<SaveResult> {
    const before = await this.read();
    const restartRequired = needsRestart(before, request);

    if (request.providers) {
      await this.preferences.writeProviders({ ...before.providers, ...request.providers });
    }
    if (request.scan) {
      await this.preferences.writeScan({ ...before.scan, ...request.scan });
    }
    // Applied at once: these are the host's own state, not something a scan
    // rebuilds, so making them wait for a restart would only be confusing.
    if (this.host && request.host) {
      if (request.host.startsWithLogin !== undefined) {
        this.host.setStartsWithLogin(request.host.startsWithLogin);
      }
      if (request.host.trayVisible !== undefined) {
        this.host.setTrayVisible(request.host.trayVisible);
      }
    }
    return { saved: await this.read(), restartRequired };
  }

  restart(): boolean {
    if (!this.host) {
      return false;
    }
    this.host.restart();
    return true;
  }
}
