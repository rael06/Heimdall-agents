import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Draws the application icon, rather than committing a binary nobody can read
 * or change. It is the idle triangle — the one shape in the interface that
 * means "this one has stopped and is waiting for you" — on the dark background
 * the list uses.
 */
const SIZE = 256;
const BG = [0x16, 0x17, 0x1b];
const FG = [0xe5, 0x92, 0x4f];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// A rounded square, so it does not read as a screenshot pasted into a corner.
const radius = 46;
function inRoundedSquare(x, y) {
  const inset = 8;
  const min = inset;
  const max = SIZE - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 || (x >= min + radius && x <= max - radius) || (y >= min + radius && y <= max - radius);
}

// An upward triangle, centred, with a little optical lift.
function inTriangle(x, y) {
  const top = 74;
  const bottom = 186;
  const halfWidth = 66;
  if (y < top || y > bottom) return false;
  const spread = ((y - top) / (bottom - top)) * halfWidth;
  return Math.abs(x - SIZE / 2) <= spread;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let offset = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0; // filter: none
  offset += 1;
  for (let x = 0; x < SIZE; x += 1) {
    const inside = inRoundedSquare(x, y);
    const colour = inTriangle(x, y) ? FG : BG;
    raw[offset] = colour[0];
    raw[offset + 1] = colour[1];
    raw[offset + 2] = colour[2];
    raw[offset + 3] = inside ? 255 : 0;
    offset += 4;
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // truecolour with alpha
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

await mkdir('build', { recursive: true });
await writeFile('build/icon.png', png);
process.stdout.write(`build/icon.png written, ${png.length} bytes\n`);
