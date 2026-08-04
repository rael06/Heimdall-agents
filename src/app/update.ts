import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { get as httpsGet } from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { IncomingMessage } from 'node:http';
import {
  Release,
  isInstallable,
  isNewer,
  isTrustedHost,
  parseRelease,
  releaseUrl,
  sha512For,
} from './release';

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
 * Whether a check nobody asked for has something worth interrupting about.
 *
 * The menu answers every outcome, because somebody asked a question and is owed
 * an answer — including "you are up to date" and "GitHub could not be reached".
 * A check at launch asked nothing, so it earns a word only when there is
 * something to act on, and stays silent otherwise. Being offline at startup is
 * not news.
 *
 * That covers the three ways a newer version can still be nothing to do about:
 * no installer, no checksum manifest to verify it against, and a version
 * already turned down. Each of those has a dialog behind the menu item, where
 * it belongs.
 */
export function worthAnnouncing(found: UpdateCheck, skippedVersion: string): boolean {
  return (
    found.kind === 'update' &&
    found.release !== undefined &&
    isInstallable(found.release) &&
    found.release.version !== skippedVersion
  );
}

/**
 * What the offer says, and what an answer to it means.
 *
 * Here rather than beside the dialog, for the reason this file's own header
 * gives: the decisions belong somewhere pure and tested, and what is left in
 * the window is the part that cannot be. Reading an answer out of a button
 * index is exactly a decision — an off-by-one in it installs an update on
 * somebody who declined, quietly and once, which is not a thing to find out
 * from a user.
 *
 * The launch offer carries a third button and the menu's does not. Asked from
 * the menu, "not now" means not now: nothing will raise it again unless the
 * reader does. Raised unprompted, the same answer would come back at the next
 * launch and every one after it, so that route needs a way to say never — and
 * as its own button rather than as a meaning read into "not now".
 */
export const UPDATE_BUTTONS = {
  asked: ['Not now', 'Download and install'],
  offered: ['Skip this version', 'Not now', 'Download and install'],
} as const;

export type UpdateAnswer = 'install' | 'skip' | 'later';

export function updateButtons(skippable: boolean): readonly string[] {
  return skippable ? UPDATE_BUTTONS.offered : UPDATE_BUTTONS.asked;
}

export function updateAnswer(skippable: boolean, response: number): UpdateAnswer {
  const buttons = updateButtons(skippable);
  // Installing is the last button in both, so it is found by length rather than
  // by a number written twice. Anything that is not one of the two named
  // answers is "later", which is what a dialog dismissed by Escape has to mean.
  if (response === buttons.length - 1) return 'install';
  return skippable && response === 0 ? 'skip' : 'later';
}

/**
 * Downloads the installer and checks it is what the release said it was.
 *
 * Nothing is run that has not matched its published length, and its checksum
 * when the release carries one. Without a code-signing certificate that is the
 * whole of what can be verified, and it is stated rather than implied.
 */
export async function downloadInstaller(
  release: Release,
  /**
   * Called as bytes arrive, with a fraction when the release declared a length
   * and `undefined` when it did not. A 200 MB download behind a modal that does
   * not move reads as a hang rather than as work.
   */
  onProgress?: (fraction: number | undefined, received: number) => void,
): Promise<string> {
  const installer = release.installer;
  if (!installer) {
    throw new Error('That release carries no Windows installer.');
  }

  if (!release.manifest) {
    // No longer treated as "then skip the checksum". Without a certificate the
    // published sha512 is the whole of what can be verified, so a release
    // without one cannot be installed from — and saying so beats running an
    // installer whose only credential is that it arrived over TLS.
    throw new Error('That release publishes no checksum manifest, so nothing about it can be verified.');
  }
  const expected = sha512For(await body(await request(release.manifest.url, {})), installer.name);
  if (!expected) {
    // A release that publishes a manifest and yet says nothing about this file
    // is not a release to install from. Carrying on unverified would be the
    // worst of both: the check advertised, and quietly not performed.
    throw new Error('The release publishes a checksum manifest that does not cover this file.');
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heimdall-agents-update-'));
  const target = path.join(directory, installer.name);
  const response = await request(installer.url, {});

  // Written as it arrives rather than assembled in memory first. The installer
  // is around 200 MB, and holding all of it to hand the same bytes to a file a
  // moment later is a cost paid for nothing — on a machine short of memory it
  // is a cost paid at exactly the moment somebody asked for an upgrade.
  //
  // It reaches disk before it is trusted, which is safe because nothing runs it
  // until both checks below pass, and the file is thrown away if they do not.
  const digest = createHash('sha512');
  let received = 0;
  const file = createWriteStream(target);
  try {
    await pipeline(
      response,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          received += chunk.length;
          digest.update(chunk);
          onProgress?.(installer.size ? received / installer.size : undefined, received);
          yield chunk;
        }
      },
      file,
    );

    if (installer.size && received !== installer.size) {
      throw new Error(`Downloaded ${received} bytes where the release declared ${installer.size}.`);
    }
    if (digest.digest('base64') !== expected) {
      throw new Error('The download does not match the checksum published with the release.');
    }
  } catch (error) {
    // Nothing half-verified is left lying in the temporary directory for
    // something else to find and run.
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return target;
}

/**
 * What the installer is asked to do.
 *
 * `/S` is a silent install, which is deliberate: nobody clicking "Download and
 * install" wants to answer the same questions again. `--force-run` is what
 * brings the window back, and leaving it out is why the screen stayed empty.
 *
 * Both are required, and neither works alone. From the NSIS template that
 * builds this installer, on the assisted branch this project takes by setting
 * `oneClick: false`:
 *
 * ```nsis
 * # for assisted installer run only if silent, because assisted installer has
 * # run after finish option
 * ${if} ${isForceRun}
 * ${andIf} ${Silent}
 *   !insertmacro doStartApp
 * ${endIf}
 * ```
 *
 * @see app-builder-lib/templates/nsis/installSection.nsh
 */
export const INSTALLER_ARGUMENTS: readonly string[] = ['/S', '--force-run'];

/** Injected so what gets launched can be asked about without launching it. */
export type LaunchInstaller = (installerPath: string, args: readonly string[]) => void;

const spawnDetached: LaunchInstaller = (installerPath, args) => {
  spawn(installerPath, [...args], { detached: true, stdio: 'ignore' }).unref();
};

/**
 * Hands the installer to Windows and gets out of the way.
 *
 * Detached and then quitting, in that order: an installer cannot replace files
 * this process still holds open, and waiting for something that outlives us
 * would only keep them held. A launch that fails never reaches the quit, so the
 * window stays up to carry the failure rather than vanishing on a user who is
 * about to be told nothing was installed.
 */
export function runInstaller(
  installerPath: string,
  quit: () => void,
  launch: LaunchInstaller = spawnDetached,
): void {
  launch(installerPath, INSTALLER_ARGUMENTS);
  quit();
}
