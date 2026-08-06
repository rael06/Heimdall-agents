/**
 * The application's own URI scheme.
 *
 * This is what an installed application buys that a browser tab could not: a
 * notification button can hand a URI straight back to us, so a click on a toast
 * opens the session directly instead of going out through a browser page and
 * asking the service from there.
 */

export const PROTOCOL = 'heimdall-agents';

export type AppRequest =
  /** Open a session, through the usual two-step handover. */
  | { kind: 'open'; id: string }
  /**
   * Mark a session as seen, and show nothing.
   *
   * The one request that deliberately brings no window up. A toast saying a
   * session has stopped is answered either by going to look or by deciding not
   * to, and the second answer is worth as much as the first — but only if it
   * costs nothing, which it stops doing the moment it opens a window to be
   * closed again.
   */
  | { kind: 'ack'; id: string }
  /**
   * Bring the list up.
   *
   * No toast carries this any more — it was the third button and gave way to
   * marking a session seen. The route stays because notifications already
   * raised do not change: one sitting in the Action Center from before the
   * update still has the button, and a URI this refused would do nothing at all
   * when it was pressed.
   */
  | { kind: 'show' };

/**
 * Parses one of our URIs, and nothing else. Windows hands the whole command
 * line to the running instance, so this is fed arbitrary arguments and has to
 * reject everything it does not recognise rather than guess.
 */
export function parseRequest(value: string): AppRequest | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${PROTOCOL}:`) {
    return undefined;
  }
  // `heimdall-agents://show` puts "show" in the host, not the path.
  const route = url.hostname || url.pathname.replace(/^\/+/, '');
  if (route === 'show') {
    return { kind: 'show' };
  }
  if (route === 'open' || route === 'ack') {
    const id = url.searchParams.get('id');
    return id ? { kind: route, id } : undefined;
  }
  return undefined;
}

/** The first of our URIs in a command line, if there is one. */
export function requestFromArgv(argv: readonly string[]): AppRequest | undefined {
  for (const argument of argv) {
    const request = parseRequest(argument);
    if (request) {
      return request;
    }
  }
  return undefined;
}

export function openUri(id: string): string {
  return `${PROTOCOL}://open?id=${encodeURIComponent(id)}`;
}

export function ackUri(id: string): string {
  return `${PROTOCOL}://ack?id=${encodeURIComponent(id)}`;
}

export function showUri(): string {
  return `${PROTOCOL}://show`;
}
