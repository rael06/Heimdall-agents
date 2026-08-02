import { PortInUseError, startService } from '../service/bootstrap';
import { createDesktop } from '../service/desktop';
import { createNotifier } from '../service/notifier';
import { probeService } from '../service/probe';
import { readServiceFile, serviceUrl } from '../service/token';
import { ParsedArgs, UsageError, number, unknownOptions } from './args';
import { buildStore } from './context';
import { write, writeError } from './output';
import { SETTINGS_OPTIONS, settingsFrom } from './settings';

const SERVE_OPTIONS = ['port', 'debounce', 'max-debounce', 'full-scan'];
const HOST = '127.0.0.1';
export const DEFAULT_PORT = 27600;

export async function serve(args: ParsedArgs): Promise<number> {
  const unknown = unknownOptions(args, [...SETTINGS_OPTIONS, ...SERVE_OPTIONS]);
  if (unknown.length) {
    throw new UsageError(
      `Unknown option(s) for \`asm serve\`: ${unknown.map((n) => `--${n}`).join(', ')}`,
    );
  }

  const settings = settingsFrom(args);
  const port = number(args, 'port', DEFAULT_PORT);
  const directory = settings.sharedDir;

  // A service already running is not an error to report but an address to hand
  // over. Only a recorded service answering with its own token counts.
  const known = await readServiceFile(directory);
  if (known && known.port === port && (await probeService(known))) {
    write(`Already running (pid ${known.pid}).`);
    write(serviceUrl(known));
    return 0;
  }

  const fullScanIntervalMs = Math.max(1, number(args, 'full-scan', 30)) * 1000;
  let service;
  try {
    service = await startService({
      store: buildStore(settings),
      sharedDir: directory,
      host: HOST,
      port,
      roots: [settings.claudeHome, settings.codexHome],
      debounceMs: number(args, 'debounce', 250),
      maxDebounceMs: number(args, 'max-debounce', 2000),
      fullScanIntervalMs,
      autoWatch: settings.autoWatch,
      desktop: createDesktop(),
      handoffDelayMs: settings.handoffDelayMs,
      notifier: createNotifier(),
      notifyOn: settings.notifyOn,
      notifyScope: settings.notifyScope,
      notifyDelayMs: settings.notifyDelayMs,
      notificationsEnabled: settings.notificationsEnabled,
      // Served in a browser, so a notification sends the browser back here and
      // the page asks the service to perform the two-step handover. The desktop
      // application uses its own protocol instead, and needs no detour.
      notificationTarget: (id, token) => ({
        launchUri: `http://${HOST}:${port}/?token=${token}&open=${encodeURIComponent(id)}`,
        actions: [
          {
            label: 'Open the session',
            uri: `http://${HOST}:${port}/?token=${token}&open=${encodeURIComponent(id)}`,
          },
          { label: 'Show the list', uri: `http://${HOST}:${port}/?token=${token}` },
        ],
      }),
    });
  } catch (error) {
    writeError(
      error instanceof PortInUseError
        ? `${error.message} Use --port to pick another one.`
        : String(error),
    );
    return 1;
  }

  const state = service.engine.state;
  write(service.url);
  write(
    state.watching.length
      ? `Watching ${state.watching.length} root(s); full scan every ${fullScanIntervalMs / 1000}s as a safety net.`
      : 'No root could be watched; the full scan is the only source.',
  );
  for (const failure of state.watchFailures) {
    writeError(`Not watching ${failure.root}: ${failure.error}`);
  }
  write('Ctrl-C to stop.');

  // The address file describes a live process, so it is removed on the way out.
  // It is a courtesy, not a guarantee: Windows has no real signals, so a hard
  // kill runs nothing and leaves the file behind. That is why the check above
  // asks the recorded service whether it answers instead of believing the file.
  const shutdown = async (): Promise<void> => {
    await service.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // The server keeps the event loop alive; this never settles on its own.
  return new Promise<number>(() => undefined);
}
