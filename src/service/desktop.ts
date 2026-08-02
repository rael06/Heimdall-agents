import { spawn } from 'node:child_process';

/**
 * The one thing the browser cannot do: ask the operating system to open a URI.
 *
 * Windows is implemented; the others are written down and untested, because the
 * machine to test them on is not this one. Nothing here may take the service
 * down: a handover that fails is a click that leads nowhere, not a crash.
 */
export interface Desktop {
  openExternal(uri: string): Promise<void>;
}

export interface Runner {
  run(command: string, args: string[]): Promise<void>;
}

/**
 * Only URIs this service built itself. Identifiers and paths are escaped when
 * the URI is assembled, so anything outside this alphabet means something has
 * gone wrong upstream and the shell is the last place to find that out.
 */
const SAFE_URI = /^vscode:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

export function openCommand(
  platform: NodeJS.Platform,
  uri: string,
): { command: string; args: string[] } | undefined {
  switch (platform) {
    case 'win32':
      // `start` is a cmd builtin, and its first quoted argument is the window
      // title — hence the empty one, or a quoted URI would be taken for it.
      return { command: 'cmd', args: ['/c', 'start', '', uri] };
    case 'darwin':
      return { command: 'open', args: [uri] };
    case 'linux':
      return { command: 'xdg-open', args: [uri] };
    default:
      return undefined;
  }
}

/**
 * The environment, minus what VS Code puts in it.
 *
 * Measured, after a handover that reported success and did nothing: started
 * from a VS Code terminal, this process inherits `ELECTRON_RUN_AS_NODE=1`, and
 * `Code.exe` launched with it runs as a Node interpreter instead of as the
 * editor — it answers `bad option: --open-url` and exits quietly. `start`
 * returns 0 either way, so the failure is invisible from here.
 *
 * `VSCODE_*` is stripped for the same reason: `VSCODE_ESM_ENTRYPOINT` and
 * `VSCODE_IPC_HOOK` point a fresh instance at the extension host of the one we
 * were launched from.
 */
export function cleanEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('ELECTRON_') || key.startsWith('VSCODE_')) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export const systemRunner: Runner = {
  run: (command, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'ignore',
        windowsHide: true,
        env: cleanEnvironment(),
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
      );
    }),
};

export function createDesktop(
  platform: NodeJS.Platform = process.platform,
  runner: Runner = systemRunner,
): Desktop {
  return {
    async openExternal(uri: string): Promise<void> {
      if (!SAFE_URI.test(uri)) {
        throw new Error(`Refusing to open an unexpected URI: ${uri}`);
      }
      const command = openCommand(platform, uri);
      if (!command) {
        throw new Error(`Opening a URI is not implemented on ${platform}.`);
      }
      await runner.run(command.command, command.args);
    },
  };
}
