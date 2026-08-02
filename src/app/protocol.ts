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
  /** Bring the list up. */
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
  if (route === 'open') {
    const id = url.searchParams.get('id');
    return id ? { kind: 'open', id } : undefined;
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

export function showUri(): string {
  return `${PROTOCOL}://show`;
}
