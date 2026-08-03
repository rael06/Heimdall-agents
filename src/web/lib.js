/*
 * The decisions the interface makes that owe nothing to a document.
 *
 * They lived in `app.js`, which is 1100 lines and reachable only through a
 * browser, so the only way to ask whether `readable` really clears 4.5:1 or
 * whether `comparator` breaks a tie the way it claims was to drive Chromium and
 * look. That is a slow and indirect way to pin down arithmetic.
 *
 * It is inlined into the same module script as `app.js` rather than served on a
 * route of its own: the page is opened with the token in its address, a browser
 * does not carry a query string over to a relative import, and exempting one
 * file from the token would undo the rule that holds for every route. The
 * `export` keywords below are what lets Vitest import this file directly; in the
 * page they are inert, because an inline module script has no importer.
 */

// ------------------------------------------------------------------- colour

export function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

export const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export const parseRgb = (value) =>
  (value.match(/\d+/g) ?? ['255', '255', '255']).slice(0, 3).map(Number);

/**
 * A readable version of the chosen colour.
 *
 * The frame only has to be seen, so it wears the colour as picked. The accent is
 * read as text — a link, a pressed chip — and a colour chosen at random is about
 * as likely to be illegible as not. So it is walked towards white or black,
 * whichever the background is not, until it clears 4.5:1.
 */
export function readable(hex, background) {
  const target = luminance(background) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let colour = toRgb(hex);
  // Judged on the colour that actually gets painted, not on the one being
  // walked. The channels are fractional while the loop runs and `toHex` rounds
  // them on the way out, and that rounding is enough to drop back under the
  // bar: a hue picked at random came out at 4.4967:1 while the float it was
  // rounded from had cleared 4.5. Measuring the float is measuring something
  // nobody sees.
  const painted = (value) => toRgb(toHex(value));
  for (let step = 0; step < 40 && contrast(painted(colour), background) < 4.5; step += 1) {
    colour = colour.map((value, index) => value + (target[index] - value) * 0.08);
  }
  return toHex(colour);
}

// --------------------------------------------------------------------- sort

export const SORT_KEYS = [
  'status',
  'watched',
  'starred',
  'created',
  'updated',
  'provider',
  'workspace',
  'title',
];

/** The direction a column takes on its first click, which is the useful one. */
export const FIRST_DIRECTION = {
  status: 'asc',
  // Marked first: nobody clicks the eye to be shown everything they are not
  // following.
  watched: 'desc',
  starred: 'desc',
  created: 'desc',
  updated: 'desc',
  provider: 'asc',
  workspace: 'asc',
  title: 'asc',
};

/** Accepts the names earlier versions wrote, so an old bookmark still sorts. */
export function normalizeSort(value) {
  if (!value) return 'created-desc';
  if (value === 'status' || value === 'title') return `${value}-asc`;
  const at = value.lastIndexOf('-');
  const key = value.slice(0, at);
  const direction = value.slice(at + 1);
  return SORT_KEYS.includes(key) && (direction === 'asc' || direction === 'desc')
    ? value
    : 'created-desc';
}

export function splitSort(sort) {
  const at = sort.lastIndexOf('-');
  return { key: sort.slice(0, at), ascending: sort.slice(at + 1) === 'asc' };
}

// ------------------------------------------------------------------- values

/** The day a timestamp falls on, as the date inputs write it. */
export function day(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last segment of a path, which is what names a workspace in the list. */
export const folder = (cwd) => (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '-');

/**
 * How many colours a workspace can be drawn in.
 *
 * Ten, and not "one of 360", which is what this returned first and what the
 * screen immediately argued with: the two workspaces in the fixtures came out
 * at 252° and 246°, six degrees apart, which is one blue shown twice. A near
 * miss reads as a bug. An exact repeat reads as a coincidence, and the name is
 * written inside the chip either way.
 *
 * Ten is where the measurement landed, not a round number. The chips are pale
 * enough that the sRGB gamut caps their chroma, so hue steps buy less
 * separation than they look like they should: at twelve the adjacent pairs fall
 * to ΔE 14.1 in the dark theme, under the 15 this project already treats as
 * "tellable apart at a glance" for the status colours. At ten the worst pair is
 * 16.8 there and 19.6 in the light theme.
 */
const WORKSPACE_HUES = 10;

/**
 * The hue a workspace is drawn in, taken from its name.
 *
 * FNV-1a rather than the obvious sum of character codes, and the difference is
 * not theoretical: measured over the pairs this list actually holds, `api-v1`
 * and `api-v2` land 179° apart under FNV and 1° apart under a sum. A sum moves
 * by one when a name ends in a different digit, so a family of sibling projects
 * comes out as a single shade — and sibling projects are exactly what the
 * colour exists to separate.
 *
 * The bucket comes from the hash rather than from a hue that is then rounded
 * down. Rounding keeps whatever crowding the hash had: `app` and `site` share a
 * 30° bucket precisely because they were already six degrees apart. Taking the
 * bucket straight from the hash spreads them.
 *
 * Keyed on the name shown rather than on the whole path, so what the reader can
 * see is what decides the colour.
 */
export function workspaceHue(name) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    // Multiplication that wraps at 32 bits, which is what carries a change in
    // the last character up into the high bits.
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % WORKSPACE_HUES) * (360 / WORKSPACE_HUES);
}

/** `now` is passed in rather than read, so this can be asked about a fixed one. */
export function minutesSince(iso, now = Date.now()) {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - started) / 60000));
}
