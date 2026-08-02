import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * A service on the loopback interface is reachable from every page the browser
 * has open. Binding to 127.0.0.1 keeps it off the network, but not away from a
 * hostile tab, so a token minted at every start is required on every request.
 *
 * It is written beside the other shared files, readable by this user alone. A
 * third-party site can neither read that file nor guess the value.
 */

export interface ServiceFile {
  host: string;
  port: number;
  token: string;
  /**
   * Informative only. Whether a service is still there is settled by talking to
   * it, not by trusting this: a process identifier gets reused, and on Windows
   * a hard kill leaves this file behind with nothing listening.
   */
  pid: number;
  startedAt: string;
}

const FILE_NAME = 'service.json';

export function mintToken(): string {
  return randomBytes(32).toString('hex');
}

export function serviceFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

/** The URL to hand to a browser: the page needs the token to talk to the API. */
export function serviceUrl(file: Pick<ServiceFile, 'host' | 'port' | 'token'>): string {
  return `http://${file.host}:${file.port}/?token=${file.token}`;
}

export function parseServiceFile(value: unknown): ServiceFile | undefined {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const { host, port, token, pid, startedAt } = raw;
  if (typeof host !== 'string' || !host) {
    return undefined;
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return undefined;
  }
  if (typeof token !== 'string' || !token) {
    return undefined;
  }
  return {
    host,
    port,
    token,
    pid: typeof pid === 'number' ? pid : 0,
    startedAt: typeof startedAt === 'string' ? startedAt : '',
  };
}

export async function readServiceFile(directory: string): Promise<ServiceFile | undefined> {
  try {
    return parseServiceFile(JSON.parse(await fs.readFile(serviceFilePath(directory), 'utf8')));
  } catch {
    // No service has run yet, or the file is unreadable: either way there is
    // nothing to talk to, and starting fresh is the right answer.
    return undefined;
  }
}

export async function writeServiceFile(directory: string, file: ServiceFile): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  // 0600 on the file itself; the token is the whole protection, so it must not
  // be readable by another account on a shared machine.
  await fs.writeFile(serviceFilePath(directory), `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** Removed on the way out, but only when the file still describes this process. */
export async function clearServiceFile(directory: string, token: string): Promise<void> {
  const known = await readServiceFile(directory);
  if (!known || known.token !== token) {
    return;
  }
  try {
    await fs.unlink(serviceFilePath(directory));
  } catch {
    // Already gone, which is the state we wanted.
  }
}

/**
 * Constant-time comparison. A token checked with `===` leaks its prefix through
 * how long the comparison takes, and this one is checked on every request.
 */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given) {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
