import { fileUri, folderUri, sessionUri } from '../core/uris';
import { AgentSession } from '../model/types';
import { Desktop } from './desktop';

export type HandoverTarget = 'session' | 'workspace' | 'transcript';

export interface HandoverResult {
  /** URIs handed to the operating system, in order. */
  opened: string[];
  /** The transcript was opened because the session route could not be. */
  fellBack: boolean;
  error?: string;
}

/**
 * Opening a session takes two steps, and the reason is not ours: VS Code routes
 * a URI to the **focused** window. The window holding the workspace has to be
 * brought up first, and only then asked to reveal the session — with a delay in
 * between covering the time a window takes to come up.
 *
 * The route it then uses belongs to someone else's extension and is
 * unversioned, so the raw transcript sits behind it. What cannot be detected is
 * a URI the operating system accepts and a missing extension then ignores:
 * nothing comes back from a `vscode://` call. The fallback therefore covers a
 * failure to *launch*, and the interface keeps an explicit way to open the
 * transcript for the rest.
 */
export async function handover(
  desktop: Desktop,
  session: AgentSession,
  target: HandoverTarget,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<HandoverResult> {
  const opened: string[] = [];

  if (target === 'transcript') {
    await desktop.openExternal(fileUri(session.filePath));
    return { opened: [fileUri(session.filePath)], fellBack: false };
  }

  if (target === 'workspace') {
    if (!session.cwd) {
      // No folder was ever recorded, so the transcript is the only thing to
      // show — a click must always lead somewhere.
      await desktop.openExternal(fileUri(session.filePath));
      return { opened: [fileUri(session.filePath)], fellBack: true };
    }
    await desktop.openExternal(folderUri(session.cwd));
    return { opened: [folderUri(session.cwd)], fellBack: false };
  }

  const route = sessionUri(session.provider, session.nativeId);
  try {
    if (session.cwd) {
      const folder = folderUri(session.cwd);
      await desktop.openExternal(folder);
      opened.push(folder);
      await sleep(delayMs);
    }
    if (!route) {
      throw new Error(`No session route for provider ${session.provider}.`);
    }
    await desktop.openExternal(route);
    opened.push(route);
    return { opened, fellBack: false };
  } catch (error) {
    const transcript = fileUri(session.filePath);
    try {
      await desktop.openExternal(transcript);
      opened.push(transcript);
    } catch {
      // Even the transcript could not be opened: nothing is left to try, and
      // the caller is told rather than left believing something happened.
      return {
        opened,
        fellBack: false,
        error: String(error instanceof Error ? error.message : error),
      };
    }
    return {
      opened,
      fellBack: true,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}
