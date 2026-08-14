import * as path from 'node:path';
import { waitingReader } from '../core/attention';
import { SessionStore } from '../core/store';
import { ClaudeSessionProvider } from '../providers/claude';
import { CodexSessionProvider } from '../providers/codex';
import { ScanOptions, SessionProvider } from '../providers/provider';
import { Settings } from './settings';

function buildProviders(settings: Settings): SessionProvider[] {
  const providers: SessionProvider[] = [];
  if (settings.providers.includes('claude')) {
    providers.push(
      new ClaudeSessionProvider(
        settings.claudeHome,
        // The same file the extension writes, so the one costly pass over the
        // history to find renames is shared rather than paid twice.
        path.join(settings.sharedDir, 'claude-titles.json'),
      ),
    );
  }
  if (settings.providers.includes('codex')) {
    providers.push(new CodexSessionProvider(settings.codexHome, settings.includeSubagentSessions));
  }
  return providers;
}

/**
 * A store wired to the providers, over which every command runs. `now` is read
 * on each scan rather than fixed here, since `asm watch` ages sessions between
 * two passes without a byte being written.
 */
export function buildStore(settings: Settings): SessionStore {
  const providers = buildProviders(settings);
  // Built once: it closes over the directory, and every call is one small read
  // of one file, for the handful of sessions whose turn is still open.
  const waitingSince = waitingReader(settings.sharedDir);
  const options = (): ScanOptions => ({
    now: Date.now(),
    staleAfterMs: settings.staleAfterMs,
    historyMs: settings.historyMs,
    maxSessions: settings.maxSessions,
    waitingSince,
  });
  return new SessionStore(() => providers, options);
}
