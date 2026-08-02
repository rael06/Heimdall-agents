/**
 * Reading a GitHub release, without a client library and without I/O.
 *
 * Everything here is a pure function over what the API returned, so the part
 * that decides whether to replace the application on someone's machine can be
 * tested without a network.
 *
 * Why this exists at all rather than a ready-made updater: Electron's own
 * `autoUpdater` documents Squirrel.Windows and MSIX on Windows and says nothing
 * about NSIS, which is what this application ships. `electron-updater` does
 * handle NSIS, and is a runtime dependency — of which this project has none, on
 * purpose. What is left is three built-in modules and the endpoint below.
 *
 * @see https://www.electronjs.org/docs/latest/api/auto-updater
 * @see https://docs.github.com/en/rest/releases/releases
 */

export interface ReleaseAsset {
  name: string;
  /** Direct download, as GitHub hands it out. */
  url: string;
  /** Declared length, checked against what actually arrives. */
  size: number;
}

export interface Release {
  /** Tag with any leading `v` removed, so it compares against `app.getVersion()`. */
  version: string;
  /** The Windows installer, absent when the release carries none. */
  installer?: ReleaseAsset;
  /** electron-builder's manifest, when the release was published with one. */
  manifest?: ReleaseAsset;
}

export function releaseUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asset(value: unknown): ReleaseAsset | undefined {
  const raw = asObject(value);
  const name = raw?.name;
  const url = raw?.browser_download_url;
  if (typeof name !== 'string' || typeof url !== 'string') {
    return undefined;
  }
  return { name, url, size: typeof raw?.size === 'number' ? raw.size : 0 };
}

/**
 * What the release offers, or nothing.
 *
 * A release with no `.exe` is not an error to shout about — a tag can exist
 * before its installer is uploaded — so it parses fine and simply has no
 * installer to offer.
 */
export function parseRelease(payload: unknown): Release | undefined {
  const raw = asObject(payload);
  const tag = raw?.tag_name;
  if (typeof tag !== 'string' || !tag.trim()) {
    return undefined;
  }
  const assets = Array.isArray(raw?.assets)
    ? raw.assets.map(asset).filter((item): item is ReleaseAsset => Boolean(item))
    : [];
  const executables = assets.filter((item) => item.name.toLowerCase().endsWith('.exe'));
  return {
    version: tag.trim().replace(/^v/i, ''),
    // A release can carry several: electron-builder names ours `… Setup ….exe`,
    // and taking merely the first would pick whichever architecture happened to
    // be uploaded first.
    installer:
      executables.find((item) => /\bsetup\b/i.test(item.name)) ?? executables[0],
    manifest: assets.find((item) => item.name.toLowerCase() === 'latest.yml'),
  };
}

/**
 * Compares two versions the way `1.10.0` deserves: by number, not by string.
 *
 * Anything after the numbers — `-beta.1` and the like — makes a version *older*
 * than the same numbers without it, which is what semantic versioning says and
 * what keeps a pre-release from being offered as an upgrade over the release.
 */
export function compareVersions(left: string, right: string): number {
  const split = (value: string): { numbers: number[]; pre: string } => {
    const [core, ...rest] = value.trim().replace(/^v/i, '').split('-');
    return {
      numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: rest.join('-'),
    };
  };
  const a = split(left);
  const b = split(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  if (a.pre === b.pre) {
    return 0;
  }
  if (!a.pre) {
    return 1;
  }
  if (!b.pre) {
    return -1;
  }
  return a.pre < b.pre ? -1 : 1;
}

export function isNewer(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/**
 * One file name as another spelling of itself.
 *
 * The same installer is called three different things: electron-builder writes
 * `Heimdall-agents-Setup-1.0.0.exe` into the manifest, GitHub serves it as
 * `Heimdall.agents.Setup.1.0.0.exe`, and on disk it has spaces. Comparing them
 * literally found nothing, which silently skipped the checksum — the one check
 * that stands between a download and running an installer.
 */
function sameFile(left: string, right: string): boolean {
  const plain = (value: string): string =>
    decodeURIComponent(value).toLowerCase().replace(/[\s._-]+/g, '-');
  return plain(left) === plain(right);
}

/**
 * The published checksum of one file, out of electron-builder's manifest.
 *
 * Read conservatively rather than parsed as YAML: this is the one thing
 * standing between a download and running an installer, so an entry that does
 * not clearly belong to the file being checked yields nothing at all, and the
 * caller is left to say so rather than to trust a near-match.
 */
export function sha512For(manifest: string, fileName: string): string | undefined {
  const lines = manifest.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const url = /^\s*-\s*url:\s*(.+?)\s*$/.exec(lines[index]);
    if (!url || !sameFile(url[1], fileName)) {
      continue;
    }
    // Only within this entry: the next one starts at the following `- url:`.
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^\s*-\s*url:/.test(lines[next])) {
        break;
      }
      const found = /^\s*sha512:\s*(\S+)\s*$/.exec(lines[next]);
      if (found) {
        return found[1];
      }
    }
    return undefined;
  }
  return undefined;
}

/** GitHub serves the asset itself from a different host, and only these two. */
export function isTrustedHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === 'https:' &&
      (hostname === 'github.com' ||
        hostname === 'api.github.com' ||
        hostname.endsWith('.githubusercontent.com'))
    );
  } catch {
    return false;
  }
}
