import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../core/store';
import { MarksStore } from '../core/marksStore';
import { AgentSession } from '../model/types';
import { SessionProvider } from '../providers/provider';
import { AckStore } from './acks';
import { ServiceEngine } from './engine';
import { NotifyStore } from './notifyMarks';
import { PreferencesStore } from './preferences';
import { SettingsApi } from './settingsApi';
import { OverrideStore } from './statusOverrides';
import { WatchLogStore } from './watchLog';

describe('notification opening', () => {
  let directory: string;
  let engine: ServiceEngine;
  let settings: SettingsApi;
  const launch = vi.fn<(uri: string) => Promise<void>>();
  const nativeId = '019fa35b-eb9b-7002-a6cf-8c7a67429d26';

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-open-'));
    launch.mockReset().mockResolvedValue(undefined);
    const providers: SessionProvider[] = (['claude', 'codex'] as const).map(provider => {
      const session: AgentSession = {
        id: `${provider}:${nativeId}`, nativeId, provider, title: 'Example conversation',
        cwd: '/projects/example', filePath: path.join(directory, `${provider}.jsonl`),
        status: 'idle', statusReason: 'Finished',
        createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:01:00Z',
      };
      return {
        id: provider, root: directory, matchesContent: async () => false,
        scan: async () => ({ sessions: [session], truncated: 0,
          state: { provider, root: directory, available: true, count: 1 } }),
      };
    });
    const store = new SessionStore(() => providers, () => ({ now: Date.now(), staleAfterMs: 0, historyMs: 0, maxSessions: 10 }));
    const preferences = new PreferencesStore(path.join(directory, 'preferences.json'));
    settings = new SettingsApi(preferences, { claudeHome: directory, codexHome: directory });
    engine = new ServiceEngine(store,
      new MarksStore(path.join(directory, 'marks.json')),
      new AckStore(path.join(directory, 'acks.json')),
      new OverrideStore(path.join(directory, 'overrides.json')),
      new WatchLogStore(path.join(directory, 'watch.json')),
      new NotifyStore(path.join(directory, 'notify.json')), preferences,
      { roots: [], debounceMs: 0, maxDebounceMs: 0, fullScanIntervalMs: 60000,
        autoWatch: false, desktop: { openExternal: launch }, notifier: { send: async () => undefined },
        notifyOn: [], notifyScope: 'watched', notifyDelayMs: 0, notificationsEnabled: false,
        notificationTarget: () => ({ launchUri: '', actions: [] }), handoffDelayMs: 0 },
    );
    await engine.refresh();
  });

  afterEach(async () => {
    engine?.stop();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('uses the latest saved provider choice only for notification activations', async () => {
    const id = `codex:${nativeId}`;
    await engine.open(id, 'notification');
    expect(launch).toHaveBeenLastCalledWith(`vscode://openai.chatgpt/local/${nativeId}`);
    await settings.save({ notificationOpen: { codex: 'codex-desktop' } });
    launch.mockClear();
    await engine.open(id, 'notification');
    expect(launch).toHaveBeenCalledExactlyOnceWith(`codex://threads/${nativeId}`);
    await engine.open(`claude:${nativeId}`, 'notification');
    expect(launch).toHaveBeenLastCalledWith(`vscode://Anthropic.claude-code/open?session=${nativeId}`);
    await engine.open(id, 'session');
    expect(launch).toHaveBeenLastCalledWith(`vscode://openai.chatgpt/local/${nativeId}`);
    await settings.save({ notificationOpen: { codex: 'vscode' } });
    await engine.open(id, 'notification');
    expect(launch).toHaveBeenLastCalledWith(`vscode://openai.chatgpt/local/${nativeId}`);
    await engine.open(id, 'codex-desktop');
    expect(launch).toHaveBeenLastCalledWith(`codex://threads/${nativeId}`);
  });

  it('does not acknowledge a conversation when its chosen application fails to launch', async () => {
    await settings.save({ notificationOpen: { codex: 'codex-desktop' } });
    await engine.unacknowledge([`codex:${nativeId}`]);
    const before = engine.currentMarks.unacknowledged;
    expect(before).toContain(`codex:${nativeId}`);
    launch.mockRejectedValueOnce(new Error('application unavailable'));
    await expect(engine.open(`codex:${nativeId}`, 'notification')).rejects.toThrow('application unavailable');
    expect(engine.currentMarks.unacknowledged).toEqual(before);
    launch.mockClear();
    expect(await engine.open('codex:missing', 'notification')).toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });
});
