import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  WORKSPACE_HUES,
  assignWorkspaceSlots,
  clampColumnWidth,
  contrast,
  day,
  folder,
  hashSlot,
  readColumnWidths,
  readWorkspaceSlots,
  minutesSince,
  normalizeSort,
  readable,
  splitSort,
  toHex,
  toRgb,
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

describe('hashSlot', () => {
  it('answers a slot that exists, for anything a path can end in', () => {
    for (const name of ['webshop', 'a', '', 'PROJECT', 'projet-été', '日本語', '.hidden']) {
      const slot = hashSlot(name);
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(WORKSPACE_HUES.length);
    }
  });

  it('separates the names that differ by one character at the end', () => {
    // The case a sum of character codes gets wrong, and the one that matters:
    // sibling projects are named this way, and a sum puts them next to
    // each other. This only decides the projects past the sixteenth, but those
    // are the ones with nothing else left to separate them.
    expect(hashSlot('api-v1')).not.toBe(hashSlot('api-v2'));
    expect(hashSlot('service-a')).not.toBe(hashSlot('service-b'));
  });

  it('uses the whole list rather than crowding a few', () => {
    const used = new Set();
    for (let index = 0; index < 500; index += 1) used.add(hashSlot(`project-${index}`));
    expect(used.size).toBe(WORKSPACE_HUES.length);
  });
});

describe('assignWorkspaceSlots', () => {
  it('gives every project on screen a colour of its own', () => {
    // The property the whole thing exists for, and the one a hash cannot have:
    // six names drawn from ten colours collide 85% of the time, which is the
    // birthday problem and not a weak hash. The first screenshot of the hashed
    // version had two projects wearing the same colour.
    const names = ['coly-1680', 'coly-1781', 'digicybersec', 'heimdall-agents', 'olympe', 'tva'];
    const slots = assignWorkspaceSlots(names, {});
    expect(new Set(Object.values(slots)).size).toBe(names.length);
  });

  it('does not move a colour when another project appears', () => {
    // A colour that shifts under the reader is worse than no colour: the list
    // is read by its groups, and the groups would change meaning on a scan.
    const first = assignWorkspaceSlots(['beta', 'delta'], {});
    const second = assignWorkspaceSlots(['alpha', 'beta', 'delta'], first);
    expect(second.beta).toBe(first.beta);
    expect(second.delta).toBe(first.delta);
    expect(new Set(Object.values(second)).size).toBe(3);
  });

  it('hands out the same colours twice running on a fresh profile', () => {
    const names = ['alpha', 'beta', 'gamma'];
    expect(assignWorkspaceSlots(names, {})).toEqual(assignWorkspaceSlots(names, {}));
  });

  it('reuses a colour once they have all been given out', () => {
    const many = Array.from({ length: WORKSPACE_HUES.length + 4 }, (_, i) => `project-${i}`);
    const slots = assignWorkspaceSlots(many, {});
    expect(Object.keys(slots)).toHaveLength(many.length);
    for (const slot of Object.values(slots)) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(WORKSPACE_HUES.length);
    }
    // The first sixteen still have one each; only what follows shares.
    expect(new Set(Object.values(slots)).size).toBe(WORKSPACE_HUES.length);
  });

  it('ignores a stored slot that is not one', () => {
    const slots = assignWorkspaceSlots(['alpha', 'beta'], { alpha: 99, beta: 'blue' });
    expect(new Set(Object.values(slots)).size).toBe(2);
    for (const slot of Object.values(slots)) expect(slot).toBeLessThan(WORKSPACE_HUES.length);
  });

  it('refuses to seat two projects on one stored slot', () => {
    // A file written by hand, or two names that were once one.
    const slots = assignWorkspaceSlots(['alpha', 'beta'], { alpha: 3, beta: 3 });
    expect(new Set(Object.values(slots)).size).toBe(2);
  });
});

describe('readWorkspaceSlots', () => {
  it('reads back what was stored', () => {
    expect(readWorkspaceSlots('{"alpha":0,"beta":7}')).toEqual({ alpha: 0, beta: 7 });
  });

  it('keeps the part that still makes sense', () => {
    // Unlike the column widths, a partial answer is useful: a name that lost
    // its slot is given the next free one and nothing else moves.
    expect(readWorkspaceSlots('{"alpha":0,"beta":99,"gamma":"x"}')).toEqual({ alpha: 0 });
  });

  it('survives anything at all in the stored value', () => {
    for (const stored of [null, undefined, '', 'not json', '[]', '"text"', '7']) {
      expect(readWorkspaceSlots(stored)).toEqual({});
    }
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
