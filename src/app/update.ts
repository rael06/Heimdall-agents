import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { get as httpsGet } from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { IncomingMessage } from 'node:http';
import { Release, isNewer, isTrustedHost, parseRelease, releaseUrl, sha512For } from './release';

/**
 * Fetching a release and replacing the application with it.
 *
 * The thin, unavoidable half: three built-in modules and no client library. All
 * the decisions live in `release.ts`, which is pure and tested; what is left
 * here is the network and the process launch, which cannot be either.
 */

const OWNER = 'rael06';
const REPO = 'Heimdall-agents';
/** GitHub rejects an API request that does not say who is asking. */
const AGENT = 'heimdall-agents';
const MAX_REDIRECTS = 5;

export interface UpdateCheck {
  kind: 'update' | 'current' | 'none' | 'error';
  release?: Release;
  message?: string;
}

function request(url: string, headers: Record<string, string>, redirects = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!isTrustedHost(url)) {
      reject(new Error(`Refusing to follow ${url}: not a GitHub address over TLS.`));
      return;
    }
    httpsGet(url, { headers: { 'user-agent': AGENT, ...headers } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects.'));
          return;
        }
        // Every hop is checked, not just the first: a redirect is where a
        // download would be taken somewhere else.
        resolve(request(new URL(location, url).toString(), headers, redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GitHub answered ${status}.`));
        return;
      }
      resolve(response);
    }).on('error', reject);
  });
}

async function body(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * What the latest release is, compared with what is running.
 *
 * A private repository answers 404 to an unauthenticated request, which is
 * indistinguishable from having no release at all — so both are reported as
 * *nothing published*, in those words, rather than as a failure the reader
 * cannot act on.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheck> {
  try {
    const response = await request(releaseUrl(OWNER, REPO), {
      accept: 'application/vnd.github+json',
    });
    const release = parseRelease(JSON.parse(await body(response)));
    if (!release) {
      return { kind: 'none' };
    }
    return isNewer(currentVersion, release.version)
      ? { kind: 'update', release }
      : { kind: 'current', release };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('404') ? { kind: 'none' } : { kind: 'error', message };
  }
}

/**
 * Downloads the installer and checks it is what the release said it was.
 *
 * Nothing is run that has not matched its published length, and its checksum
 * when the release carries one. Without a code-signing certificate that is the
 * whole of what can be verified, and it is stated rather than implied.
 */
export async function downloadInstaller(release: Release): Promise<string> {
  const installer = release.installer;
  if (!installer) {
    throw new Error('That release carries no Windows installer.');
  }

  let expected: string | undefined;
  if (release.manifest) {
    expected = sha512For(await body(await request(release.manifest.url, {})), installer.name);
    if (!expected) {
      // A release that publishes a manifest and yet says nothing about this file
      // is not a release to install from. Carrying on unverified would be the
      // worst of both: the check advertised, and quietly not performed.
      throw new Error('The release publishes a checksum manifest that does not cover this file.');
    }
  }

  const target = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'heimdall-agents-update-')),
    installer.name,
  );
  const response = await request(installer.url, {});
  const chunks: Buffer[] = [];
  const digest = createHash('sha512');
  let received = 0;
  for await (const chunk of response) {
    const buffer = chunk as Buffer;
    received += buffer.length;
    digest.update(buffer);
    chunks.push(buffer);
  }

  if (installer.size && received !== installer.size) {
    throw new Error(`Downloaded ${received} bytes where the release declared ${installer.size}.`);
  }
  const actual = digest.digest('base64');
  if (expected && actual !== expected) {
    throw new Error('The download does not match the checksum published with the release.');
  }

  await fs.writeFile(target, Buffer.concat(chunks));
  return target;
}

/**
 * Hands the installer to Windows and gets out of the way.
 *
 * Detached and then quitting, in that order: an installer cannot replace files
 * this process still holds open, and waiting for something that outlives us
 * would only keep them held.
 */
export function runInstaller(installerPath: string, quit: () => void): void {
  spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
  quit();
}
