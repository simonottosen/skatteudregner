/**
 * Generate `mcpb/icon.png` — the icon MCPB hosts show for the extension.
 *
 * Drawn in code rather than committed as an opaque binary so it can be reviewed
 * and tweaked: a rounded-square Dannebrog (Danish flag), which is about as
 * on-the-nose as a Danish tax tool can get. Written with a hand-rolled PNG
 * encoder so the repo needs no image dependency.
 *
 * Usage: node scripts/make-mcpb-icon.mjs [size]
 */

import { deflateSync } from "node:zlib"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, "..", "mcpb", "icon.png")

const SIZE = Number(process.argv[2]) || 512
/** Samples per axis; 4 gives clean edges on the corners and the cross. */
const AA = 4

const RED = [0xc6, 0x0c, 0x30] // Dannebrog red
const WHITE = [0xff, 0xff, 0xff]

const CORNER = 0.18 // corner radius as a fraction of the size
const BAR = 0.14 // cross-bar thickness as a fraction of the size
const CROSS_X = 0.38 // vertical bar's centre, as a fraction of the width

/** Is (x, y), in 0..1 space, inside the rounded square? */
function insideRoundedSquare(x, y) {
  const r = CORNER
  const dx = x < r ? r - x : x > 1 - r ? x - (1 - r) : 0
  const dy = y < r ? r - y : y > 1 - r ? y - (1 - r) : 0
  return dx * dx + dy * dy <= r * r
}

/** Is (x, y), in 0..1 space, on the white Nordic cross? */
function onCross(x, y) {
  const half = BAR / 2
  return Math.abs(x - CROSS_X) <= half || Math.abs(y - 0.5) <= half
}

function crc32Table() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crc32Table()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function render(size) {
  // Each scanline is a filter byte (0 = none) followed by RGBA pixels.
  const raw = Buffer.alloc(size * (1 + size * 4))
  const step = 1 / (size * AA)

  for (let py = 0; py < size; py++) {
    const rowStart = py * (1 + size * 4)
    raw[rowStart] = 0
    for (let px = 0; px < size; px++) {
      let inside = 0
      let white = 0
      for (let sy = 0; sy < AA; sy++) {
        const y = (py * AA + sy + 0.5) * step
        for (let sx = 0; sx < AA; sx++) {
          const x = (px * AA + sx + 0.5) * step
          if (!insideRoundedSquare(x, y)) continue
          inside++
          if (onCross(x, y)) white++
        }
      }
      const samples = AA * AA
      const offset = rowStart + 1 + px * 4
      if (inside === 0) continue // transparent outside the rounded square
      // Blend red and white by coverage, then apply the shape's alpha.
      const w = white / inside
      for (let c = 0; c < 3; c++) {
        raw[offset + c] = Math.round(RED[c] * (1 - w) + WHITE[c] * w)
      }
      raw[offset + 3] = Math.round((inside / samples) * 255)
    }
  }
  return raw
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(render(SIZE), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`Wrote ${OUT} (${SIZE}×${SIZE}, ${png.length} bytes)`)
