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
}
process.stdout.write(`\n${failures} below target\n`);
process.exitCode = failures ? 1 : 0;
