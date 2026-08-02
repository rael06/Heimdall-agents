import { tokenMatches } from './token';

/**
 * A service on 127.0.0.1 is not private: every page the browser has open can
 * send it requests. Three checks, and none of them is optional.
 *
 * The `Host` check is the fourth, and it costs one line. A hostile site can
 * point its own domain at 127.0.0.1 and reach us with the browser believing it
 * is same-origin — which would send no cross-origin `Origin` header at all.
 * Requiring the host to be the loopback name we listen on closes that.
 */

export interface GuardOptions {
  token: string;
  port: number;
}

export type GuardResult = { allowed: true } | { allowed: false; status: number; reason: string };

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function allowedHosts(port: number): string[] {
  return LOOPBACK_HOSTS.map((host) => `${host}:${port}`);
}

function allowedOrigins(port: number): string[] {
  return LOOPBACK_HOSTS.map((host) => `http://${host}:${port}`);
}

export function tokenFromRequest(
  headers: Record<string, string | string[] | undefined>,
  url: string,
): string | undefined {
  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  // The browser cannot read the service file, so the page is opened with the
  // token in the URL and hands it back on every call.
  const query = url.indexOf('?');
  if (query < 0) {
    return undefined;
  }
  return new URLSearchParams(url.slice(query + 1)).get('token') ?? undefined;
}

export function guardRequest(
  headers: Record<string, string | string[] | undefined>,
  url: string,
  options: GuardOptions,
): GuardResult {
  const host = headers.host;
  if (typeof host !== 'string' || !allowedHosts(options.port).includes(host.toLowerCase())) {
    return { allowed: false, status: 403, reason: 'This service only answers on the loopback address.' };
  }

  const origin = headers.origin;
  // A request with no Origin is not a cross-site one: browsers always send it
  // across origins. It still has to carry the token, checked just below.
  if (typeof origin === 'string' && !allowedOrigins(options.port).includes(origin.toLowerCase())) {
    return { allowed: false, status: 403, reason: 'Origin not allowed.' };
  }

  if (!tokenMatches(options.token, tokenFromRequest(headers, url))) {
    return { allowed: false, status: 401, reason: 'Missing or invalid token.' };
  }

  return { allowed: true };
}
