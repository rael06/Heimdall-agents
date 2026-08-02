/**
 * The URIs that hand a session over to VS Code. Kept dependency free so the
 * exact strings can be unit tested, because they are the whole feature.
 *
 * All three are registered at OS level under the `vscode:` protocol, so any
 * process can trigger them — which is why this needs no extension of its own.
 * Two of them are **internal routes of other people's extensions**, found by
 * reading their bundled code rather than any documentation, and a release of
 * either can change them without warning. Every handover therefore has the raw
 * transcript behind it: a click must always lead somewhere.
 */

/**
 * The only route that reuses a window already showing the folder, rather than
 * replacing it or forcing a new one.
 */
export function folderUri(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  // A file URI path is always rooted, including on Windows: /c:/Users/dev.
  const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `vscode://file${encodeURI(rooted)}`;
}

/** Opens a file, and focuses the window already showing its folder. */
export const fileUri = folderUri;

/** Extension that owns the Claude Code panel, and therefore its URI namespace. */
export const CLAUDE_EXTENSION_ID = 'Anthropic.claude-code';

/**
 * Read from the bundled `extension.js` of v2.1.220:
 *
 * ```js
 * case "/open": {
 *   let session = x.get("session"), prompt = x.get("prompt");
 *   Pe.commands.executeCommand("claude-vscode.primaryEditor.open", session, prompt);
 * }
 * ```
 *
 * A `prompt` parameter is accepted too, which opens the door to sending a
 * message later. This observes, so it does not use it.
 */
export function claudeSessionUri(sessionId: string): string {
  return `vscode://${CLAUDE_EXTENSION_ID}/open?session=${encodeURIComponent(sessionId)}`;
}

/** Extension that owns the Codex panel, and therefore its URI namespace. */
export const CODEX_EXTENSION_ID = 'openai.chatgpt';

/**
 * The Codex extension routes any URI path to its webview; `/local/<threadId>` is
 * the route it uses itself for a local conversation.
 */
export function codexThreadUri(threadId: string): string {
  return `vscode://${CODEX_EXTENSION_ID}/local/${encodeURIComponent(threadId)}`;
}

/**
 * VS Code routes a URI to the **focused** window, so a session cannot be opened
 * in one step: the window holding its folder has to be brought up first, and
 * only then asked to reveal the session.
 */
export function sessionUri(provider: string, nativeId: string): string | undefined {
  if (provider === 'claude') {
    return claudeSessionUri(nativeId);
  }
  if (provider === 'codex') {
    return codexThreadUri(nativeId);
  }
  return undefined;
}
