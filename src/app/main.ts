import { BrowserWindow, Menu, Tray, app, dialog, nativeImage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import * as path from 'node:path';
import { parseArgs } from '../cli/args';
import { buildStore } from '../cli/context';
import { settingsFrom } from '../cli/settings';
import { PortInUseError, StartedService, startService } from '../service/bootstrap';
import { PreferencesStore, preferencesFilePath } from '../service/preferences';
import { HostControls } from '../service/settingsApi';
import { createDesktop } from '../service/desktop';
import { ElectronNotifier } from './notifier';
import { AppRequest, PROTOCOL, ackUri, openUri, requestFromArgv } from './protocol';
import { isInstallable } from './release';
import {
  checkForUpdate,
  downloadInstaller,
  runInstaller,
  updateAnswer,
  updateButtons,
  worthAnnouncing,
} from './update';
import type { Release } from './release';
import { trayIcon } from './trayIcon';
import { Language, appLanguage, text } from './strings';

/**
 * The desktop application: the same service, the same interface, in a window
 * that owns an identity.
 *
 * Nothing here re-implements the service. It starts the very same one the
 * `asm serve` command starts, and loads the very same page. What it adds is
 * what only an installed application can have — a name Windows knows, a
 * protocol of its own, a tray, and a shortcut.
 */

const APP_NAME = 'Heimdall agents';

/**
 * Windows files notifications under this identifier and remembers what was
 * allowed against it, so changing it costs one round of permissions. Aligned
 * with the name now, while this is a one-person cost: after publication it
 * would be paid by everyone the installer was handed to.
 */
const APP_ID = 'com.rael06.heimdall-agents';
const PREFERRED_PORT = 27600;
const HOST = '127.0.0.1';

let service: StartedService | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
/** Set when the user really means it, so closing the window only hides it. */
let quitting = false;
/**
 * The language everything below is written in, resolved once and again on every
 * change. Held rather than looked up per string: a menu is built in one pass.
 */
let language: Language = 'en';

/** One string of this application's own, in the language in force. */
const say = (key: string, values: Record<string, string | number> = {}): string =>
  text(language, key, { app: APP_NAME, ...values });

function iconPath(): string {
  return path.join(__dirname, '..', 'build', 'icon.png');
}

function preferences(): PreferencesStore {
  return new PreferencesStore(preferencesFilePath(settingsFrom(parseArgs([])).sharedDir));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** What the interface can change about the application itself. */
const controls: HostControls = {
  startsWithLogin: () => app.getLoginItemSettings().openAtLogin,
  setStartsWithLogin: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
  trayVisible: () => Boolean(tray),
  setTrayVisible: (visible) => {
    if (visible && !tray) {
      tray = createTray();
      // Switched back on mid-run, it starts at whatever is unseen now rather
      // than at nothing until the next scan changes something.
      paintTray(service?.engine.currentMarks.unacknowledged.length ?? 0);
    } else if (!visible && tray) {
      tray.destroy();
      tray = undefined;
    }
    // Remembered, or the icon would come back at every launch and the switch
    // would be something you do rather than something you set.
    void preferences().writeApp({ showTray: visible });
  },
  setLanguage: (chosen) => {
    language = appLanguage(chosen, app.getLocale());
    // Both are built from strings resolved when they were built, so both are
    // built again. The tray is destroyed and remade rather than relabelled: its
    // menu is a template, not a live object.
    buildMenu();
    if (tray) {
      tray.destroy();
      tray = createTray();
      paintTray(service?.engine.currentMarks.unacknowledged.length ?? 0);
    }
  },
  // Relaunching is how a setting that the providers were built with takes hold:
  // they are constructed once, and a setter cannot reach back into them.
  restart: () => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  },
};

async function start(): Promise<StartedService> {
  // Defaults seed these; whatever was chosen in the interface then wins, which
  // is the only way an application with no command line can be configured.
  const settings = settingsFrom(parseArgs([]));
  const stored = await new PreferencesStore(
    preferencesFilePath(settings.sharedDir),
  ).read();

  const claudeHome = stored.providers.claudeHome || settings.claudeHome;
  const codexHome = stored.providers.codexHome || settings.codexHome;
  const scan = stored.scan;

  const options = {
    store: buildStore({
      ...settings,
      claudeHome,
      codexHome,
      includeSubagentSessions: scan.includeSubagents,
      maxSessions: scan.maxSessions,
      historyMs: scan.historyDays > 0 ? scan.historyDays * 24 * 60 * 60 * 1000 : 0,
      staleAfterMs: scan.staleAfterMinutes * 60 * 1000,
    }),
    sharedDir: settings.sharedDir,
    host: HOST,
    roots: [claudeHome, codexHome],
    debounceMs: 250,
    maxDebounceMs: 2000,
    fullScanIntervalMs: 30_000,
    autoWatch: scan.autoWatch,
    desktop: createDesktop(),
    handoffDelayMs: scan.handoffDelaySeconds * 1000,
    controls,
    notifier: new ElectronNotifier(),
    notifyOn: settings.notifyOn,
    notifyScope: settings.notifyScope,
      notifyDelayMs: settings.notifyDelayMs,
    notificationsEnabled: settings.notificationsEnabled,
    // The whole point of being an application: a toast button hands the URI
    // straight back to us, so one click opens the session. No browser, no page,
    // no second click.
    notificationTarget: (id: string) => ({
      launchUri: openUri(id),
      // Two, which is what the note on `ToastContent.actions` says a toast can
      // carry and still read. "Show the list" was the third and is gone: it was
      // the least useful of them once clicking the toast itself opens the
      // session, and the answer it displaced — deciding not to go and look — is
      // the one worth having a button for.
      //
      // Dismissing on the left, acting on the right, because that is the order
      // the answers come in: the question a toast asks is whether this is worth
      // interrupting for, and "no" is answered first.
      actions: [
        { label: say('toast.markSeen'), uri: ackUri(id) },
        { label: say('toast.open'), uri: openUri(id) },
      ],
    }),
  };

  try {
    return await startService({ ...options, port: PREFERRED_PORT });
  } catch (error) {
    if (!(error instanceof PortInUseError)) {
      throw error;
    }
    // Something else holds the usual port — an `asm serve` left running, most
    // likely. Take another one rather than refusing to start.
    return startService({ ...options, port: await freePort() });
  }
}

function showWindow(): void {
  if (!window || !service) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function createWindow(url: string): BrowserWindow {
  const created = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    title: APP_NAME,
    icon: iconPath(),
    backgroundColor: '#16171b',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  void created.loadURL(url);
  created.once('ready-to-show', () => created.show());

  // Anything that is not our own page is someone else's business, and belongs
  // in the browser rather than in this window.
  created.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  // Closing hides: the service has to keep watching with everything closed,
  // which is the reason it exists. Quitting is done deliberately, from the tray.
  created.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      created.hide();
    }
  });
  return created;
}

/**
 * Offers the latest release, and installs it when told to.
 *
 * This used to say "only ever from the menu: an application that reaches out on
 * its own, and speaks about it, is one more thing interrupting you". That is
 * reversed, deliberately, because a release nobody hears about is a release
 * nobody installs — and the reason behind the old rule is kept rather than
 * discarded. A check at launch says nothing at all unless there is something to
 * act on, and what it offers can be turned down for good.
 */
async function checkForUpdates(): Promise<void> {
  const found = await checkForUpdate(app.getVersion());

  if (found.kind === 'error') {
    await dialog.showMessageBox({
      type: 'error',
      title: say('update.errorTitle'),
      message: say('update.errorMessage'),
      detail: found.message ?? '',
    });
    return;
  }
  if (found.kind === 'none') {
    await dialog.showMessageBox({
      type: 'info',
      title: say('update.noneTitle'),
      message: say('update.noneMessage'),
      detail: say('update.noneDetail'),
    });
    return;
  }
  if (found.kind === 'current') {
    await dialog.showMessageBox({
      type: 'info',
      title: say('update.currentTitle'),
      message: say('update.currentMessage', { version: app.getVersion() }),
    });
    return;
  }

  const release = found.release;
  if (!release) {
    return;
  }

  // A newer release with nothing to install is not "up to date", which is what
  // this used to say — a version number the reader can see is newer than theirs,
  // under a title claiming they have the latest.
  if (!release.installer) {
    await dialog.showMessageBox({
      type: 'info',
      title: say('update.noInstallerTitle'),
      message: say('update.noInstallerMessage', { version: release.version }),
      detail: say('update.noInstallerDetail', { current: app.getVersion() }),
    });
    return;
  }

  // Said before the choice rather than discovered after it. The published
  // sha512 is the only thing that can be verified without a certificate, so a
  // release that carries no manifest is one this cannot install from — and
  // offering the button and then failing would be the same lie, later.
  if (!isInstallable(release)) {
    await dialog.showMessageBox({
      type: 'warning',
      title: say('update.unverifiableTitle'),
      message: say('update.unverifiableMessage', { version: release.version }),
      detail: say('update.unverifiableDetail'),
    });
    return;
  }

  await offerUpdate(release, false);
}

/**
 * The offer itself, and the install behind it.
 *
 * `skippable` is the whole difference between the two ways in. Asked from the
 * menu, "Not now" means not now; there is no reason to offer never, because
 * nothing will ask again unless the reader does. Raised at launch, the same
 * answer would be given again at the next launch and every one after it, so
 * that route carries a third button — and it is a button rather than an
 * inference from "Not now", which would be the application deciding what an
 * answer meant.
 */
async function offerUpdate(release: Release, skippable: boolean): Promise<void> {
  const answers = updateButtons(skippable);
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: answers.map((answer) => say(`update.${answer}`)),
    defaultId: answers.length - 1,
    // Escape lands on "not now", which is the last button in neither list.
    cancelId: skippable ? 1 : 0,
    title: say('update.availableTitle'),
    message: say('update.availableMessage', {
      version: release.version,
      current: app.getVersion(),
    }),
    detail: say('update.availableDetail'),
  });
  const answer = updateAnswer(skippable, response);
  if (answer === 'skip') {
    await preferences().writeApp({ skippedVersion: release.version });
    return;
  }
  if (answer !== 'install') {
    return;
  }

  try {
    // On the taskbar button, which is where Windows already shows the progress
    // of a download and needs no window of our own. A modal that cannot be
    // updated is why this used to look like a hang for the length of a 200 MB
    // transfer.
    const installer = await downloadInstaller(release, (fraction) => {
      // -1 clears it; 2 is the indeterminate barber's pole, for a release that
      // declared no length.
      window?.setProgressBar(fraction ?? 2);
    });
    window?.setProgressBar(-1);
    runInstaller(installer, () => {
      quitting = true;
      app.quit();
    });
  } catch (error) {
    window?.setProgressBar(-1);
    await dialog.showMessageBox({
      type: 'error',
      title: say('update.failedTitle'),
      message: say('update.failedMessage'),
      detail: say('update.failedDetail', {
        error: String(error instanceof Error ? error.message : error),
        current: app.getVersion(),
      }),
    });
  }
}

/**
 * How long the launch check waits before reaching out.
 *
 * Startup already has work to do — a service to bring up, two transcript trees
 * to scan — and a network round trip competing with the first paint would be
 * paid for by the thing the reader is actually waiting for. Ten seconds is also
 * long enough that a dialog never lands on a window that is not yet on screen.
 */
const LAUNCH_CHECK_DELAY_MS = 10_000;

/**
 * The check nobody asked for, which is why it mostly says nothing.
 *
 * Every failure is swallowed on purpose: launching offline, behind a captive
 * portal, or with GitHub having a bad morning are not things to be told about
 * by an application that was opened to look at something else. The menu item is
 * where those answers live, because there somebody asked.
 */
async function checkForUpdatesAtLaunch(): Promise<void> {
  try {
    const [found, stored] = await Promise.all([
      checkForUpdate(app.getVersion()),
      preferences().read(),
    ]);
    if (!worthAnnouncing(found, stored.app.skippedVersion) || !found.release) {
      return;
    }
    await offerUpdate(found.release, true);
  } catch {
    // Deliberately nothing. See above.
  }
}

/** What is running, and where its files are. */
async function about(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: say('about.title'),
    message: say('about.message', { version: app.getVersion() }),
    detail: say('about.detail', {
      electron: process.versions.electron,
      node: process.versions.node,
      shared: settingsFrom(parseArgs([])).sharedDir,
    }),
  });
}

/**
 * Removes the application, using the uninstaller Windows already registered.
 *
 * Not a home-made removal: NSIS wrote the shortcuts, the registry entry and the
 * protocol handler, and it is the only thing that knows how to take them all
 * back. Anything else would leave the Add-or-remove-programs entry pointing at
 * a directory that no longer exists.
 *
 * What it will not touch is said before it runs rather than discovered after:
 * the marks, the resolved titles and the settings live in a directory of their
 * own, so reinstalling finds them again — and so removing the application never
 * throws away what you spent time marking.
 */
async function uninstall(): Promise<void> {
  const uninstaller = path.join(path.dirname(app.getPath('exe')), `Uninstall ${APP_NAME}.exe`);
  const shared = settingsFrom(parseArgs([])).sharedDir;

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [say('uninstall.cancel'), say('uninstall.confirm')],
    defaultId: 0,
    cancelId: 0,
    title: say('uninstall.title'),
    message: say('uninstall.message'),
    detail: say('uninstall.detail', { shared }),
  });
  if (response !== 1) {
    return;
  }

  try {
    await fs.access(uninstaller);
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: say('uninstall.noneTitle'),
      message: say('uninstall.noneMessage'),
      detail: say('uninstall.noneDetail'),
    });
    return;
  }

  // Detached, and the application quits: the uninstaller cannot replace files
  // that are still open, and waiting for a process that outlives us is pointless.
  spawn(uninstaller, ['/currentuser'], { detached: true, stdio: 'ignore' }).unref();
  quitting = true;
  app.quit();
}

/**
 * The application menu, with Settings where an application is expected to keep
 * it — under File, on `Ctrl+,`, which is the convention on Windows and the
 * shortcut every editor already trains you to use.
 *
 * The panel itself lives in the page, so the menu asks the page to open it.
 * `window.openSettings` is the only door between the two worlds, and it is
 * called by name rather than by simulating a click on a button that may move.
 */
function buildMenu(): void {
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    {
      label: say('menu.file'),
      submenu: [
        {
          label: say('menu.settings'),
          accelerator: 'CommandOrControl+,',
          click: () => {
            showWindow();
            void window?.webContents.executeJavaScript('window.openSettings?.()');
          },
        },
        { type: 'separator' },
        {
          label: say('menu.quit'),
          accelerator: 'CommandOrControl+Q',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      // Where an application is expected to keep what it says about itself, and
      // how to be rid of it.
      role: 'help',
      submenu: [
        {
          label: say('menu.help.about'),
          click: () => void about(),
        },
        {
          label: say('menu.help.updates'),
          click: () => void checkForUpdates(),
        },
        { type: 'separator' },
        {
          label: say('menu.help.uninstall'),
          click: () => void uninstall(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * The dot beside a status, counted up and put where it can be seen from
 * anywhere.
 *
 * The dot says "this status is new to you" one row at a time, which is only
 * legible when the list is on screen — and the list is hidden most of the time,
 * which is what the tray is for. The count is the same fact, summed.
 *
 * The exact number goes in the tooltip whatever the badge shows. A tray icon is
 * sixteen pixels and a digit inside a badge on it is about five, so the drawing
 * stops being a number at ten and says `+` instead; the tooltip never has to.
 */
function paintTray(count: number): void {
  if (!tray) {
    return;
  }
  tray.setImage(nativeImage.createFromBuffer(trayIcon(count)));
  tray.setToolTip(
    count === 0 ? APP_NAME : say(count === 1 ? 'tray.unseenOne' : 'tray.unseen', { count }),
  );
}

function createTray(): Tray {
  const created = new Tray(nativeImage.createFromBuffer(trayIcon(0)));
  created.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: say('tray.show'), click: () => showWindow() },
    { type: 'separator' },
    {
      label: say('tray.login'),
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: say('tray.quit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  created.setContextMenu(menu);
  created.on('double-click', () => showWindow());
  return created;
}

function handle(request: AppRequest | undefined): void {
  if (!request) {
    showWindow();
    return;
  }
  // No window, on purpose: turning a toast down is only cheap if it costs
  // nothing to turn down, and a window opened to be closed again is not nothing.
  // The tray count drops as the marks change, which is the whole answer.
  if (request.kind === 'ack') {
    void service?.engine.acknowledge([request.id]);
    return;
  }
  if (request.kind === 'show') {
    showWindow();
    return;
  }
  // The handover runs in the service, exactly as it does from the interface —
  // there is one implementation of it and this is not a second one.
  void service?.engine.open(request.id, 'session');
}

// Windows shows the name and icon of the application that owns this identifier
// on every toast, and files them under it in the notification settings.
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // A second launch is how Windows delivers a protocol activation. The instance
  // already running is the one that answers it.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => handle(requestFromArgv(argv)));

  app.whenReady().then(async () => {
    // In development the executable is Electron itself, so the scheme has to
    // name what to run as well as where.
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(PROTOCOL);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }

    // Before anything with a label on it. `app.getLocale()` is only meaningful
    // once the application is ready, which is why this is here and not beside
    // the declaration.
    const stored = await preferences().read();
    language = appLanguage(stored.app.language, app.getLocale());

    service = await start();
    window = createWindow(service.url);
    buildMenu();
    // Hidden only if it was hidden deliberately: a first run always shows it,
    // since the tray is where quitting and the settings live.
    if (stored.app.showTray) {
      tray = createTray();
    }
    // The same set the dots are drawn from, so the two cannot disagree: there is
    // no second idea of what counts as unseen.
    paintTray(service.engine.currentMarks.unacknowledged.length);
    service.engine.onMarks((marks) => paintTray(marks.unacknowledged.length));
    handle(requestFromArgv(process.argv));

    // Behind a timer rather than awaited: the window is up and the reader is
    // already using it while this happens, and it must never be a thing the
    // start waits on. Unreferenced so it cannot hold a quit open either.
    setTimeout(() => void checkForUpdatesAtLaunch(), LAUNCH_CHECK_DELAY_MS).unref();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    tray?.destroy();
    void service?.stop();
  });

  // The window closing is not the application ending: it keeps watching.
  app.on('window-all-closed', () => undefined);
}
