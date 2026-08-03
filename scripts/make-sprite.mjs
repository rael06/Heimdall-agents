import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/**
 * Builds the one SVG sprite the interface uses, out of the icons actually
 * referenced — not the nine thousand the package ships.
 *
 * Why a sprite rather than a font or a file per icon: the page is served as a
 * single document behind a token, because a browser does not carry a query
 * string over to a relative asset. Anything fetched separately would need a
 * route exempt from the token, which is the one rule that holds everywhere. A
 * sprite inlines into that document like the stylesheet already does.
 *
 * Why `fill` rather than one of Phosphor's lighter weights: these are drawn at
 * the size of a line of 13px text, where a 1.5px stroke turns to mush. Filled
 * shapes are what survive at that size, which is also why the status markers are
 * solid geometric characters rather than outlines.
 *
 * The SVGs already carry `fill="currentColor"`, so the theme and the marker
 * states colour them exactly as the text glyphs beside them.
 */

const require = createRequire(import.meta.url);

/**
 * Only what `app.js` asks for. Adding an icon here is adding it to the page.
 *
 * Each is resolved through the package's own export map — `./assets/<weight>/*`
 * — rather than by joining a path into `node_modules`. The package deliberately
 * does not export its `package.json`, so there is nothing to resolve a root
 * from, and a hand-built path would be one hoisting decision away from breaking.
 */
const WANTED = [
  { id: 'star', from: '@phosphor-icons/core/assets/regular/star.svg' },
  { id: 'star-fill', from: '@phosphor-icons/core/assets/fill/star-fill.svg' },
];

/**
 * The `<symbol>` keeps the source viewBox, so each icon scales from whatever
 * grid it was drawn on rather than being forced onto a shared one.
 */
async function symbolFor({ id, from }) {
  const raw = await readFile(require.resolve(from), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1];
  if (!viewBox) {
    throw new Error(`${from} has no viewBox; refusing to guess one.`);
  }
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  if (!body) {
    throw new Error(`${from} appears to be empty.`);
  }
  return `<symbol id="icon-${id}" viewBox="${viewBox}" fill="currentColor">${body}</symbol>`;
}

const symbols = await Promise.all(WANTED.map(symbolFor));
// `aria-hidden` and no size: this block exists to be referenced, never seen.
const sprite =
  `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">` +
  `${symbols.join('')}</svg>\n`;

/*
 * Into `src/web`, not `dist/web`, and generated rather than committed.
 *
 * `src/web` is the interface: `AssetReader` resolves it relative to itself, so
 * the unit tests read it straight from the source tree. Writing the sprite only
 * into `dist` left that directory incomplete and the page failed to assemble
 * under test — a 400 where a document should have been. Generated here,
 * `copy-assets` carries it onward like every other file beside it.
 *
 * Gitignored for the same reason as `build/icon.png`: it is derived from a
 * dependency, and a committed copy is one that can silently disagree with it.
 *
 * Which is why `package.json` runs this as `prepare`, not only inside `build`.
 * npm runs `prepare` after every install, `npm ci` included, so the file exists
 * before anything reads it. Without that, the unit tests — which read `src/web`
 * directly — fail on a fresh clone: CI put `Unit tests` before `Build` and the
 * page came back as a 400 where a document should have been. A source directory
 * that is only complete after a build is a trap, and the install is the last
 * moment it can be closed for everyone at once.
 */
const target = path.join('src', 'web', 'icons.svg');
await writeFile(target, sprite, 'utf8');
process.stdout.write(`${target} written, ${WANTED.length} icons, ${sprite.length} bytes\n`);
