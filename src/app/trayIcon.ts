import { deflateSync } from 'node:zlib';

/**
 * The tray mark, drawn here rather than shipped as a binary nobody can read.
 *
 * Its own drawing rather than the application icon scaled down, and that is the
 * reason for the duplication with `scripts/make-icon.mjs` rather than an excuse
 * for it. The icon is 256px and wears a rounded square so it does not read as a
 * screenshot pasted into a corner; a tray mark is shown at 16px beside a dozen
 * others, where a square background is a smudge and every pixel spent on it is
 * one not spent on the shape. So: the triangle alone, on nothing.
 *
 * The count is drawn into it because that is what was asked for, and what that
 * can be at this size was rendered and looked at rather than assumed. Drawn at
 * 32px and left for Windows to shrink, the digits were mush: 1, 3, 9 and + came
 * out as the same vertical smudge, because a five-pixel-tall glyph halved is
 * two and a half pixels of anything. So it is drawn at the size it will be
 * shown at, where a glyph pixel is a screen pixel and the shapes survive.
 *
 * Even so, one digit is the limit. Ten or more is a `+`, and the exact figure
 * lives in the tooltip, where it is a number rather than a drawing of one.
 */
/** The idle orange: the status that means the next move is yours. */
const MARK: Channels = [0xe5, 0x92, 0x4f, 0xff];
const BADGE: Channels = [0xd6, 0x3a, 0x2f, 0xff];
const ON_BADGE: Channels = [0xff, 0xff, 0xff, 0xff];
const CLEAR: Channels = [0, 0, 0, 0];

type Channels = [number, number, number, number];

/**
 * Three by five, which is the smallest a digit can be and still be one.
 *
 * Each row is three bits, high bit leftmost. Hand-set rather than rasterised
 * from a font: at this size hinting decides whether a 6 and an 8 differ, and no
 * font engine is going to make that call for a five-pixel glyph.
 */
const GLYPHS: Record<string, number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '+': [0b000, 0b010, 0b111, 0b010, 0b000],
};

/** What the badge shows: one digit, or a `+` once counting stops helping. */
export function badgeText(count: number): string {
  return count > 9 ? '+' : String(count);
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(pixels: Channels[][]): Buffer {
  const SIZE = pixels.length;
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = pixels[y][x];
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark itself: an upward triangle, the shape `idle` carries in the list.
 *
 * It stops short of the bottom-right corner when a badge is coming, because a
 * badge overlapping the shape it annotates makes both unreadable at 16px.
 */
function drawMark(pixels: Channels[][], size: number, badged: boolean): void {
  const unit = size / 16;
  const top = Math.round(unit * (badged ? 1 : 2));
  const bottom = Math.round(unit * (badged ? 11 : 14));
  const halfWidth = unit * (badged ? 5.5 : 6.5);
  const centre = badged ? unit * 6 : size / 2;
  for (let y = top; y <= bottom; y += 1) {
    const spread = ((y - top) / (bottom - top)) * halfWidth;
    for (let x = 0; x < size; x += 1) {
      if (Math.abs(x + 0.5 - centre) <= spread) pixels[y][x] = MARK;
    }
  }
}

function drawBadge(pixels: Channels[][], size: number, text: string): void {
  const scale = Math.max(1, Math.floor(size / 16));
  // Big enough to hold a three-by-five glyph with a pixel of air around it.
  const radius = 3.5 * scale;
  const cx = size - radius;
  const cy = size - radius;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2) pixels[y][x] = BADGE;
    }
  }
  // Aligned to the pixel grid on purpose: a glyph this small survives only if
  // each of its pixels lands on exactly one of the screen's.
  const glyph = GLYPHS[text] ?? GLYPHS['+'];
  const originX = Math.round(cx - (3 * scale) / 2);
  const originY = Math.round(cy - (5 * scale) / 2);
  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (!(glyph[row] & (0b100 >> column))) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          pixels[originY + row * scale + dy][originX + column * scale + dx] = ON_BADGE;
        }
      }
    }
  }
}

/**
 * @param count how many sessions carry a status you have not seen. Zero draws
 *   the plain mark, which is the state the tray spends nearly all its time in.
 * @param size in pixels, and it is the size it will be shown at rather than one
 *   to be scaled from — see the note above about what shrinking does to a digit.
 */
export function trayIcon(count: number, size = 16): Buffer {
  const pixels: Channels[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => CLEAR),
  );
  const badged = count > 0;
  drawMark(pixels, size, badged);
  if (badged) drawBadge(pixels, size, badgeText(count));
  return encodePng(pixels);
}
