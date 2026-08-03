import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from '../model/types';
import { Desktop } from './desktop';
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

// `openCommand`, `cleanEnvironment` and `createDesktop` are exercised beside the
// module that owns them, in `desktop.test.ts`. They lived here, which is why a
// bug in how a URI reaches Windows read as a gap in `desktop.ts`'s coverage.

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
