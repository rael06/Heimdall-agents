import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCAN, PreferencesStore, preferencesFilePath } from './preferences';
import { HostControls, SettingsApi, needsRestart, SettingsView } from './settingsApi';

const effective = { claudeHome: '/roots/claude', codexHome: '/roots/codex' };

function view(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    providers: { claudeHome: '', codexHome: '' },
    scan: DEFAULT_SCAN,
    notifications: { enabled: true, on: ['idle'], scope: 'watched', delaySeconds: 5 },
    app: { language: 'auto' },
    effective,
    ...overrides,
  };
}

describe('needsRestart', () => {
  it('wants one for anything the providers were built with', () => {
    // They are constructed once, with these values, and a setter cannot reach
    // back into them.
    expect(needsRestart(view(), { providers: { claudeHome: '/elsewhere' } })).toBe(true);
    expect(needsRestart(view(), { scan: { maxSessions: 42 } })).toBe(true);
  });

  it('wants none for what the host applies at once', () => {
    expect(needsRestart(view(), { host: { trayVisible: false } })).toBe(false);
    expect(needsRestart(view(), {})).toBe(false);
  });

  it('wants none when the value sent is the one already in force', () => {
    // Saving without changing anything must not ask for a restart, or every
    // visit to the panel costs one.
    expect(needsRestart(view(), { providers: { claudeHome: '' } })).toBe(false);
    expect(needsRestart(view(), { scan: { maxSessions: DEFAULT_SCAN.maxSessions } })).toBe(false);
  });

  it('ignores a key sent as undefined rather than treating it as a change', () => {
    expect(needsRestart(view(), { scan: { maxSessions: undefined } })).toBe(false);
  });
});

describe('SettingsApi', () => {
  let shared: string;
  let store: PreferencesStore;

  beforeEach(async () => {
    shared = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-api-'));
    store = new PreferencesStore(preferencesFilePath(shared));
  });

  afterEach(async () => {
    await fs.rm(shared, { recursive: true, force: true }).catch(() => undefined);
  });

  function controls(): HostControls & { calls: string[] } {
    const calls: string[] = [];
    let login = false;
    let tray = true;
    return {
      calls,
      startsWithLogin: () => login,
      setStartsWithLogin: (enabled) => {
        login = enabled;
        calls.push(`login:${enabled}`);
      },
      trayVisible: () => tray,
      setTrayVisible: (visible) => {
        tray = visible;
        calls.push(`tray:${visible}`);
      },
      setLanguage: (chosen) => {
        calls.push(`language:${chosen}`);
      },
      restart: () => calls.push('restart'),
    };
  }

  it('withholds the host section from a service that has no window', async () => {
    // A bare `asm serve` has nothing to start at login and no tray, so the
    // interface hides the section rather than offering a switch that does
    // nothing.
    const api = new SettingsApi(store, effective);
    expect((await api.read()).host).toBeUndefined();
    expect(api.restart()).toBe(false);
  });

  it('offers it when the host can actually do those things', async () => {
    const api = new SettingsApi(store, effective, controls());
    expect((await api.read()).host).toEqual({ startsWithLogin: false, trayVisible: true });
  });

  it('reports what is in force beside what was stored', async () => {
    // They differ until a restart, and saying so is the whole point of the
    // placeholder in the interface.
    await store.writeProviders({ claudeHome: '/chosen', codexHome: '' });
    const saved = await new SettingsApi(store, effective).read();
    expect(saved.providers.claudeHome).toBe('/chosen');
    expect(saved.effective.claudeHome).toBe('/roots/claude');
  });

  it('persists a saved value and says whether it needs a restart', async () => {
    const api = new SettingsApi(store, effective);
    const result = await api.save({ scan: { maxSessions: 1200 } });
    expect(result.restartRequired).toBe(true);
    expect(result.saved.scan.maxSessions).toBe(1200);
    // Read back through a fresh store: it is on disk, not in memory.
    expect((await new PreferencesStore(preferencesFilePath(shared)).read()).scan.maxSessions).toBe(
      1200,
    );
  });

  it('clamps on the way in, so an out-of-range value never reaches a provider', async () => {
    const api = new SettingsApi(store, effective);
    const result = await api.save({ scan: { maxSessions: 1e9 } });
    expect(result.saved.scan.maxSessions).toBe(5000);
  });

  it('applies the host settings at once rather than making them wait', async () => {
    const host = controls();
    const api = new SettingsApi(store, effective, host);
    const result = await api.save({ host: { startsWithLogin: true, trayVisible: false } });
    expect(host.calls).toEqual(['login:true', 'tray:false']);
    // They are the host's own state, so nothing about them needs a restart.
    expect(result.restartRequired).toBe(false);
    expect(result.saved.host).toEqual({ startsWithLogin: true, trayVisible: false });
  });

  it('leaves a section alone when the request does not mention it', async () => {
    const host = controls();
    const api = new SettingsApi(store, effective, host);
    await api.save({ scan: { historyDays: 7 } });
    expect(host.calls).toEqual([]);
    const after = await api.read();
    expect(after.scan.historyDays).toBe(7);
    // The untouched half keeps its default rather than being blanked.
    expect(after.scan.maxSessions).toBe(DEFAULT_SCAN.maxSessions);
    expect(after.providers.claudeHome).toBe('');
  });

  it('restarts only when there is a host to do it', () => {
    const host = controls();
    expect(new SettingsApi(store, effective, host).restart()).toBe(true);
    expect(host.calls).toEqual(['restart']);
  });

  it('probes both providers at once', async () => {
    const api = new SettingsApi(store, effective);
    const found = await api.detect();
    expect(found.map((entry) => entry.provider).sort()).toEqual(['claude', 'codex']);
  });
});

describe('SettingsApi, when the host misbehaves', () => {
  it('does not swallow a failure from the host it was given', async () => {
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-api-'));
    const store = new PreferencesStore(preferencesFilePath(shared));
    const api = new SettingsApi(store, effective, {
      startsWithLogin: () => false,
      setStartsWithLogin: vi.fn(() => {
        throw new Error('the operating system said no');
      }),
      trayVisible: () => true,
      setTrayVisible: vi.fn(),
      setLanguage: vi.fn(),
      restart: vi.fn(),
    });

    // A switch that reports success and changed nothing is worse than one that
    // says it failed.
    await expect(api.save({ host: { startsWithLogin: true } })).rejects.toThrow(/said no/);
    await fs.rm(shared, { recursive: true, force: true }).catch(() => undefined);
  });
});
