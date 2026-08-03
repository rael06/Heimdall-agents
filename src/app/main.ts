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
import { AppRequest, PROTOCOL, openUri, requestFromArgv, showUri } from './protocol';
import { isInstallable } from './release';
import { checkForUpdate, downloadInstaller, runInstaller } from './update';

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
    } else if (!visible && tray) {
      tray.destroy();
      tray = undefined;
    }
    // Remembered, or the icon would come back at every launch and the switch
    // would be something you do rather than something you set.
    void preferences().writeApp({ showTray: visible });
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
      actions: [
        { label: 'Open the session', uri: openUri(id) },
        { label: 'Show the list', uri: showUri() },
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
 * Only ever from the menu: an application that reaches out on its own, and
 * speaks about it, is one more thing interrupting you — and this one exists to
 * interrupt you about exactly one thing.
 */
async function checkForUpdates(): Promise<void> {
  const found = await checkForUpdate(app.getVersion());

  if (found.kind === 'error') {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Could not check for updates',
      message: 'GitHub could not be reached.',
      detail: found.message ?? '',
    });
    return;
  }
  if (found.kind === 'none') {
    await dialog.showMessageBox({
      type: 'info',
      title: 'No release published',
      message: 'There is nothing to update to yet.',
      detail:
        'No published release was found. A private repository answers the same ' +
        'way as one with no releases, so this says nothing about which it is.',
    });
    return;
  }
  if (found.kind === 'current') {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Up to date',
      message: `${APP_NAME} ${app.getVersion()} is the latest version.`,
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
      title: 'Nothing to install',
      message: `Version ${release.version} is published, and carries no Windows installer.`,
      detail: `You are on ${app.getVersion()}. There is nothing here to install from yet.`,
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
      title: 'Update available, but not verifiable',
      message: `Version ${release.version} is published, and cannot be installed from here.`,
      detail:
        `The release carries no checksum manifest, so there is nothing to check ` +
        `the download against. Without a code-signing certificate that manifest ` +
        `is the whole of what can be verified, and running an installer whose ` +
        `only credential is that it arrived over TLS is not something this will ` +
        `do quietly.\n\nInstall it by hand from the releases page if you want it.`,
    });
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Not now', 'Download and install'],
    defaultId: 1,
    cancelId: 0,
    title: 'Update available',
    message: `Version ${release.version} is available. You have ${app.getVersion()}.`,
    detail:
      `The installer is downloaded, checked against the length and the sha512 ` +
      `published with the release, then run — and nothing is run that fails ` +
      `either check. ${APP_NAME} closes while it works and comes back on the ` +
      `new version.\n\n` +
      `It is not code-signed, so Windows may warn about it — the only thing ` +
      `vouching for it is that it came from GitHub over TLS.`,
  });
  if (response !== 1) {
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
      title: 'Update failed',
      message: 'Nothing was installed.',
      detail:
        `${String(error instanceof Error ? error.message : error)}\n\n` +
        `You are still on ${app.getVersion()} and nothing was replaced. Every ` +
        `release stays on the releases page, so an installer can be fetched by ` +
        `hand — and going back to an earlier version is the same thing: install ` +
        `it over this one.`,
    });
  }
}

/** What is running, and where its files are. */
async function about(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: `About ${APP_NAME}`,
    message: `${APP_NAME} ${app.getVersion()}`,
    detail:
      `Electron ${process.versions.electron} · Node ${process.versions.node}\n\n` +
      `Shared files: ${settingsFrom(parseArgs([])).sharedDir}`,
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
    buttons: ['Cancel', 'Uninstall'],
    defaultId: 0,
    cancelId: 0,
    title: `Uninstall ${APP_NAME}`,
    message: `Remove ${APP_NAME} from this computer?`,
    detail:
      `The application closes and the Windows uninstaller takes over.\n\n` +
      `Your marks, titles and settings stay in ${shared}, so a later install ` +
      `picks up where you left off. Delete that folder by hand if you want ` +
      `them gone as well.`,
  });
  if (response !== 1) {
    return;
  }

  try {
    await fs.access(uninstaller);
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Nothing to uninstall',
      message: 'This copy was not installed by the Windows installer.',
      detail:
        `No uninstaller was found beside the executable, which is what a run ` +
        `from a build directory looks like. Delete that directory instead.`,
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
      label: 'File',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => {
            showWindow();
            void window?.webContents.executeJavaScript('window.openSettings?.()');
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
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
          label: `About ${APP_NAME}`,
          click: () => void about(),
        },
        {
          label: 'Check for updates…',
          click: () => void checkForUpdates(),
        },
        { type: 'separator' },
        {
          label: 'Uninstall…',
          click: () => void uninstall(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): Tray {
  const image = nativeImage.createFromPath(iconPath());
  const created = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  created.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: 'Show the list', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Quit',
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

    service = await start();
    window = createWindow(service.url);
    buildMenu();
    // Hidden only if it was hidden deliberately: a first run always shows it,
    // since the tray is where quitting and the settings live.
    if ((await preferences().read()).app.showTray) {
      tray = createTray();
    }
    handle(requestFromArgv(process.argv));
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
