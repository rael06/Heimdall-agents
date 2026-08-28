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
  // The two markers on every row, and the filters that narrow to them. Each is
  // one drawing at two weights, which is what an off/on marker means.
  { id: 'star', from: '@phosphor-icons/core/assets/regular/star.svg' },
  { id: 'star-fill', from: '@phosphor-icons/core/assets/fill/star-fill.svg' },
  { id: 'eye', from: '@phosphor-icons/core/assets/regular/eye.svg' },
  { id: 'eye-fill', from: '@phosphor-icons/core/assets/fill/eye-fill.svg' },
  // The notification switch, where off has to be unmistakable rather than merely
  // lighter: a bell that is not ringing looks like a bell that is.
  { id: 'bell', from: '@phosphor-icons/core/assets/regular/bell.svg' },
  { id: 'bell-slash', from: '@phosphor-icons/core/assets/regular/bell-slash.svg' },
  // The status column header. Three circles for distinct states, which echoes
  // the four shapes in the column below it.
  { id: 'circles-three', from: '@phosphor-icons/core/assets/regular/circles-three.svg' },
  /*
   * The four statuses. Circle, square, triangle and diamond — the same four
   * silhouettes the characters had, because they are the set nobody has to
   * compare against each other to tell apart, and that is what has to survive
   * when colour cannot be seen.
   *
   * They were `●✕▲◇` until this was rendered at three times size and looked at:
   * the dot is small, the cross is thin, the diamond is a hairline outline. Four
   * glyphs from different type families, because that is exactly what they were.
   * Drawn together they carry one weight.
   *
   * The all-circle semantic set — play, x, pause, question — was the prettiest of
   * the three and was rejected for it: four circular silhouettes distinguish by
   * their centres, and a centre is the first thing lost at this size.
   */
  { id: 'status-running', from: '@phosphor-icons/core/assets/fill/circle-fill.svg' },
  { id: 'status-unknown', from: '@phosphor-icons/core/assets/fill/diamond-fill.svg' },
  { id: 'status-failed', from: '@phosphor-icons/core/assets/fill/x-fill.svg' },
  { id: 'status-idle', from: '@phosphor-icons/core/assets/fill/triangle-fill.svg' },
  // Reset turns back, refresh turns forward.
  { id: 'reset', from: '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg' },
  { id: 'refresh', from: '@phosphor-icons/core/assets/regular/arrow-clockwise.svg' },
  // Changing the colour a workspace or a provider is drawn in. A brush says
  // "this paints" without needing a word, in a cell that has no room for one.
  { id: 'brush', from: '@phosphor-icons/core/assets/regular/paint-brush.svg' },
  // The switch that decides whether the list keeps itself in order. Two
  // drawings rather than one at two weights, because the two states are not the
  // same thing done harder: one is a list that is sorted, the other a list
  // holding rows that would move.
  { id: 'sort-ascending', from: '@phosphor-icons/core/assets/regular/sort-ascending.svg' },
  { id: 'reorder', from: '@phosphor-icons/core/assets/regular/arrows-down-up.svg' },
  // The switch for the fold holding the settings, the search and the filters.
  // One drawing at one weight: what changes between its two states is whether
  // the chip around it is lit, not the gear inside it.
  { id: 'gear', from: '@phosphor-icons/core/assets/regular/gear.svg' },
  // The fold on a group band. One drawing, rotated by the stylesheet for the
  // closed state: a caret that turns is read as the same control in two
  // positions, where two drawings read as two controls.
  { id: 'caret-down', from: '@phosphor-icons/core/assets/regular/caret-down.svg' },
  // What says a band can be picked up. Six dots is the shape a pointer already
  // knows to grab, and it needs no word in a row that carries a name.
  { id: 'grip', from: '@phosphor-icons/core/assets/regular/dots-six-vertical.svg' },
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
