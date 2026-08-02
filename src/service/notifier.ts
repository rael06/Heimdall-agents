import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ToastContent, toastXml } from './toast';

/**
 * Raises a native notification. This is the feature that makes the service
 * worth running with everything closed, and the easiest to ruin: one too many
 * and the channel gets muted for good. What gets sent is decided elsewhere, in
 * `notifications.ts`; this only knows how to show it.
 */
export interface Notifier {
  send(content: ToastContent): Promise<void>;
}

/** A platform with no implementation. Silence must never be a crash. */
export const silentNotifier: Notifier = {
  send: async () => undefined,
};

/**
 * Windows, through PowerShell. Measured at roughly a second per toast, which is
 * paid only when something actually needs attention. A bundled SnoreToast.exe
 * would bring it under 50 ms; that is a binary in the repository, and a trade
 * to make when the delay is felt rather than before.
 */
export class WindowsNotifier implements Notifier {
  constructor(private readonly scriptPath = path.join(__dirname, '..', 'native', 'toast.ps1')) {}

  async send(content: ToastContent): Promise<void> {
    const file = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'asm-toast-')),
      'toast.xml',
    );
    await fs.writeFile(file, toastXml(content), 'utf8');
    try {
      await this.run(file);
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(xmlPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Windows PowerShell, not pwsh: the WinRT notification types are not
      // loadable from PowerShell 7 without extra assemblies.
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.scriptPath,
          '-XmlPath',
          xmlPath,
        ],
        { stdio: 'ignore', windowsHide: true },
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`toast.ps1 exited with ${code}`)),
      );
    });
  }
}

export function createNotifier(platform: NodeJS.Platform = process.platform): Notifier {
  return platform === 'win32' ? new WindowsNotifier() : silentNotifier;
}
