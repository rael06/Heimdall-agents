import { Server } from 'node:http';
import * as path from 'node:path';
import { MarksStore } from '../core/marksStore';
import { SessionStore } from '../core/store';
import { AckStore, acksFilePath } from './acks';
import { OverrideStore, overridesFilePath } from './statusOverrides';
import { WatchLogStore, watchLogFilePath } from './watchLog';
import { Desktop } from './desktop';
import { ServiceEngine } from './engine';
import { Notifier } from './notifier';
import { NotifyScope } from './notifications';
import { PreferencesStore, preferencesFilePath } from './preferences';
import { HostControls, SettingsApi } from './settingsApi';
import { ToastAction } from './toast';
import { createServiceServer } from './server';
import { SessionStatus } from '../model/types';
import {
  ServiceFile,
  clearServiceFile,
  mintToken,
  serviceUrl,
  writeServiceFile,
} from './token';

/**
 * Everything between "a set of settings" and "a service answering on a port".
 *
 * It lives here rather than in the command because two things start it now: the
 * `asm serve` command, and the desktop application, which runs the very same
 * service inside its own process. Neither is a special case of the other, and
 * duplicating this is how they would drift.
 */
export interface BootstrapOptions {
  store: SessionStore;
  sharedDir: string;
  host: string;
  port: number;
  roots: string[];
  debounceMs: number;
  maxDebounceMs: number;
  fullScanIntervalMs: number;
  autoWatch: boolean;
  desktop: Desktop;
  handoffDelayMs: number;
  notifier: Notifier;
  notifyOn: SessionStatus[];
  notifyScope: NotifyScope;
  notifyDelayMs: number;
  notificationsEnabled: boolean;
  /**
   * Where a notification sends the user. Differs between the two hosts, and
   * receives the token because the token is minted in here — a caller building
   * the URL itself would be holding an empty one until this returns.
   */
  notificationTarget: (id: string, token: string) => { launchUri: string; actions: ToastAction[] };
  /**
   * What only the desktop application can do — start at login, show a tray,
   * restart itself. A bare service passes nothing and offers no settings.
   */
  controls?: HostControls;
}

export interface StartedService {
  engine: ServiceEngine;
  file: ServiceFile;
  /** The address to open, token included. */
  url: string;
  stop(): Promise<void>;
}

export class PortInUseError extends Error {}

export async function startService(options: BootstrapOptions): Promise<StartedService> {
  const token = mintToken();
  const preferences = new PreferencesStore(preferencesFilePath(options.sharedDir));
  const engine = new ServiceEngine(
    options.store,
    // The same file the extension writes, under the same lock, so a star set on
    // either side is visible on both while they run together.
    new MarksStore(path.join(options.sharedDir, 'marks.json')),
    new AckStore(acksFilePath(options.sharedDir)),
    // Its own file, like the acknowledgements and for the same reason: the
    // marks file is rebuilt from the keys the extension knows.
    new OverrideStore(overridesFilePath(options.sharedDir)),
    // Its own file too, and for the load-bearing half of the same reason: the
    // marks file is rewritten by the extension, which keeps three lists of
    // identifiers and drops everything else.
    new WatchLogStore(watchLogFilePath(options.sharedDir)),
    preferences,
    {
      roots: options.roots,
      debounceMs: options.debounceMs,
      maxDebounceMs: options.maxDebounceMs,
      fullScanIntervalMs: options.fullScanIntervalMs,
      autoWatch: options.autoWatch,
      desktop: options.desktop,
      handoffDelayMs: options.handoffDelayMs,
      notifier: options.notifier,
      notifyOn: options.notifyOn,
      notifyScope: options.notifyScope,
      notifyDelayMs: options.notifyDelayMs,
      notificationsEnabled: options.notificationsEnabled,
      notificationTarget: (id) => options.notificationTarget(id, token),
    },
  );

  // What was chosen from the interface wins over what the command line seeded:
  // the flags are a starting point, the interface is where these are owned.
  const stored = await preferences.read({
    enabled: options.notificationsEnabled,
    on: options.notifyOn,
    scope: options.notifyScope,
    delaySeconds: Math.round(options.notifyDelayMs / 1000),
  });
  engine.applyStoredNotifications(stored.notifications);

  const settingsApi = new SettingsApi(
    preferences,
    { claudeHome: options.roots[0], codexHome: options.roots[1] },
    options.controls,
  );
  const { server, close } = createServiceServer(engine, {
    token,
    port: options.port,
    settings: settingsApi,
  });
  await listen(server, options.host, options.port);

  const file: ServiceFile = {
    host: options.host,
    port: options.port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  await writeServiceFile(options.sharedDir, file);
  await engine.start();

  return {
    engine,
    file,
    url: serviceUrl(file),
    stop: async () => {
      engine.stop();
      await close();
      await clearServiceFile(options.sharedDir, token);
    },
  };
}

/**
 * Codes that mean this port cannot be had, whoever is to blame.
 *
 * `EADDRINUSE` is the obvious one: something holds it. `EACCES` on a loopback
 * port above 1024 is the Windows one, and it is not a permission problem in any
 * useful sense — Hyper-V and WSL reserve blocks of the dynamic range, the blocks
 * are drawn afresh on each boot, and a port inside one is refused although
 * nothing is listening on it. Measured here: a machine restarted overnight came
 * back with 27520-27619 excluded, which covers the port this application asks
 * for first.
 *
 * Both mean the same thing to a caller that only wants somewhere to listen, and
 * treating the second as fatal is what turned a reboot into an application that
 * would not start.
 */
const UNAVAILABLE = new Set(['EADDRINUSE', 'EACCES']);

/** Whether a `listen` failure means to go and ask for a different port. */
export function portUnavailable(code: string | undefined): boolean {
  return UNAVAILABLE.has(code ?? '');
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        portUnavailable(error.code)
          ? new PortInUseError(`Port ${port} cannot be listened on (${error.code}).`)
          : error,
      );
    });
    server.listen(port, host, () => resolve());
  });
}
