import { describe, expect, it } from 'vitest';
import { trayIcon, trayText } from './trayIcon';

/**
 * The tray mark, which is drawn rather than shipped, and therefore has to be
 * checked like anything else that is computed.
 *
 * What a test can say about a picture is limited, and the limit is worth being
 * honest about: whether the digits are *legible* was settled by rendering them
 * and looking — drawn at 32px and left for Windows to shrink, 1, 3, 9 and +
 * came out as the same smudge. No assertion here would have caught that. What
 * these do catch is the picture being malformed, empty, or the same whatever
 * the count.
 */

/** The signature every PNG opens with, and the header that follows it. */
const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const dimensions = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

describe('trayText', () => {
  it('shows nothing waiting as a nought rather than as an empty icon', () => {
    // An icon that only appears when something is wrong is one nobody can find
    // when nothing is.
    expect(trayText(0)).toBe('0');
  });

  it('shows the count while two digits fit', () => {
    expect(trayText(1)).toBe('1');
    expect(trayText(9)).toBe('9');
    expect(trayText(47)).toBe('47');
    expect(trayText(99)).toBe('99');
  });

  it('stops at the width it has, rather than drawing something unreadable', () => {
    // Three glyphs do not fit across sixteen pixels at a size that can be read.
    expect(trayText(100)).toBe('+');
    expect(trayText(4000)).toBe('+');
  });
});

describe('trayIcon', () => {
  it('is a PNG of the size it was asked for', () => {
    for (const size of [16, 32]) {
      const png = trayIcon(3, size);
      expect(png.subarray(0, 8).equals(MAGIC)).toBe(true);
      expect(dimensions(png)).toEqual({ width: size, height: size });
    }
  });

  it('draws something for every count it can be given', () => {
    // An icon that came out empty would be an invisible tray entry, which reads
    // as the application having crashed rather than as a drawing failing.
    for (const count of [0, 1, 5, 9, 10, 99]) {
      expect(trayIcon(count).length).toBeGreaterThan(MAGIC.length + 25);
    }
  });

  it('differs between the counts it claims to distinguish', () => {
    const drawn = [0, 1, 2, 3, 5, 8, 9, 10, 47, 99, 100].map((count) =>
      trayIcon(count).toString('base64'),
    );
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('draws everything past ninety-nine the same, because it says the same thing', () => {
    expect(trayIcon(100).equals(trayIcon(4000))).toBe(true);
  });

  it('gives the same bytes for the same count, so the tray is not redrawn for nothing', () => {
    expect(trayIcon(4).equals(trayIcon(4))).toBe(true);
  });
});
