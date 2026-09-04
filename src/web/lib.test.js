import { describe, expect, it, vi } from 'vitest';
import {
  COLUMN_FORMAT,
  FIRST_DIRECTION,
  SORT_KEYS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  WORKSPACE_HUES,
  assignSlots,
  byStatusAge,
  clampColumnWidth,
  contrast,
  day,
  folder,
  hashSlot,
  ink,
  normalizeHex,
  readColumnWidths,
  readableInk,
  readSlots,
  minutesSince,
  reconcileColumnOrder,
  splitDuration,
  normalizeSort,
  readable,
  splitSort,
  toHex,
  toRgb,
  viewStore,
} from './lib.js';

const WHITE = [255, 255, 255];
const DARK = [21, 22, 26];

describe('viewStore', () => {
  it('keeps the request in flight available to the pagehide beacon', async () => {
    let finish;
    const sent = [];
    const beaconed = [];
    const store = viewStore(
      {},
      (patch) => {
        sent.push(patch);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      (patch) => beaconed.push(patch),
    );

    store.set('columns', 'chosen');
    store.pagehide();

    expect(sent).toEqual([{ columns: 'chosen' }]);
    expect(beaconed).toEqual([{ columns: 'chosen' }]);
    finish();
    await store.drain();
  });

  it('waits until every queued change has been acknowledged', async () => {
    const finishes = [];
    const sent = [];
    const store = viewStore({}, (patch) => {
      sent.push(patch);
      return new Promise((resolve) => finishes.push(resolve));
    });

    store.set('theme', 'dark');
    store.set('primary', '#123456');
    let drained = false;
    const drain = store.drain().then(() => {
      drained = true;
    });

    expect(sent).toEqual([{ theme: 'dark' }]);
    expect(drained).toBe(false);
    finishes.shift()();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([{ theme: 'dark' }, { primary: '#123456' }]);
    expect(drained).toBe(false);
    finishes.shift()();
    await drain;
    expect(drained).toBe(true);
  });

  it('puts the latest value over the active one in the pagehide patch', () => {
    const beaconed = [];
    const store = viewStore(
      {},
      () => new Promise(() => undefined),
      (patch, revision) => beaconed.push({ patch, revision }),
    );

    store.set('theme', 'dark');
    store.set('theme', 'light');
    store.pagehide();

    expect(beaconed).toEqual([{ patch: { theme: 'light' }, revision: 2 }]);
  });

  it('journals unresolved changes until their request is acknowledged', async () => {
    let finish;
    const remembered = [];
    const store = viewStore(
      {},
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      undefined,
      (patch, revision) => remembered.push({ patch, revision }),
      7,
    );

    store.set('columns', 'chosen');
    expect(remembered.at(-1)).toEqual({ patch: { columns: 'chosen' }, revision: 8 });
    finish();
    await store.drain();
    expect(remembered.at(-1)).toEqual({ patch: {}, revision: 8 });
  });

  it('does not write a value that was already present or absent', () => {
    const send = vi.fn(async () => undefined);
    const store = viewStore({ theme: 'dark' }, send);

    store.set('theme', 'dark');
    store.remove('primary');

    expect(send).not.toHaveBeenCalled();
  });
});

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

describe('byStatusAge', () => {
  const at = (statusChangedAt) => ({ statusChangedAt });

  it('puts the fewest minutes first, which is the latest change', () => {
    // The inversion this exists to pin down: minutes count how long *ago* the
    // status changed, so ascending minutes is the timestamp descending. The
    // other way round sorts perfectly and backwards, and nothing on screen
    // would say so — every session in the fixture shares a status age.
    const older = at('2026-08-04T10:00:00.000Z');
    const newer = at('2026-08-04T11:00:00.000Z');
    expect(byStatusAge(newer, older)).toBeLessThan(0);
    expect(byStatusAge(older, newer)).toBeGreaterThan(0);
  });

  it('orders a list the way the column reads it', () => {
    const sessions = [
      at('2026-08-04T09:00:00.000Z'),
      at('2026-08-04T11:00:00.000Z'),
      at('2026-08-04T10:00:00.000Z'),
    ];
    expect([...sessions].sort(byStatusAge).map((s) => s.statusChangedAt)).toEqual([
      '2026-08-04T11:00:00.000Z',
      '2026-08-04T10:00:00.000Z',
      '2026-08-04T09:00:00.000Z',
    ]);
    // And reversed, which is what the first click on the header asks for.
    expect([...sessions].sort((a, b) => -byStatusAge(a, b)).map((s) => s.statusChangedAt)).toEqual([
      '2026-08-04T09:00:00.000Z',
      '2026-08-04T10:00:00.000Z',
      '2026-08-04T11:00:00.000Z',
    ]);
  });

  it('says two sessions of the same age are the same age', () => {
    expect(byStatusAge(at('2026-08-04T10:00:00.000Z'), at('2026-08-04T10:00:00.000Z'))).toBe(0);
  });
});

describe('SORT_KEYS and FIRST_DIRECTION', () => {
  it('names a direction for every key it offers', () => {
    // A key with no first direction sorts ascending by accident rather than by
    // decision, and the accident is silent.
    for (const key of SORT_KEYS) {
      expect(FIRST_DIRECTION[key], key).toMatch(/^(asc|desc)$/);
    }
  });

  it('opens the minutes on the longest wait', () => {
    // The useful question about that column is which session has been sitting
    // in its status longest, not which one just changed.
    expect(FIRST_DIRECTION.minutes).toBe('desc');
    expect(normalizeSort('minutes-desc')).toBe('minutes-desc');
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

describe('ink', () => {
  it('writes dark on light and light on dark', () => {
    expect(ink('#ffffff')).toBe('#000000');
    expect(ink('#000000')).toBe('#ffffff');
  });

  it('clears 4.5:1 on any colour that can be picked at all', () => {
    // The claim the free picker rests on. The worst background sits at relative
    // luminance 0.179, where black and white come out equal — and equal is
    // 4.58:1, still above what is asked of text. Swept rather than reasoned.
    let worst = Infinity;
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const hex = toHex([r, g, b]);
          worst = Math.min(worst, contrast(toRgb(ink(hex)), [r, g, b]));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});

describe('normalizeHex', () => {
  it('takes what a person types, in the shapes they type it', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('aabbcc')).toBe('#aabbcc');
    expect(normalizeHex('  #AaBbCc  ')).toBe('#aabbcc');
  });

  it('answers nothing to a value halfway through being typed', () => {
    // The caller paints with the answer, so `#ff` has to come back as nothing:
    // read as a colour it would flash the chip through two or three on the way
    // to the one being asked for.
    expect(normalizeHex('#ff')).toBeNull();
    expect(normalizeHex('#')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });

  it('refuses the near misses rather than guessing at them', () => {
    // Three-digit hex is valid CSS and is deliberately not accepted: `#fff`
    // typed on the way to `#fff000` would paint white for a keystroke.
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex('#aabbccdd')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe('readableInk', () => {
  it('leaves a tinted ink alone when it already reads', () => {
    // The usual case, and the point of the whole thing: on most colours the
    // trace of hue costs nothing and the walk never runs.
    const tinted = '#ffedff';
    expect(readableInk(tinted, '#7a3b8f')).toBe(tinted);
  });

  it('walks the ones that do not, rather than shipping them', () => {
    // Measured in the browser: the tinted white on this red reaches 4.42:1 and
    // on this grey 4.46:1, both under the bar the flat answer clears.
    for (const [tinted, fill] of [
      ['#31090d', '#fa1f19'],
      ['#31090c', '#808080'],
    ]) {
      const walked = readableInk(tinted, fill);
      expect(contrast(toRgb(walked), toRgb(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears the bar for any colour and any starting tint', () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const fill = toHex([r, g, b]);
          // Started from the worst possible candidate: the fill itself.
          const walked = readableInk(fill, fill);
          expect(contrast(toRgb(walked), toRgb(fill))).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('assignSlots', () => {
  const fresh = { slots: {}, colours: {}, inks: {} };

  it('carries the chosen text colour along with the colour it is written on', () => {
    const stored = { slots: {}, colours: { alpha: '#ff0000' }, inks: { alpha: '#ffffff' } };
    const after = assignSlots(['alpha', 'beta'], stored);
    expect(after.inks).toEqual({ alpha: '#ffffff' });
  });

  it('drops the text colour with the project it belonged to', () => {
    const stored = { slots: {}, colours: { gone: '#ff0000' }, inks: { gone: '#ffffff' } };
    expect(assignSlots(['alpha'], stored).inks).toEqual({});
  });

  it('gives every project on screen a colour of its own', () => {
    // The property the whole thing exists for, and the one a hash cannot have:
    // six names drawn from ten colours collide 85% of the time, which is the
    // birthday problem and not a weak hash. The first screenshot of the hashed
    // version had two projects wearing the same colour.
    const names = ['coly-1680', 'coly-1781', 'digicybersec', 'heimdall-agents', 'olympe', 'tva'];
    const { slots } = assignSlots(names, fresh);
    expect(new Set(Object.values(slots)).size).toBe(names.length);
  });

  it('does not move a colour when another project appears', () => {
    // A colour that shifts under the reader is worse than no colour: the list
    // is read by its groups, and the groups would change meaning on a scan.
    const first = assignSlots(['beta', 'delta'], fresh);
    const second = assignSlots(['alpha', 'beta', 'delta'], first);
    expect(second.slots.beta).toBe(first.slots.beta);
    expect(second.slots.delta).toBe(first.slots.delta);
    expect(new Set(Object.values(second.slots)).size).toBe(3);
  });

  it('hands out the same colours twice running on a fresh profile', () => {
    const names = ['alpha', 'beta', 'gamma'];
    expect(assignSlots(names, fresh)).toEqual(assignSlots(names, fresh));
  });

  it('keeps a colour the reader chose, whatever else turns up', () => {
    const chosen = { slots: {}, colours: { alpha: '#ff0000' } };
    const after = assignSlots(['alpha', 'beta', 'gamma'], chosen);
    expect(after.colours).toEqual({ alpha: '#ff0000' });
    // And it takes no slot: it is not competing for the sixteen, so holding one
    // would starve a project that still needs it.
    expect(after.slots.alpha).toBeUndefined();
    expect(new Set(Object.values(after.slots)).size).toBe(2);
  });

  it('gives the palette back when a chosen colour is dropped', () => {
    const after = assignSlots(['alpha', 'beta'], { slots: { beta: 0 }, colours: {} });
    expect(after.slots.alpha).toBeDefined();
    expect(after.colours).toEqual({});
  });

  it('reuses a colour once they have all been given out', () => {
    const many = Array.from({ length: WORKSPACE_HUES.length + 4 }, (_, i) => `project-${i}`);
    const { slots } = assignSlots(many, fresh);
    expect(Object.keys(slots)).toHaveLength(many.length);
    for (const slot of Object.values(slots)) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(WORKSPACE_HUES.length);
    }
    // The first sixteen still have one each; only what follows shares.
    expect(new Set(Object.values(slots)).size).toBe(WORKSPACE_HUES.length);
  });

  it('ignores a stored slot that is not one', () => {
    const { slots } = assignSlots(['alpha', 'beta'], { slots: { alpha: 99, beta: 'blue' } });
    expect(new Set(Object.values(slots)).size).toBe(2);
    for (const slot of Object.values(slots)) expect(slot).toBeLessThan(WORKSPACE_HUES.length);
  });

  it('starts where it is told, so two columns do not open on one colour', () => {
    // The provider column draws from the same list as the workspace column, and
    // both opening on the first colour had `claude` and the first workspace
    // wearing the same pink — a relationship anyone can see and that is not one.
    // Half the list along rather than reversed: the list is a loop, and its last
    // colour sits 32° from its first, which is where reversing first put them.
    const forward = assignSlots(['claude', 'codex'], fresh);
    const shifted = assignSlots(['claude', 'codex'], fresh, WORKSPACE_HUES.length, 8);
    expect(forward.slots).toEqual({ claude: 0, codex: 1 });
    expect(shifted.slots).toEqual({ claude: 8, codex: 9 });
  });

  it('wraps round the list rather than running off the end of it', () => {
    const names = Array.from({ length: WORKSPACE_HUES.length }, (_, i) => `p${i}`);
    const { slots } = assignSlots(names, fresh, WORKSPACE_HUES.length, 14);
    expect(new Set(Object.values(slots)).size).toBe(WORKSPACE_HUES.length);
  });

  it('forgets a colour for a project that is no longer anywhere', () => {
    const after = assignSlots(['alpha'], { slots: {}, colours: { gone: '#ff0000' } });
    expect(after.colours).toEqual({});
  });
});

describe('readSlots', () => {
  it('reads back what was stored', () => {
    expect(
      readSlots('{"slots":{"alpha":0},"colours":{"beta":"#FF8800"},"inks":{"beta":"#000000"}}'),
    ).toEqual({
      slots: { alpha: 0 },
      colours: { beta: '#ff8800' },
      inks: { beta: '#000000' },
    });
  });

  it('keeps the part that still makes sense', () => {
    // Unlike the column widths, a partial answer is useful: a name that lost
    // its slot is given the next free one and nothing else moves.
    expect(readSlots('{"slots":{"alpha":0,"beta":99,"gamma":"x"}}')).toEqual({
      slots: { alpha: 0 },
      colours: {},
      inks: {},
    });
  });

  it('refuses anything that is not a colour it could paint', () => {
    const stored = '{"colours":{"a":"red","b":"#fff","c":"#12345g","d":"#abcdef","e":7}}';
    expect(readSlots(stored).colours).toEqual({ d: '#abcdef' });
  });

  it('takes any text colour, since the picker offers any', () => {
    const stored = '{"colours":{"a":"#abcdef"},"inks":{"a":"#123456"}}';
    expect(readSlots(stored).inks).toEqual({ a: '#123456' });
  });

  it('still refuses a text colour it could not paint', () => {
    const stored = '{"colours":{"a":"#abcdef"},"inks":{"a":"darkish"}}';
    expect(readSlots(stored).inks).toEqual({});
  });

  it('drops a text colour with no chosen background under it', () => {
    // An assigned chip takes its text from the stylesheet along with its
    // background, so an ink for one would be a setting with nothing to apply to.
    expect(readSlots('{"inks":{"a":"#000000"}}').inks).toEqual({});
  });

  it('survives anything at all in the stored value', () => {
    for (const stored of [null, undefined, '', 'not json', '[]', '"text"', '7']) {
      expect(readSlots(stored)).toEqual({ slots: {}, colours: {}, inks: {} });
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
  const stored = (widths) => JSON.stringify({ v: COLUMN_FORMAT, widths });

  it('reads back a complete set', () => {
    expect(readColumnWidths(stored({ status: 50, title: 300 }), keys)).toEqual({
      status: 50,
      title: 300,
    });
  });

  it('clamps on the way in, not only on the way out', () => {
    // What was stored has been through a synchronised profile and possibly a
    // text editor since it was written.
    expect(readColumnWidths(stored({ status: 1, title: 99999 }), keys)).toEqual({
      status: MIN_COLUMN_WIDTH,
      title: MAX_COLUMN_WIDTH,
    });
  });

  it('throws away a set written before the widths were drawn correctly', () => {
    // The migration, and the reason for the stamp. Until 1.1.9 a column could be
    // dragged narrow, the width stored, and something else drawn entirely — so
    // those files describe a layout nobody ever saw. Restoring one after the fix
    // applied it for the first time, and a workspace column that had looked
    // untouched came back at its floor.
    expect(readColumnWidths('{"status":50,"title":300}', keys)).toEqual({});
    expect(readColumnWidths(JSON.stringify({ v: 1, widths: { status: 50 } }), keys)).toEqual({});
  });

  it('drops the whole set when a column is missing from it', () => {
    // Not stubbornness. Under a fixed layout a column with no width takes an
    // equal share of the leftover space instead of sizing to its contents, so
    // restoring "most of" a layout would quietly squash whatever it could not
    // name — after a rename, or an upgrade that added a column.
    expect(readColumnWidths(stored({ status: 50 }), keys)).toEqual({});
    expect(readColumnWidths(stored({ status: 50, title: 'wide' }), keys)).toEqual({});
    expect(readColumnWidths(stored({ status: 50, title: null }), keys)).toEqual({});
  });

  it('ignores a column it no longer has', () => {
    // The opposite case: a column that was removed leaves a key behind, and the
    // ones still on screen are all present, so the layout is restorable.
    expect(readColumnWidths(stored({ status: 50, title: 300, gone: 90 }), keys)).toEqual({
      status: 50,
      title: 300,
    });
  });

  it('survives anything at all in the stored value', () => {
    for (const value of [null, undefined, '', 'not json', '[]', '"text"', '7', '{}']) {
      expect(readColumnWidths(value, keys)).toEqual({});
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

describe('splitDuration', () => {
  it('splits a count of minutes into days, hours and minutes', () => {
    // The two the column actually showed before this existed.
    expect(splitDuration(254)).toEqual({ days: 0, hours: 4, minutes: 14 });
    expect(splitDuration(1248)).toEqual({ days: 0, hours: 20, minutes: 48 });
  });

  it('carries past a day', () => {
    expect(splitDuration(1440)).toEqual({ days: 1, hours: 0, minutes: 0 });
    expect(splitDuration(1501)).toEqual({ days: 1, hours: 1, minutes: 1 });
    expect(splitDuration(18528)).toEqual({ days: 12, hours: 20, minutes: 48 });
  });

  it('is all zeroes for nothing, and for anything it cannot read', () => {
    // The page reads this from a subtraction of two timestamps, and one of them
    // comes from another machine's clock.
    for (const value of [0, -5, NaN, Infinity, undefined]) {
      expect(splitDuration(value), String(value)).toEqual({ days: 0, hours: 0, minutes: 0 });
    }
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

describe('reconcileColumnOrder', () => {
  const declared = ['status', 'starred', 'watched', 'notify', 'minutes', 'title'];

  it('leaves an order that already covers the table exactly as it is', () => {
    const stored = ['title', 'status', 'minutes', 'notify', 'watched', 'starred'];
    expect(reconcileColumnOrder(stored, declared)).toEqual(stored);
  });

  it('puts a new column where the markup declares it, not at the end', () => {
    // The bell, arriving into an order written before it existed. Appended, it
    // landed past the title at the far right of the table; the markup declares
    // it between the two markers it belongs with.
    const stored = ['status', 'watched', 'starred', 'minutes', 'title'];
    expect(reconcileColumnOrder(stored, declared)).toEqual([
      'status',
      'watched',
      'notify',
      'starred',
      'minutes',
      'title',
    ]);
  });

  it('drops a name the table no longer declares', () => {
    const stored = ['status', 'transcript', 'title'];
    expect(reconcileColumnOrder(stored, declared)).not.toContain('transcript');
  });

  it('keeps several new columns in the order they are declared', () => {
    // The first one placed becomes the neighbour the second is placed against.
    expect(reconcileColumnOrder(['status', 'title'], declared)).toEqual([
      'status',
      'starred',
      'watched',
      'notify',
      'minutes',
      'title',
    ]);
  });

  it('puts a column declared first at the front when nothing precedes it', () => {
    expect(reconcileColumnOrder(['title'], declared)[0]).toBe('status');
  });

  it('answers the whole table when the reader has stored nothing', () => {
    expect(reconcileColumnOrder([], declared)).toEqual(declared);
  });
});
