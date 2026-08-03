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

// ------------------------------------------------------------------ columns

/**
 * The narrowest and widest a column may be dragged, in pixels.
 *
 * The minimum is not cosmetic. A column dragged to nothing cannot be dragged
 * back — there is no edge left to take hold of — so the floor is what keeps the
 * gesture reversible. It is 24 and not 40 because the first drag records every
 * column at whatever width it already had, and the three marker columns sit at
 * 32: a floor above them would have quietly widened three columns as the price
 * of touching a fourth. The ceiling is there for the stored file rather than
 * for the pointer: a width read back from disk has been through a text editor
 * and a synchronised profile since it was written.
 */
export const MIN_COLUMN_WIDTH = 24;
export const MAX_COLUMN_WIDTH = 1200;

export const clampColumnWidth = (value) =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)));

/**
 * The column widths worth restoring out of whatever was stored.
 *
 * All of them or none, which is the part worth explaining. Once the table is
 * laid out to fixed widths, a column without one no longer sizes to its
 * contents — it takes an equal share of whatever is left over. So a set that
 * has lost a key, because a column was renamed or added between versions,
 * would not restore "most of" the layout: it would quietly squash the columns
 * it could not name. Falling back to automatic is the honest answer, and the
 * user's next drag writes a complete set again.
 */
export function readColumnWidths(stored, keys) {
  let parsed;
  try {
    parsed = JSON.parse(stored ?? '');
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const widths = {};
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      widths[key] = clampColumnWidth(value);
    }
  }
  return Object.keys(widths).length === keys.length ? widths : {};
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
 * The colours a workspace can wear.
 *
 * Not evenly spaced, and not chosen. These are what a search returned when it
 * was asked, at each step, for the hue furthest from every hue already taken —
 * judged on the worse of the two themes, in CIE76, on the colours Chromium
 * actually paints. Even steps in hue are not even steps in colour: sixteen of
 * those leave a worst pair at ΔE 9.9 in the dark theme, where these sixteen
 * hold 12.7 in both.
 *
 * Sixteen because that is where the list stops being worth extending: eighteen
 * drops to 10.6 and twenty to 8.3.
 *
 * The bar is 12 rather than the 15 the statuses are held to, and the difference
 * is not a relaxation. A status is a 13px glyph whose colour is one of only two
 * things saying what it is. A workspace chip is a wide patch of colour with the
 * name written inside it, so the colour groups the list and the text identifies
 * it. Redundant information can be told apart at a lower bar than information
 * carrying its own meaning alone.
 */
export const WORKSPACE_HUES = [
  0, 17, 33, 60, 85, 102, 118, 133, 149, 168, 186, 204, 224, 255, 285, 328,
];

/**
 * The colour a name falls into when there is none left to give it.
 *
 * FNV-1a rather than the obvious sum of character codes, and the difference is
 * not theoretical: measured over the pairs this list actually holds, `api-v1`
 * and `api-v2` land 179° apart under FNV and 1° apart under a sum. A sum moves
 * by one when a name ends in a different digit, so a family of sibling projects
 * comes out as a single shade — and sibling projects are exactly what a colour
 * per workspace exists to separate.
 */
export function hashSlot(name, count = WORKSPACE_HUES.length) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    // Multiplication that wraps at 32 bits, which is what carries a change in
    // the last character up into the high bits.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

/**
 * A colour each, for the workspaces on screen.
 *
 * Handing every name to a hash and hoping cannot do this, and the arithmetic
 * says so rather than a preference: six workspaces drawn from ten colours
 * collide 85% of the time, and that is not a flaw in the hash. It is the
 * birthday problem, and it does not go away by adding colours — six from
 * sixteen still collide two times in three, and there are nowhere near enough
 * distinguishable colours to make it rare. The first version of this shipped
 * with a hash and the very first screenshot of it had two projects wearing the
 * same colour.
 *
 * So the colours are given out rather than computed, lowest free one first, and
 * remembered. What that buys is the property the feature exists for: no two
 * projects on screen share a colour while there are colours left. What it costs
 * is that the colour is no longer a function of the name alone — the same
 * project can come out differently on another machine, which is a fair price
 * for a view aid that is stored beside the theme.
 *
 * `names` is expected sorted, so a profile that has never seen any of them
 * hands out the same colours in the same order twice running.
 */
/**
 * What was stored, kept wherever it is still a colour.
 *
 * A partial answer is useful here, unlike the column widths: a name whose slot
 * was lost is simply given the next free one, and every other project keeps the
 * colour it had. There is nothing to squash.
 */
export function readWorkspaceSlots(stored, count = WORKSPACE_HUES.length) {
  let parsed;
  try {
    parsed = JSON.parse(stored ?? '');
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const slots = {};
  for (const [name, slot] of Object.entries(parsed)) {
    if (Number.isInteger(slot) && slot >= 0 && slot < count) slots[name] = slot;
  }
  return slots;
}

export function assignWorkspaceSlots(names, stored, count = WORKSPACE_HUES.length) {
  const slots = {};
  const taken = new Set();
  // What was already given out stays given out. A project changing colour
  // because another one appeared is the thing this has to avoid.
  for (const name of names) {
    const slot = stored?.[name];
    if (Number.isInteger(slot) && slot >= 0 && slot < count && !taken.has(slot)) {
      slots[name] = slot;
      taken.add(slot);
    }
  }
  let next = 0;
  for (const name of names) {
    if (slots[name] !== undefined) continue;
    while (next < count && taken.has(next)) next += 1;
    if (next < count) {
      slots[name] = next;
      taken.add(next);
    } else {
      // More projects than colours. Two of them share, and the hash at least
      // makes it stable and spread rather than "whichever loaded first".
      slots[name] = hashSlot(name, count);
    }
  }
  return slots;
}

/** `now` is passed in rather than read, so this can be asked about a fixed one. */
export function minutesSince(iso, now = Date.now()) {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - started) / 60000));
}
