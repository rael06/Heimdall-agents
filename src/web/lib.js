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
  'minutes',
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
  // Longest first: the useful question about this column is which session has
  // been sitting in its status the longest, not which one just changed.
  minutes: 'desc',
  created: 'desc',
  updated: 'desc',
  provider: 'asc',
  workspace: 'asc',
  title: 'asc',
};

/**
 * Two sessions, fewest minutes in their current status first.
 *
 * Here rather than beside the other comparators, and for a reason worth stating:
 * the minutes are how long *ago* the status changed, so ascending minutes is the
 * timestamp descending. Written the natural way round it sorts perfectly and
 * backwards, and nothing on screen would say so — every session in the test
 * fixture shares a status age, because that age is measured from when the
 * service first saw the session rather than from anything in the transcript. So
 * the direction is settled here, where it can be asked directly.
 */
export const byStatusAge = (a, b) =>
  Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt);

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
 * Where a column starts when the reader first takes the widths over.
 *
 * Only the workspace is listed, and it earns its line. Its cells hold a chip
 * with a name in it, so measuring what it "needs" measures whichever project
 * happens to have the longest name today; 80px shows a normal one and cuts the
 * outliers, which is the same trade the 14ch cap already makes.
 */
export const DEFAULT_COLUMN_WIDTHS = { workspace: 80 };

/**
 * The shape the widths are stored in.
 *
 * Raised to 2 to throw away everything written before it, which is a migration
 * rather than tidiness. Until 1.1.9 a column could be dragged narrow, the width
 * was stored, and the table drew something else entirely — so those files record
 * a layout that was never on screen. Restoring one after the fix applied it for
 * the first time, and a workspace column that had looked untouched came back at
 * its floor. Dropping them hands the table back to automatic once, which is the
 * only state that is certainly right.
 */
export const COLUMN_FORMAT = 2;

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
  if (parsed.v !== COLUMN_FORMAT) return {};
  const widths = {};
  for (const key of keys) {
    const value = parsed.widths?.[key];
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
 * The one colour a chip carrying a chosen background can safely write on it.
 *
 * Black or white rather than a tint of the same hue, and that is not a
 * simplification — it is the only choice that holds for a colour nobody
 * constrained. Whatever is picked, the better of the two clears 4.58:1: the
 * worst background for this sits at relative luminance 0.179, where both come
 * out equal, and equal is still above the 4.5 asked of text.
 */
export function ink(hex) {
  const background = toRgb(hex);
  return contrast([0, 0, 0], background) >= contrast([255, 255, 255], background)
    ? '#000000'
    : '#ffffff';
}

/**
 * A tinted text colour, walked until it is readable on the chip it sits on.
 *
 * The tint is what makes an assigned chip look considered: its text is a
 * near-white or near-black carrying a trace of its own hue rather than a flat
 * one. Measured, that trace costs contrast — on `#fa1f19` the tinted white
 * reaches 4.42:1 and on `#808080` 4.46:1, both under the bar where the flat
 * answer clears it. So the tint is the starting point and not the answer: it is
 * walked towards whichever of black or white wins on that background until it
 * clears 4.5:1, which for most colours means it never moves at all.
 *
 * Not {@link readable}, which walks towards black or white by asking whether
 * the background is above half luminance. That is the wrong question here: a
 * background at 0.3 is below half and still takes black, because the answer
 * turns over at 0.179 rather than 0.5.
 */
export function readableInk(candidate, fill) {
  const background = toRgb(fill);
  const flat = ink(fill);
  const target = toRgb(flat);
  let colour = toRgb(candidate);
  // Judged on the colour that gets painted, not on the one being walked: the
  // channels are fractional while the loop runs and the rounding on the way out
  // is enough to drop back under the bar.
  const painted = (value) => toRgb(toHex(value));
  for (let step = 0; step < 40 && contrast(painted(colour), background) < 4.5; step += 1) {
    colour = colour.map((value, index) => value + (target[index] - value) * 0.08);
  }
  // The walk approaches its target without ever arriving — forty steps of eight
  // per cent leave three and a half per cent of the distance — and on the worst
  // backgrounds that remainder is the difference between 4.48:1 and the 4.58:1
  // the flat answer guarantees. Measured, not predicted: the sweep below caught
  // it. So a walk that runs out falls back rather than shipping a near miss.
  return contrast(painted(colour), background) >= 4.5 ? toHex(colour) : flat;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A hex a person typed, or nothing.
 *
 * Forgiving about the parts nobody means: the leading hash, the case, and the
 * spaces either side of a value that came off a clipboard. Strict about the
 * rest, because the caller paints with the answer — a half-typed `#ff` must
 * come back as nothing rather than as some colour, or the chip would flicker
 * through three of them on the way to the one being typed.
 */
export function normalizeHex(text) {
  const trimmed = String(text ?? '').trim();
  const hashed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX.test(hashed) ? hashed.toLowerCase() : null;
}

/**
 * What was stored, kept wherever it is still a colour.
 *
 * A partial answer is useful here, unlike the column widths: a name whose slot
 * was lost is simply given the next free one, and every other project keeps the
 * colour it had. There is nothing to squash.
 *
 * `colours` are the ones chosen by hand, held as what was chosen rather than as
 * a place in a list — the picker offers the whole range now, so there is no
 * list to hold a place in. A name in there takes no slot at all: it is not
 * competing for the sixteen, so reserving one would have starved a project that
 * still needed it.
 */
export function readSlots(stored, count = WORKSPACE_HUES.length) {
  let parsed;
  try {
    parsed = JSON.parse(stored ?? '');
  } catch {
    return { slots: {}, colours: {}, inks: {} };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { slots: {}, colours: {}, inks: {} };
  }
  const slots = {};
  for (const [name, slot] of Object.entries(parsed.slots ?? {})) {
    if (Number.isInteger(slot) && slot >= 0 && slot < count) slots[name] = slot;
  }
  const colours = {};
  for (const [name, value] of Object.entries(parsed.colours ?? {})) {
    if (typeof value === 'string' && HEX.test(value)) colours[name] = value.toLowerCase();
  }
  // Any colour, like the background it is written on — the picker offers the
  // whole range for both. Only where there is a chosen background to write it
  // on, though: an assigned chip takes its text from the stylesheet along with
  // its fill, so an ink for one would be a setting with nothing to apply to.
  const inks = {};
  for (const [name, value] of Object.entries(parsed.inks ?? {})) {
    if (typeof value === 'string' && HEX.test(value) && colours[name] !== undefined) {
      inks[name] = value.toLowerCase();
    }
  }
  return { slots, colours, inks };
}

/**
 * @param names sorted, so a profile that has never seen any of them hands out
 *   the same colours in the same order twice running.
 * @param stored `{ slots, colours }` as {@link readSlots} returns it.
 * @param offset where in the list to start handing colours out. Two columns
 *   drawing from one palette both open on its first colour otherwise, which had
 *   `claude` and the first workspace wearing the same pink — a relationship the
 *   reader can see and that does not exist. Half the list apart rather than
 *   reversed: the list is a loop, and its last colour sits 32° from its first.
 */
export function assignSlots(names, stored, count = WORKSPACE_HUES.length, offset = 0) {
  const previous = stored?.slots ?? {};
  const colours = stored?.colours ?? {};
  // A name with a colour of its own is not competing for the sixteen, so it is
  // left out of the assignment entirely rather than holding a slot it does not
  // use — which would have starved a project that still needed one.
  const automatic = names.filter((name) => colours[name] === undefined);
  const slots = {};
  const taken = new Set();

  const claim = (name, slot) => {
    slots[name] = slot;
    taken.add(slot);
  };

  // What was given out before stays given out, where it is still free. A project
  // changing colour because another one appeared is the thing this must avoid.
  for (const name of automatic) {
    const slot = previous[name];
    if (Number.isInteger(slot) && slot >= 0 && slot < count && !taken.has(slot)) claim(name, slot);
  }
  const order = Array.from({ length: count }, (_, index) => (index + offset) % count);
  let next = 0;
  for (const name of automatic) {
    if (slots[name] !== undefined) continue;
    while (next < count && taken.has(order[next])) next += 1;
    if (next < count) claim(name, order[next]);
    // More projects than colours. Two of them share, and the hash at least
    // makes it stable and spread rather than "whichever loaded first".
    else slots[name] = hashSlot(name, count);
  }
  const kept = {};
  const keptInks = {};
  const inks = stored?.inks ?? {};
  for (const name of names) {
    if (colours[name] === undefined) continue;
    kept[name] = colours[name];
    if (inks[name] !== undefined) keptInks[name] = inks[name];
  }
  return { slots, colours: kept, inks: keptInks };
}

/** `now` is passed in rather than read, so this can be asked about a fixed one. */
/**
 * A count of minutes as days, hours and minutes.
 *
 * Returned in parts rather than as a string, because the letters that name them
 * are words: `d` in English and `j` in French. The arithmetic belongs here where
 * it can be tested without a document; naming the units belongs to the page,
 * which is the only side that knows the language.
 */
export function splitDuration(total) {
  const safe = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  return {
    days: Math.floor(safe / 1440),
    hours: Math.floor((safe % 1440) / 60),
    minutes: safe % 60,
  };
}

export function minutesSince(iso, now = Date.now()) {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - started) / 60000));
}
