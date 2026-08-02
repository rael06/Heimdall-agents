import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderId, STATUS_ORDER, SessionStatus } from '../model/types';
import {
  DEFAULT_NOTIFY_ON,
  DEFAULT_NOTIFY_SCOPE,
  NOTIFY_SCOPES,
  NotifyScope,
} from '../service/notifications';
import { ParsedArgs, flag, manyOf, number, oneOf, value } from './args';

/**
 * What the extension read from the VS Code settings, read from the command line
 * instead. Defaults are deliberately identical, so the same machine produces the
 * same list from either side while both run side by side.
 */
export interface Settings {
  providers: ProviderId[];
  /** Where the marks and the resolved titles live. */
  sharedDir: string;
  claudeHome: string;
  codexHome: string;
  includeSubagentSessions: boolean;
  staleAfterMs: number;
  /** 0 means unlimited. */
  historyMs: number;
  maxSessions: number;
  /** Mark a session as watched when it starts working. */
  autoWatch: boolean;
  /** Time a window is given to come up before it is asked to reveal a session. */
  handoffDelayMs: number;
  notificationsEnabled: boolean;
  /** Statuses a session must enter for a notification to go out. */
  notifyOn: SessionStatus[];
  /** Which sessions may raise one at all. */
  notifyScope: NotifyScope;
  /** Quiet period a stopped session must hold before it is reported. */
  notifyDelayMs: number;
  /** Interval between two scans in `asm watch`. */
  refreshIntervalMs: number;
}

export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex'];

/**
 * Where the marks, the resolved titles and the settings live.
 *
 * The old name is still honoured when it is the one holding data: an
 * installation that predates the renaming keeps its marks rather than waking up
 * to an empty list. Nothing is copied and nothing is moved — the directory that
 * exists is simply the one used, which cannot lose anything if it goes wrong.
 */
export function sharedDirectory(): string {
  const current = path.join(os.homedir(), '.heimdall-agents');
  const previous = path.join(os.homedir(), '.agent-sessions-manager');
  return !existsSync(current) && existsSync(previous) ? previous : current;
}

function resolvePath(configured: string): string {
  return configured.startsWith('~')
    ? path.join(os.homedir(), configured.slice(1))
    : path.resolve(configured);
}

function home(args: ParsedArgs, option: string, fallbackDir: string): string {
  const configured = value(args, option)?.trim();
  return configured ? resolvePath(configured) : path.join(os.homedir(), fallbackDir);
}

/** Options every command accepts, so `unknownOptions` can be told about them. */
export const SETTINGS_OPTIONS = [
  'provider',
  'shared-dir',
  'claude-home',
  'codex-home',
  'include-subagents',
  'stale-after',
  'history-days',
  'max',
  'auto-watch',
  'handoff-delay',
  'notify',
  'notify-on',
  'notify-scope',
  'notify-delay',
  'interval',
];

export function settingsFrom(args: ParsedArgs): Settings {
  const providers = manyOf(args, 'provider', PROVIDER_IDS);
  const historyDays = number(args, 'history-days', 30);
  const configuredShared = value(args, 'shared-dir')?.trim();
  const notifyOn = manyOf(args, 'notify-on', STATUS_ORDER);
  const shared = configuredShared ? resolvePath(configuredShared) : sharedDirectory();
  return {
    providers: providers.length ? providers : PROVIDER_IDS,
    sharedDir: shared,
    claudeHome: home(args, 'claude-home', '.claude'),
    codexHome: home(args, 'codex-home', '.codex'),
    includeSubagentSessions: flag(args, 'include-subagents'),
    staleAfterMs: number(args, 'stale-after', 30) * 60 * 1000,
    historyMs: historyDays > 0 ? historyDays * 24 * 60 * 60 * 1000 : 0,
    maxSessions: number(args, 'max', 300),
    autoWatch: flag(args, 'auto-watch', true),
    handoffDelayMs: number(args, 'handoff-delay', 2) * 1000,
    notificationsEnabled: flag(args, 'notify', true),
    notifyOn: notifyOn.length ? notifyOn : DEFAULT_NOTIFY_ON,
    notifyScope: oneOf(args, 'notify-scope', NOTIFY_SCOPES, DEFAULT_NOTIFY_SCOPE),
    notifyDelayMs: number(args, 'notify-delay', 5) * 1000,
    refreshIntervalMs: Math.max(1, number(args, 'interval', 5)) * 1000,
  };
}
