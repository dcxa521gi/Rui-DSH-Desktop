#!/usr/bin/env node
/**
 * Write resources/icon.png — a 512x512 app mark that does not use official
 * DeepSeek artwork. Pure Node (zlib); no extra dependencies.
 */
import { createWriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 512
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources')
const outFile = join(outDir, 'icon.png')

mkdirSync(outDir, { recursive: true })

const pixels = Buffer.alloc(SIZE * SIZE * 4)

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  pixels[i] = r
  pixels[i + 1] = g
  pixels[i + 2] = b
  pixels[i + 3] = a
}

function fillRect(x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(x, y, r, g, b)
  }
}

function fillRoundedRect(x0, y0, x1, y1, radius, r, g, b) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = x < x0 + radius ? x0 + radius - x : x > x1 - radius ? x - (x1 - radius) : 0
      const dy = y < y0 + radius ? y0 + radius - y : y > y1 - radius ? y - (y1 - radius) : 0
      if (dx * dx + dy * dy <= radius * radius) setPixel(x, y, r, g, b)
    }
  }
}

// Background
fillRect(0, 0, SIZE, SIZE, 16, 20, 28)
// Mark
fillRoundedRect(64, 64, 448, 448, 72, 11, 18, 28)
// Accent frame
fillRoundedRect(64, 64, 448, 448, 72, 94, 224, 181)
fillRoundedRect(84, 84, 428, 428, 56, 16, 22, 32)

// Letter R as block geometry
const ink = [232, 236, 241]
fillRect(170, 150, 214, 362, ...ink)
fillRect(214, 150, 330, 194, ...ink)
fillRect(314, 194, 358, 238, ...ink)
fillRect(214, 238, 330, 282, ...ink)
for (let t = 0; t < 90; t += 1) {
  const x = 230 + t
  const y = 282 + Math.floor(t * 0.9)
  fillRect(x, y, x + 40, y + 36, ...ink)
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 4 + 1)
  raw[rowStart] = 0
  pixels.copy(raw, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const stream = createWriteStream(outFile)
stream.end(png)
stream.on('finish', () => {
  console.log(`generate-icon: wrote ${outFile}`)
})
