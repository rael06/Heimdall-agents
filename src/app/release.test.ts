import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isInstallable,
  isNewer,
  isTrustedHost,
  parseRelease,
  sha512For,
} from './release';

const payload = {
  tag_name: 'v0.27.0',
  assets: [
    {
      name: 'Heimdall agents Setup 1.0.0.exe',
      browser_download_url: 'https://github.com/o/r/releases/download/v0.27.0/setup.exe',
      size: 91_000_000,
    },
    {
      name: 'latest.yml',
      browser_download_url: 'https://github.com/o/r/releases/download/v0.27.0/latest.yml',
      size: 340,
    },
  ],
};

describe('parseRelease', () => {
  it('reads the version without the tag prefix, and finds the installer', () => {
    const release = parseRelease(payload);
    expect(release?.version).toBe('0.27.0');
    expect(release?.installer?.name).toBe('Heimdall agents Setup 1.0.0.exe');
    expect(release?.installer?.size).toBe(91_000_000);
    expect(release?.manifest?.name).toBe('latest.yml');
  });

  it('parses a release that has no installer yet rather than failing', () => {
    // A tag can exist before its asset is uploaded. That is not an error to
    // shout about; it is simply nothing to offer.
    const release = parseRelease({ tag_name: '0.27.0', assets: [] });
    expect(release?.version).toBe('0.27.0');
    expect(release?.installer).toBeUndefined();
  });

  it('refuses anything without a tag, including what a 404 returns', () => {
    expect(parseRelease({ message: 'Not Found' })).toBeUndefined();
    expect(parseRelease({ tag_name: '  ' })).toBeUndefined();
    expect(parseRelease(undefined)).toBeUndefined();
    expect(parseRelease('0.27.0')).toBeUndefined();
  });

  it('picks the installer rather than whichever executable came first', () => {
    // Measured against a real release that ships several: taking the first
    // `.exe` chose the arm64 build.
    const release = parseRelease({
      tag_name: '1.0.0',
      assets: [
        { name: 'app.arm64.exe', browser_download_url: 'https://github.com/a.exe', size: 1 },
        { name: 'App Setup 1.0.0.exe', browser_download_url: 'https://github.com/b.exe', size: 2 },
      ],
    });
    expect(release?.installer?.name).toBe('App Setup 1.0.0.exe');
  });

  it('ignores an asset missing the fields it is needed for', () => {
    const release = parseRelease({ tag_name: '1.0.0', assets: [{ name: 'x.exe' }, null] });
    expect(release?.installer).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('compares by number, not as text', () => {
    // The whole reason this is not a string comparison.
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('0.26.0', '0.9.0')).toBe(1);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('puts a pre-release below the release it leads to', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
  });

  it('ignores a leading v on either side', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });
});

describe('isNewer', () => {
  it('offers an upgrade only when there is one', () => {
    expect(isNewer('0.26.0', '0.27.0')).toBe(true);
    expect(isNewer('0.26.0', '0.26.0')).toBe(false);
    // A downgrade is never offered, whatever the release says.
    expect(isNewer('0.26.0', '0.25.0')).toBe(false);
  });
});

describe('sha512For', () => {
  const manifest = [
    'version: 0.27.0',
    'files:',
    '  - url: Heimdall%20agents%20Setup%201.0.0.exe',
    '    sha512: AAAA==',
    '    size: 91000000',
    '  - url: other.exe',
    '    size: 12',
    'path: Heimdall agents Setup 1.0.0.exe',
    'releaseDate: 2026-08-02T00:00:00.000Z',
  ].join('\n');

  it('finds the checksum of the file it was asked about', () => {
    expect(sha512For(manifest, 'Heimdall agents Setup 1.0.0.exe')).toBe('AAAA==');
  });

  it('recognises the same file under each spelling it is given', () => {
    // Measured on the real 1.0.0 release: electron-builder writes hyphens into
    // the manifest, GitHub serves the asset with dots, and the file on disk has
    // spaces. Comparing literally found nothing and skipped the checksum.
    for (const name of [
      'Heimdall-agents-Setup-1.0.0.exe',
      'Heimdall.agents.Setup.1.0.0.exe',
      'heimdall agents setup 1.0.0.exe',
    ]) {
      expect(sha512For(manifest, name)).toBe('AAAA==');
    }
  });

  it('still refuses a file that is genuinely another one', () => {
    expect(sha512For(manifest, 'Heimdall-agents-Setup-1.0.1.exe')).toBeUndefined();
  });

  it('never lends one entry checksum to another', () => {
    // `other.exe` has none of its own, and must not inherit the one above it.
    expect(sha512For(manifest, 'other.exe')).toBeUndefined();
  });

  it('says nothing about a file it does not mention', () => {
    expect(sha512For(manifest, 'absent.exe')).toBeUndefined();
    expect(sha512For('', 'anything.exe')).toBeUndefined();
  });
});

describe('isTrustedHost', () => {
  it('accepts where GitHub actually serves releases from', () => {
    expect(isTrustedHost('https://api.github.com/repos/o/r/releases/latest')).toBe(true);
    expect(isTrustedHost('https://github.com/o/r/releases/download/v1/setup.exe')).toBe(true);
    // The asset itself comes from another host, after a redirect.
    expect(isTrustedHost('https://objects.githubusercontent.com/x')).toBe(true);
  });

  it('refuses anywhere else, and anything not over TLS', () => {
    expect(isTrustedHost('http://github.com/o/r')).toBe(false);
    expect(isTrustedHost('https://github.com.example.net/o/r')).toBe(false);
    expect(isTrustedHost('https://evil.test/setup.exe')).toBe(false);
    expect(isTrustedHost('not a url')).toBe(false);
  });
});

describe('isInstallable', () => {
  const asset = (name: string) => ({ name, url: `https://github.com/${name}`, size: 1 });

  it('wants the installer and the manifest that vouches for it', () => {
    expect(
      isInstallable({ version: '1.0.2', installer: asset('setup.exe'), manifest: asset('latest.yml') }),
    ).toBe(true);
  });

  it('refuses a release with no manifest rather than skipping the checksum', () => {
    // This is the case that used to install anyway, verifying nothing but the
    // declared byte length. Without a certificate the published sha512 is the
    // whole of what can be checked, so its absence is a refusal.
    expect(isInstallable({ version: '1.0.2', installer: asset('setup.exe') })).toBe(false);
  });

  it('refuses a release with nothing to install', () => {
    expect(isInstallable({ version: '1.0.2', manifest: asset('latest.yml') })).toBe(false);
    expect(isInstallable({ version: '1.0.2' })).toBe(false);
  });
});
