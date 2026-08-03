import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  contrast,
  day,
  folder,
  readColumnWidths,
  minutesSince,
  normalizeSort,
  readable,
  splitSort,
  toHex,
  toRgb,
  workspaceHue,
} from './lib.js';

const WHITE = [255, 255, 255];
const DARK = [21, 22, 26];

describe('readable', () => {
  it('walks any colour until it clears 4.5:1 on a light background', () => {
    // The point of the function. A hue picked at random is about as likely to be
    // illegible as not, and this is what the interface test drives six times.
    for (let hue = 0; hue < 360; hue += 15) {
      const picked = toHex(hslToRgb(hue, 0.7, 0.5));
      expect(contrast(toRgb(readable(picked, WHITE)), WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('does the same on a dark background, walking the other way', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const picked = toHex(hslToRgb(hue, 0.7, 0.5));
      expect(contrast(toRgb(readable(picked, DARK)), DARK)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves a colour that already clears the bar alone', () => {
    const already = '#0b2e6f';
    expect(readable(already, WHITE)).toBe(already);
  });

  it('gives up rather than looping forever', () => {
    // Forty steps of 8% cannot always reach 4.5:1 — white on white is the case.
    // It has to return a colour rather than hang, and the interface only ever
    // asks it about a background it is not.
    expect(readable('#ffffff', WHITE)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('contrast', () => {
  it('agrees with the ratios WCAG states', () => {
    expect(contrast(WHITE, [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('does not care which way round it is asked', () => {
    expect(contrast(WHITE, DARK)).toBeCloseTo(contrast(DARK, WHITE), 10);
  });
});

describe('normalizeSort', () => {
  it('keeps a value it already understands', () => {
    expect(normalizeSort('title-asc')).toBe('title-asc');
    expect(normalizeSort('updated-desc')).toBe('updated-desc');
  });

  it('accepts the bare names earlier versions wrote, so an old bookmark sorts', () => {
    expect(normalizeSort('status')).toBe('status-asc');
    expect(normalizeSort('title')).toBe('title-asc');
  });

  it('falls back rather than trusting anything else', () => {
    expect(normalizeSort('')).toBe('created-desc');
    expect(normalizeSort(null)).toBe('created-desc');
    expect(normalizeSort('nonsense')).toBe('created-desc');
    expect(normalizeSort('title-sideways')).toBe('created-desc');
    expect(normalizeSort('nosuchcolumn-asc')).toBe('created-desc');
  });
});

describe('splitSort', () => {
  it('splits on the last hyphen, so a hyphenated key survives', () => {
    expect(splitSort('created-desc')).toEqual({ key: 'created', ascending: false });
    expect(splitSort('title-asc')).toEqual({ key: 'title', ascending: true });
  });

  it('round-trips whatever normalizeSort produced', () => {
    for (const value of ['status', 'title', '', 'workspace-desc']) {
      const { key, ascending } = splitSort(normalizeSort(value));
      expect(normalizeSort(`${key}-${ascending ? 'asc' : 'desc'}`)).toBe(normalizeSort(value));
    }
  });
});

describe('day', () => {
  it('writes the local day the way the date inputs read it', () => {
    expect(day('2026-08-03T14:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('says nothing about a timestamp it cannot read', () => {
    expect(day('not a date')).toBe('');
    expect(day('')).toBe('');
  });
});

describe('folder', () => {
  it('takes the last segment, whichever separator the path uses', () => {
    expect(folder('C:\\Users\\dev\\projects\\webshop')).toBe('webshop');
    expect(folder('/home/dev/projects/webshop')).toBe('webshop');
  });

  it('ignores a trailing separator rather than returning nothing', () => {
    expect(folder('/home/dev/webshop/')).toBe('webshop');
  });

  it('has something to show for a session that recorded no folder', () => {
    expect(folder('')).toBe('-');
    expect(folder(undefined)).toBe('-');
  });
});

describe('workspaceHue', () => {
  const HUES = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

  it('answers one of the ten, for anything a path can end in', () => {
    // Never a value between two of them: the ten are spaced so that any two are
    // tellable apart, and a hue in the gap would be the near miss the spacing
    // exists to avoid.
    for (const name of ['webshop', 'a', '', 'PROJECT', 'projet-été', '日本語', '.hidden']) {
      expect(HUES).toContain(workspaceHue(name));
    }
  });

  it('gives the same name the same colour every time', () => {
    // The point of a hash over a counter: a workspace keeps its colour across
    // reloads, across machines, and whatever order the rows arrived in.
    expect(workspaceHue('webshop')).toBe(workspaceHue('webshop'));
  });

  it('separates the names that differ by one character at the end', () => {
    // The case a sum of character codes gets wrong, and the one that matters:
    // sibling projects are named this way, and a sum puts them 1° apart.
    expect(workspaceHue('api-v1')).not.toBe(workspaceHue('api-v2'));
    expect(workspaceHue('service-a')).not.toBe(workspaceHue('service-b'));
    // The pair that made the ten buckets necessary, and that flooring a hue
    // into buckets would have left sharing one.
    expect(workspaceHue('app')).not.toBe(workspaceHue('site'));
  });

  it('uses all ten rather than crowding a few', () => {
    const used = new Map();
    for (let index = 0; index < 500; index += 1) {
      const hue = workspaceHue(`project-${index}`);
      used.set(hue, (used.get(hue) ?? 0) + 1);
    }
    expect([...used.keys()].sort((a, b) => a - b)).toEqual(HUES);
    // Even spread would be 50 each. This asserts none is nearly unused and none
    // takes a fifth of the list, not that the hash is uniform.
    expect(Math.min(...used.values())).toBeGreaterThan(20);
    expect(Math.max(...used.values())).toBeLessThan(100);
  });
});

describe('clampColumnWidth', () => {
  it('keeps a width the pointer could have produced', () => {
    expect(clampColumnWidth(240)).toBe(240);
  });

  it('refuses a column too narrow to take hold of again', () => {
    // Dragged to nothing there is no edge left to drag back, so the floor is
    // what keeps the gesture reversible rather than what looks tidy.
    expect(clampColumnWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(-500)).toBe(MIN_COLUMN_WIDTH);
  });

  it('refuses one no window could show', () => {
    expect(clampColumnWidth(99_999)).toBe(MAX_COLUMN_WIDTH);
  });

  it('rounds, because it is a count of pixels', () => {
    expect(clampColumnWidth(240.6)).toBe(241);
  });
});

describe('readColumnWidths', () => {
  const keys = ['status', 'title'];

  it('reads back a complete set', () => {
    expect(readColumnWidths('{"status":50,"title":300}', keys)).toEqual({
      status: 50,
      title: 300,
    });
  });

  it('clamps on the way in, not only on the way out', () => {
    // What was stored has been through a synchronised profile and possibly a
    // text editor since it was written.
    expect(readColumnWidths('{"status":1,"title":99999}', keys)).toEqual({
      status: MIN_COLUMN_WIDTH,
      title: MAX_COLUMN_WIDTH,
    });
  });

  it('drops the whole set when a column is missing from it', () => {
    // Not stubbornness. Under a fixed layout a column with no width takes an
    // equal share of the leftover space instead of sizing to its contents, so
    // restoring "most of" a layout would quietly squash whatever it could not
    // name — after a rename, or an upgrade that added a column.
    expect(readColumnWidths('{"status":50}', keys)).toEqual({});
    expect(readColumnWidths('{"status":50,"title":"wide"}', keys)).toEqual({});
    expect(readColumnWidths('{"status":50,"title":null}', keys)).toEqual({});
  });

  it('ignores a column it no longer has', () => {
    // The opposite case: a column that was removed leaves a key behind, and the
    // ones still on screen are all present, so the layout is restorable.
    expect(readColumnWidths('{"status":50,"title":300,"gone":90}', keys)).toEqual({
      status: 50,
      title: 300,
    });
  });

  it('survives anything at all in the stored value', () => {
    for (const stored of [null, undefined, '', 'not json', '[]', '"text"', '7', '{}']) {
      expect(readColumnWidths(stored, keys)).toEqual({});
    }
  });
});

describe('minutesSince', () => {
  const now = Date.parse('2026-08-03T12:00:00.000Z');

  it('counts whole minutes', () => {
    expect(minutesSince('2026-08-03T11:00:00.000Z', now)).toBe(60);
    expect(minutesSince('2026-08-03T11:59:30.000Z', now)).toBe(0);
  });

  it('never counts backwards, whatever a clock did', () => {
    // Transcripts carry timestamps written by another machine's clock.
    expect(minutesSince('2026-08-03T13:00:00.000Z', now)).toBe(0);
  });

  it('answers zero for a timestamp it cannot read', () => {
    expect(minutesSince('nonsense', now)).toBe(0);
  });
});

/** Only so the tests can pick colours the way the Random button does. */
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
