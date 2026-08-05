import { deflateSync } from 'node:zlib';

/**
 * The tray mark: the count, large, with the application's shape in the corner.
 *
 * That way round rather than the other, and the reason is what sixteen pixels
 * can hold. A digit tucked into a corner badge gets about five pixels of
 * height, and at five pixels 1, 3, 9 and + are the same vertical smudge —
 * rendered and looked at, not assumed. Given the middle of the icon instead, a
 * digit gets ten, which is legible, and two of them fit side by side. So the
 * number is the icon and the triangle is the badge.
 *
 * It is drawn at the size it will be shown at. Drawn larger and left for Windows
 * to shrink, a glyph pixel stops landing on a screen pixel and the shapes go
 * back to mush.
 *
 * Its own drawing rather than the application icon scaled down, which is the
 * reason for the duplication with `scripts/make-icon.mjs` rather than an excuse
 * for it: that one is 256px and can afford a rounded square and a centred
 * shape, this one is sixteen and must spend every pixel on being read.
 */

type Channels = [number, number, number, number];

/** The tile, so the digits have a known background on any taskbar. */
const TILE: Channels = [0x16, 0x17, 0x1b, 0xff];
/** The idle orange: the status that means the next move is yours. */
const MARK: Channels = [0xe5, 0x92, 0x4f, 0xff];
/** Waiting for you, and nothing waiting: the number says which, the colour agrees. */
const WAITING: Channels = [0xff, 0xd9, 0xc0, 0xff];
const QUIET: Channels = [0x8a, 0x8d, 0x96, 0xff];
const CLEAR: Channels = [0, 0, 0, 0];

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

/**
 * What the icon shows: the count while it fits, and a `+` once it does not.
 *
 * Two digits fit and three do not, so a hundred and upwards says only that
 * there are more than the icon can name. The tooltip carries the figure itself,
 * where it is a number rather than a drawing of one.
 */
export function trayText(count: number): string {
  return count > 99 ? '+' : String(count);
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
  const size = pixels.length;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixels[y][x];
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
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
 * A tile behind everything, because a taskbar is light on one machine and dark
 * on the next. Bare digits would have to read on both, and the orange this
 * application is drawn in measures 6.6:1 on a dark taskbar and 2.2:1 on a light
 * one — so the background is brought along rather than borrowed.
 */
function drawTile(pixels: Channels[][], size: number): void {
  const radius = Math.max(2, Math.round(size / 5));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = Math.min(Math.max(x, radius), size - 1 - radius);
      const cy = Math.min(Math.max(y, radius), size - 1 - radius);
      const inside =
        (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 ||
        (x >= radius && x <= size - 1 - radius) ||
        (y >= radius && y <= size - 1 - radius);
      if (inside) pixels[y][x] = TILE;
    }
  }
}

/** The shape `idle` carries in the list, small, out of the number's way. */
function drawCorner(pixels: Channels[][], size: number): void {
  const unit = size / 16;
  const bottom = size - Math.round(unit);
  const top = bottom - Math.round(4 * unit);
  const halfWidth = 2.5 * unit;
  const centre = size - 1 - 2.5 * unit;
  for (let y = top; y <= bottom; y += 1) {
    const spread = ((y - top) / (bottom - top)) * halfWidth;
    for (let x = 0; x < size; x += 1) {
      if (Math.abs(x + 0.5 - centre) <= spread) pixels[y][x] = MARK;
    }
  }
}

function drawText(pixels: Channels[][], size: number, text: string, colour: Channels): void {
  const scale = Math.max(1, Math.round(size / 8));
  const glyphWidth = 3 * scale;
  const gap = Math.max(1, Math.round(scale / 2));
  const width = text.length * glyphWidth + (text.length - 1) * gap;
  // Left of centre and high, so the corner shape has somewhere to be.
  const originX = Math.max(0, Math.round((size - width) / 2) - Math.round(size / 16));
  const originY = Math.round(size / 16);
  for (let index = 0; index < text.length; index += 1) {
    const glyph = GLYPHS[text[index]] ?? GLYPHS['+'];
    const left = originX + index * (glyphWidth + gap);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (!(glyph[row] & (0b100 >> column))) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const y = originY + row * scale + dy;
            const x = left + column * scale + dx;
            if (y < size && x < size) pixels[y][x] = colour;
          }
        }
      }
    }
  }
}

/**
 * @param count how many sessions carry a status you have not seen. Zero is
 *   drawn rather than hidden: an icon that only appears when something is wrong
 *   is one nobody can find when nothing is.
 * @param size in pixels, and it is the size it will be shown at rather than one
 *   to be scaled from — see the note above about what shrinking does to a digit.
 */
export function trayIcon(count: number, size = 16): Buffer {
  const pixels: Channels[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => CLEAR),
  );
  drawTile(pixels, size);
  drawText(pixels, size, trayText(count), count > 0 ? WAITING : QUIET);
  drawCorner(pixels, size);
  return encodePng(pixels);
}
