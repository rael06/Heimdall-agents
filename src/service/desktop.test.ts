import { describe, expect, it } from 'vitest';
import { Runner, cleanEnvironment, createDesktop, openCommand } from './desktop';
import { folderUri } from '../core/uris';

/** Records what would have been launched, instead of launching it. */
function recorder(): { runner: Runner; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    runner: {
      run: async (command, args) => {
        calls.push({ command, args });
      },
    },
  };
}

describe('openCommand', () => {
  it('hands the URI to Windows without going through a command interpreter', () => {
    // Measured, through a real protocol handler registered for the test:
    // `cmd /c start "" <uri>` delivers `…/projects/R` for a workspace called
    // `R&D`, because `cmd` reads the ampersand as a command separator and runs
    // what follows it. `rundll32 url.dll,FileProtocolHandler` delivers the whole
    // URI and still reports a usable exit code, which `explorer.exe` does not:
    // it answers 1 even when it succeeded.
    const command = openCommand('win32', 'vscode://file/C:/projects/R&D');
    expect(command).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', 'vscode://file/C:/projects/R&D'],
    });
  });

  it('keeps the URI as one argument, whatever it contains', () => {
    // The whole point: an argument is an argument. Nothing re-parses it, so a
    // shell metacharacter is just a character.
    for (const hostile of ['a&b', 'a|b', 'a>b', 'a^b', 'a(b)c']) {
      const command = openCommand('win32', `vscode://file/C:/${hostile}`);
      expect(command?.args).toHaveLength(2);
      expect(command?.args[1]).toBe(`vscode://file/C:/${hostile}`);
    }
  });

  it('uses the platform opener elsewhere', () => {
    expect(openCommand('darwin', 'vscode://file/tmp')).toEqual({
      command: 'open',
      args: ['vscode://file/tmp'],
    });
    expect(openCommand('linux', 'vscode://file/tmp')).toEqual({
      command: 'xdg-open',
      args: ['vscode://file/tmp'],
    });
  });

  it('has nothing to offer on a platform it does not know', () => {
    expect(openCommand('aix', 'vscode://file/tmp')).toBeUndefined();
  });
});

describe('createDesktop', () => {
  it('opens a workspace whose name contains an ampersand, intact', async () => {
    const { runner, calls } = recorder();
    const uri = folderUri('C:\\projects\\R&D');

    await createDesktop('win32', runner).openExternal(uri);

    expect(calls).toHaveLength(1);
    // Not truncated, and not split across two arguments.
    expect(calls[0].args.at(-1)).toBe('vscode://file/C:/projects/R&D');
  });

  it('refuses a URI it did not build', async () => {
    const { runner, calls } = recorder();
    const desktop = createDesktop('win32', runner);

    await expect(desktop.openExternal('https://example.com')).rejects.toThrow(/unexpected URI/);
    await expect(desktop.openExternal('file:///C:/x')).rejects.toThrow(/unexpected URI/);
    // Kept from the test this replaces. It reads as an injection case and is
    // not one: what `SAFE_URI` rejects here is the quote, not the ampersand.
    // `vscode://file/C:/projects/R&D` passes the very same check, which is why
    // the ampersand reached `cmd` for as long as it did.
    await expect(desktop.openExternal('vscode://file/x" & calc')).rejects.toThrow(/unexpected URI/);
    expect(calls).toEqual([]);
  });

  it('says so rather than failing quietly on an unsupported platform', async () => {
    const { runner } = recorder();
    await expect(
      createDesktop('aix', runner).openExternal('vscode://file/tmp'),
    ).rejects.toThrow(/not implemented on aix/);
  });
});

describe('cleanEnvironment', () => {
  it('strips what VS Code puts in the environment', () => {
    // A process started from a VS Code terminal inherits ELECTRON_RUN_AS_NODE=1,
    // which makes Code.exe start as a Node interpreter and exit without a word.
    const cleaned = cleanEnvironment({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      // These point a fresh instance at the extension host of the one we were
      // launched from.
      VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
      VSCODE_IPC_HOOK: '\\\\.\\pipe\\whatever',
      HOME: '/home/dev',
    });
    expect(cleaned).toEqual({ PATH: '/usr/bin', HOME: '/home/dev' });
  });

  it('leaves an environment with nothing to strip alone', () => {
    expect(cleanEnvironment({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});
