import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from '../model/types';
import { Desktop, cleanEnvironment, createDesktop, openCommand } from './desktop';
import { handover } from './handover';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:abc',
    provider: 'claude',
    nativeId: 'abc',
    title: 'A session',
    status: 'idle',
    statusReason: 'done',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
    cwd: 'C:\\Users\\dev\\projects\\app',
    filePath: 'C:\\Users\\dev\\.claude\\projects\\app\\abc.jsonl',
    ...overrides,
  };
}

function fakeDesktop(failOn?: (uri: string) => boolean): Desktop & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    openExternal: async (uri: string) => {
      if (failOn?.(uri)) throw new Error(`cannot open ${uri}`);
      opened.push(uri);
    },
  };
}

const noSleep = async (): Promise<void> => undefined;

describe('openCommand', () => {
  it('knows how to open a URI on each platform', () => {
    expect(openCommand('win32', 'vscode://x')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'vscode://x'],
    });
    expect(openCommand('darwin', 'vscode://x')).toEqual({ command: 'open', args: ['vscode://x'] });
    expect(openCommand('linux', 'vscode://x')).toEqual({ command: 'xdg-open', args: ['vscode://x'] });
  });

  it('has nothing for a platform it does not know', () => {
    expect(openCommand('aix', 'vscode://x')).toBeUndefined();
  });
});

describe('cleanEnvironment', () => {
  it('drops what VS Code puts in the environment', () => {
    // Started from a VS Code terminal, this process inherits variables that
    // turn Code.exe into a Node interpreter, so a handover reports success and
    // opens nothing at all.
    const cleaned = cleanEnvironment({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
      VSCODE_IPC_HOOK: '\\\\.\\pipe\\whatever',
    });
    expect(cleaned).toEqual({ PATH: '/usr/bin' });
  });

  it('leaves everything else alone', () => {
    expect(cleanEnvironment({ PATH: '/usr/bin', HOME: '/home/dev' })).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
    });
  });
});

describe('createDesktop', () => {
  it('runs the platform command for a URI it built', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await createDesktop('win32', { run }).openExternal('vscode://file/C:/x');
    expect(run).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'vscode://file/C:/x']);
  });

  it('refuses anything that is not a vscode URI it could have produced', async () => {
    const run = vi.fn();
    const desktop = createDesktop('win32', { run });
    await expect(desktop.openExternal('https://evil.example')).rejects.toThrow();
    await expect(desktop.openExternal('vscode://file/x" & calc')).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses on a platform with no implementation rather than pretending', async () => {
    await expect(
      createDesktop('aix', { run: vi.fn() }).openExternal('vscode://file/x'),
    ).rejects.toThrow(/not implemented/);
  });
});

describe('handover', () => {
  it('focuses the window first, then asks it for the session', async () => {
    const desktop = fakeDesktop();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await handover(desktop, session(), 'session', 2000, sleep);
    expect(desktop.opened).toEqual([
      'vscode://file/C:/Users/dev/projects/app',
      'vscode://Anthropic.claude-code/open?session=abc',
    ]);
    // VS Code routes a URI to the focused window, so the wait is the mechanism.
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result.fellBack).toBe(false);
  });

  it('uses the Codex route for a Codex session', async () => {
    const desktop = fakeDesktop();
    await handover(desktop, session({ provider: 'codex', nativeId: 'thread-1' }), 'session', 0, noSleep);
    expect(desktop.opened[1]).toBe('vscode://openai.chatgpt/local/thread-1');
  });

  it('goes straight to the session when no folder was recorded', async () => {
    const desktop = fakeDesktop();
    await handover(desktop, session({ cwd: undefined }), 'session', 0, noSleep);
    expect(desktop.opened).toEqual(['vscode://Anthropic.claude-code/open?session=abc']);
  });

  it('falls back to the transcript when the session route cannot be opened', async () => {
    const desktop = fakeDesktop((uri) => uri.includes('claude-code'));
    const result = await handover(desktop, session(), 'session', 0, noSleep);
    expect(desktop.opened).toEqual([
      'vscode://file/C:/Users/dev/projects/app',
      'vscode://file/C:/Users/dev/.claude/projects/app/abc.jsonl',
    ]);
    expect(result.fellBack).toBe(true);
  });

  it('falls back for a provider it has no route for', async () => {
    const desktop = fakeDesktop();
    const result = await handover(
      desktop,
      session({ provider: 'gemini' as AgentSession['provider'] }),
      'session',
      0,
      noSleep,
    );
    expect(result.fellBack).toBe(true);
    expect(desktop.opened[desktop.opened.length - 1]).toContain('abc.jsonl');
  });

  it('reports the failure when even the transcript cannot be opened', async () => {
    const desktop = fakeDesktop(() => true);
    const result = await handover(desktop, session(), 'session', 0, noSleep);
    expect(result.fellBack).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('opens the workspace on its own', async () => {
    const desktop = fakeDesktop();
    await handover(desktop, session(), 'workspace', 0, noSleep);
    expect(desktop.opened).toEqual(['vscode://file/C:/Users/dev/projects/app']);
  });

  it('opens the transcript when the workspace is unknown, rather than nothing', async () => {
    const desktop = fakeDesktop();
    const result = await handover(desktop, session({ cwd: undefined }), 'workspace', 0, noSleep);
    expect(result.fellBack).toBe(true);
    expect(desktop.opened[0]).toContain('abc.jsonl');
  });

  it('opens the transcript when asked for it', async () => {
    const desktop = fakeDesktop();
    await handover(desktop, session(), 'transcript', 0, noSleep);
    expect(desktop.opened).toEqual(['vscode://file/C:/Users/dev/.claude/projects/app/abc.jsonl']);
  });
});
