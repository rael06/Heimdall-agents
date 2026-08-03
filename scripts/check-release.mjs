import { readFileSync, readdirSync } from 'node:fs';

/**
 * The three places a version is written, checked against each other.
 *
 * `package.json` is what `app.getVersion()` reports and therefore what the
 * update check compares against; the tag is what GitHub publishes under; the
 * changelog is what a reader is sent to. A tag that disagrees with the packaged
 * version makes the application either offer an update it already has or stay
 * silent about one it does not, and both read as a broken updater rather than
 * as a mistyped tag.
 *
 * Run with no argument it checks the repository alone. Given a tag it checks
 * that too, which is what the release workflow does. With --artifacts it also
 * insists the installer and its manifest are both on disk: the update path
 * verifies a checksum only when `latest.yml` was published, so a release
 * without one silently degrades to a length check.
 */

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8');

const tag = process.argv.find((argument) => argument.startsWith('v'));
const wantArtifacts = process.argv.includes('--artifacts');
const problems = [];

if (tag && tag !== `v${version}`) {
  problems.push(`The tag is ${tag} but package.json says ${version}.`);
}

// `## 1.0.1` or `## 1.0.0 — Heimdall agents`: the version, then the end of the
// line or a space.
const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}( |$)`, 'm');
if (!heading.test(changelog)) {
  problems.push(`CHANGELOG.md has no "## ${version}" heading.`);
}

if (wantArtifacts) {
  const built = readdirSync('dist');
  const installer = built.filter((name) => /setup.*\.exe$/i.test(name));
  if (installer.length !== 1) {
    problems.push(
      `Expected exactly one installer in dist/, found ${installer.length}: ${installer.join(', ') || 'none'}.`,
    );
  }
  if (!built.includes('latest.yml')) {
    problems.push(
      'dist/latest.yml is missing. It carries the sha512 the update path checks ' +
        'before running an installer, and without it that check is skipped.',
    );
  }
  if (installer.length === 1 && built.includes('latest.yml')) {
    // Not merely present: the manifest has to cover the file being shipped. The
    // two are named differently often enough that this went wrong once already.
    const manifest = readFileSync('dist/latest.yml', 'utf8');
    const plain = (value) => value.toLowerCase().replace(/[\s._-]+/g, '-');
    const covered = [...manifest.matchAll(/^\s*-?\s*url:\s*(.+?)\s*$/gm)].some(
      ([, url]) => plain(decodeURIComponent(url)) === plain(installer[0]),
    );
    if (!covered) {
      problems.push(`dist/latest.yml does not carry an entry for ${installer[0]}.`);
    }
  }
}

for (const problem of problems) {
  process.stderr.write(`  ${problem}\n`);
}
if (problems.length) {
  process.stderr.write(`\n${problems.length} problem(s); not a release to publish.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${version}${tag ? ` (${tag})` : ''} agrees with the changelog` +
      `${wantArtifacts ? ' and its artifacts are complete' : ''}.\n`,
  );
}
