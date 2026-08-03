import { readFileSync } from 'node:fs';

/**
 * Contrast ratios of the interface palette, against WCAG 2.1.
 *
 * Judging colour by eye on one screen is how a palette ends up unreadable on
 * another. AA asks 4.5:1 for text and 3:1 for a shape carrying meaning, which
 * is what the status glyphs are.
 */
const TEXT = 4.5;
const SHAPE = 3;

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Reads the variables out of the stylesheet, so this checks what ships rather
 * than a copy of it that can drift. Each is a `light-dark()` pair, and both
 * branches are pulled apart here.
 */
function palettes(css) {
  const start = css.indexOf(':root {');
  const body = css.slice(start, css.indexOf('}', start));
  const light = {};
  const dark = {};
  const pair = /--([\w-]+):\s*light-dark\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/g;
  for (const [, name, lightValue, darkValue] of body.matchAll(pair)) {
    light[name] = lightValue;
    dark[name] = darkValue;
  }
  return { light, dark };
}

const css = readFileSync('src/web/app.css', 'utf8');
const themes = palettes(css);

/**
 * What a colour becomes once it is drawn at less than full opacity.
 *
 * Leaving this out is how a palette passes on paper and fails on screen: the
 * markers recede with `opacity`, so their measured colour is not the colour
 * anyone sees.
 */
function flatten(hex, over, alpha) {
  const [fr, fg, fb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [br, bg, bb] = [1, 3, 5].map((i) => parseInt(over.slice(i, i + 2), 16));
  const mix = (f, b) => Math.round(f * alpha + b * (1 - alpha));
  return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

const checks = [
  ['fg', 'bg', 1, TEXT, 'body text'],
  ['muted', 'bg', 1, TEXT, 'secondary text'],
  ['muted', 'raised', 1, TEXT, 'secondary text on a control'],
  ['accent', 'bg', 1, TEXT, 'links and pressed chips'],
  ['edge', 'bg', 1, SHAPE, 'control borders'],
  ['edge', 'raised', 1, SHAPE, 'control borders on a control'],
  ['running', 'bg', 1, SHAPE, 'status'],
  ['failed', 'bg', 1, SHAPE, 'status'],
  ['idle', 'bg', 1, SHAPE, 'status'],
  ['unknown', 'bg', 1, SHAPE, 'status'],
  // Drawn quiet on purpose, and still controls you must be able to find.
  ['faint', 'bg', 1, SHAPE, 'unset marker and transcript icon'],
  // A row is not always on the plain background: it can be hovered, selected,
  // or be a pressed chip, and the text has to hold up on each of those too.
  ['fg', 'selected', 1, TEXT, 'text on a selected row or pressed chip'],
  ['muted', 'selected', 1, TEXT, 'secondary text, selected row'],
  ['accent', 'selected', 1, SHAPE, 'set marker on a selected row'],
  ['faint', 'selected', 1, SHAPE, 'quiet marker on a selected row'],
  ['fg', 'hover', 1, TEXT, 'text on a hovered row'],
  ['muted', 'hover', 1, TEXT, 'secondary text, hovered row'],
  ['faint', 'hover', 1, SHAPE, 'quiet marker on a hovered row'],
  ['running', 'selected', 1, SHAPE, 'status on a selected row'],
  ['failed', 'selected', 1, SHAPE, 'status on a selected row'],
  ['idle', 'selected', 1, SHAPE, 'status on a selected row'],
  ['unknown', 'selected', 1, SHAPE, 'status on a selected row'],
];

/**
 * The other question, which measuring against the background never asks.
 *
 * Every status clears the background. That says nothing about whether `running`
 * can be told from `failed`, which is what a green and a red raise for the
 * roughly one man in twelve with a colour vision deficiency.
 *
 * Reported rather than enforced, on purpose. Colour is not the carrier here —
 * each status has a distinct shape, in the rows and in the filter chips — so a
 * close pair is a weakened redundancy rather than a lost meaning. Making it a
 * gate would force a trade this project has looked at and declined: on white,
 * `failed` and `idle` must both be dark to clear 3:1, and two dark warm colours
 * converge under deuteranopia whatever their hue. Separating them costs either a
 * failure that no longer reads as red, or an `idle` that no longer matches the
 * application icon.
 */
function simulate(hex, kind) {
  if (kind === 'normal') return hex;
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const encode = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16)));
  const long = 0.31399022 * r + 0.63951294 * g + 0.04649755 * b;
  const medium = 0.15537241 * r + 0.75789446 * g + 0.08670142 * b;
  const short = 0.01775239 * r + 0.10944209 * g + 0.87256922 * b;
  const l = kind === 'protanopia' ? 1.05118294 * medium - 0.05116099 * short : long;
  const m = kind === 'deuteranopia' ? 0.9513092 * long + 0.04866992 * short : medium;
  return `#${[
    encode(5.47221206 * l - 4.6419601 * m + 0.16963708 * short),
    encode(-1.1252419 * l + 2.29317094 * m - 0.1678952 * short),
    encode(0.02980165 * l - 0.19318073 * m + 1.16364789 * short),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** CIE76. Below about 15, two colours are hard to tell apart at a glance. */
function difference(a, b) {
  const lab = (hex) => {
    const [r, g, b2] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b2) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b2) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    [x, y, z] = [f(x), f(y), f(z)];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const STATUSES = ['running', 'failed', 'idle', 'unknown'];
const CLOSE = 15;

function reportStatusPairs(theme, colours) {
  process.stdout.write(`\n${theme}: statuses against each other\n`);
  for (const vision of ['normal', 'deuteranopia', 'protanopia']) {
    let worst = { value: Infinity, pair: '' };
    for (let i = 0; i < STATUSES.length; i += 1) {
      for (let j = i + 1; j < STATUSES.length; j += 1) {
        const value = difference(
          simulate(colours[STATUSES[i]], vision),
          simulate(colours[STATUSES[j]], vision),
        );
        if (value < worst.value) {
          worst = { value, pair: `${STATUSES[i]}/${STATUSES[j]}` };
        }
      }
    }
    process.stdout.write(
      `  ${worst.value >= CLOSE ? 'ok  ' : 'near'} ${vision.padEnd(13)} ` +
        `closest ${worst.pair.padEnd(16)} ΔE ${worst.value.toFixed(1)}\n`,
    );
  }
}

let failures = 0;
for (const [theme, colours] of Object.entries(themes)) {
  process.stdout.write(`\n${theme}\n`);
  for (const [front, back, alpha, want, label] of checks) {
    if (!colours[front] || !colours[back]) continue;
    const drawn = alpha === 1 ? colours[front] : flatten(colours[front], colours[back], alpha);
    const value = ratio(drawn, colours[back]);
    const ok = value >= want;
    if (!ok) failures += 1;
    const shown = alpha === 1 ? front : `${front} @${alpha}`;
    process.stdout.write(
      `  ${ok ? 'ok  ' : 'FAIL'} ${shown.padEnd(16)} ${value.toFixed(2).padStart(5)}:1 ` +
        `(needs ${want}) — ${label}\n`,
    );
  }
  reportStatusPairs(theme, colours);
}
process.stdout.write(`\n${failures} below target\n`);
process.exitCode = failures ? 1 : 0;
