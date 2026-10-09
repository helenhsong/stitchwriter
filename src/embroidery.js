// Embroidery engine: the whole viewport is a piece of woven linen, and text
// is satin-stitched into it in coloured thread, letter by letter. Layout
// still runs on a fine grid of cells, which also sets the order each
// letter is worked in.

export const STITCH_FONT = '"Pinyon Script", cursive'
export const STITCH_FONT_STYLE = '400'
export const HEADER_HEIGHT = 66

// Crimson embroidery floss.
const FLOSS = [152, 13, 41]
const FLOSS_LIGHT = [206, 48, 72]
const FLOSS_DEEP = [124, 10, 33]
const THREAD = rgb(FLOSS)
const THREAD_DEEP = rgb(FLOSS_DEEP)
const TWIST = 'rgba(70, 0, 14, 0.3)'
// The shadow raised thread casts on the cloth.
const SHADOW = 'rgb(74, 54, 40)'

const LINEN = [232, 226, 214]
const LINEN_TILE = 360
const LINEN_PITCH = 3.2

const SUBSAMPLE = 8
// Generous coverage so even hairlines are worked, and revealed, in order.
const COVERAGE = 0.12
// Satin stitches lie at this slant, as in machine-embroidered script.
const SATIN_ANGLE = (-28 * Math.PI) / 180
// A touch of extra weight so hairlines carry a few stitches.
const SATIN_WEIGHT = 0.025
const CELL_FILL_MS = 110

function rgb(colour, alpha = 1) {
  return `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

// Smooth one-dimensional value noise.
function noise(seed, t) {
  const i = Math.floor(t)
  const f = t - i
  const a = hash(seed, i)
  const b = hash(seed, i + 1)
  return a + (b - a) * f * f * (3 - 2 * f)
}

export function createGeometry(viewportWidth, viewportHeight) {
  const compact = viewportWidth < 560
  const cell = compact ? 3 : clamp(Math.round(viewportWidth / 480) + 1, 4, 5)
  // The script is set at em cells to the font size; everything else
  // (spacing, the caret, the seal) is sized to match it.
  const em = 15
  const cols = Math.ceil(viewportWidth / cell)
  const rows = Math.ceil(viewportHeight / cell)
  const headerRows = Math.ceil(HEADER_HEIGHT / cell)
  // The seal: an embroidered title with fairy dust at the top
  // of the page, between the header buttons on wide screens.
  const centre = Math.floor(Math.floor(viewportWidth / cell) / 2)
  const sealTop = compact ? headerRows + 2 : 6
  const sealBottom = sealTop + 28
  // Below the seal, open cloth for the writing.
  const across = compact
    ? Math.floor(viewportWidth / cell) - 16
    : Math.round(Math.min(viewportWidth * 0.56, 760) / cell)
  const inner = {
    left: centre - Math.floor(across / 2),
    right: centre - Math.floor(across / 2) + across - 1,
    top: sealBottom + (compact ? 16 : 20),
    bottom: Math.floor(viewportHeight / cell) - 1 - (compact ? 10 : 16),
  }
  // The writing area doubles as the piece's extent, which grows with it.
  const frame = { ...inner }
  return {
    cell,
    em,
    seal: { centre, top: sealTop, bottom: sealBottom },
    cols,
    rows,
    frame,
    inner,
    lineHeight: Math.round(em * 1.25),
    baselineOffset: em,
    textLeft: inner.left,
    textCols: Math.max(10, inner.right - inner.left + 1),
    textTop: inner.top,
    visibleTextRows: Math.max(1, inner.bottom - inner.top + 1),
  }
}

const glyphCache = new Map()
let measureContext = null

function getMeasureContext(em) {
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  measureContext.font = `${STITCH_FONT_STYLE} ${em * SUBSAMPLE}px ${STITCH_FONT}`
  return measureContext
}

// Chart one character onto cells. Cells are relative to the glyph's origin
// column and baseline row, and are ordered the way satin stitch is worked:
// column by column from left to right, back and forth across the stroke.
export function getGlyph(character, em) {
  const cacheKey = `${em}:${character}`
  const cached = glyphCache.get(cacheKey)
  if (cached) return cached

  const measure = getMeasureContext(em)
  const advance = measure.measureText(character).width / SUBSAMPLE
  const pad = Math.ceil(em * 0.6)
  const ascent = Math.ceil(em * 1.05)
  const descent = Math.ceil(em * 0.55)
  const widthCells = Math.ceil(advance) + pad * 2
  const heightCells = ascent + descent
  const canvas = document.createElement('canvas')
  canvas.width = widthCells * SUBSAMPLE
  canvas.height = heightCells * SUBSAMPLE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.font = measure.font
  context.fillStyle = '#fff'
  context.textBaseline = 'alphabetic'
  context.fillText(character, pad * SUBSAMPLE, ascent * SUBSAMPLE)

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const columns = []
  const area = SUBSAMPLE * SUBSAMPLE

  for (let cx = 0; cx < widthCells; cx += 1) {
    const column = []
    for (let cy = 0; cy < heightCells; cy += 1) {
      let covered = 0
      for (let sy = 0; sy < SUBSAMPLE; sy += 1) {
        const offset = ((cy * SUBSAMPLE + sy) * canvas.width + cx * SUBSAMPLE) * 4
        for (let sx = 0; sx < SUBSAMPLE; sx += 1) {
          covered += pixels[offset + sx * 4 + 3] / 255
        }
      }
      if (covered / area >= COVERAGE) column.push([cx - pad, cy - ascent])
    }
    if (column.length) columns.push(column)
  }

  const cells = columns.flatMap((column, index) =>
    index % 2 ? column.reverse() : column,
  )
  const glyph = { character, cells, advance }
  glyphCache.set(cacheKey, glyph)
  return glyph
}

function spaceAdvance(em) {
  return Math.max(em * 0.3, getMeasureContext(em).measureText(' ').width / SUBSAMPLE)
}

// Lay text out on the grid. Columns are relative to the text area's left
// edge; lines are counted from the text area's top. `x` keeps each letter's
// exact position so joined script letters meet; `col` and `end` are snapped
// to cells for the caret.
export function layoutText(text, geometry) {
  const { em, textCols } = geometry
  const space = spaceAdvance(em)
  const characters = Array.from(text)
  const placed = []
  let line = 0
  let x = 0

  const advanceOf = (character) =>
    /\s/.test(character) ? space : getGlyph(character, em).advance

  let index = 0
  while (index < characters.length) {
    const character = characters[index]

    if (character === '\n') {
      placed.push({ index, character, x, col: Math.round(x), end: Math.round(x), line, glyph: null })
      line += 1
      x = 0
      index += 1
      continue
    }

    if (/\s/.test(character)) {
      placed.push({
        index,
        character,
        x,
        col: Math.round(x),
        end: Math.round(x + space),
        line,
        glyph: null,
      })
      x += space
      index += 1
      continue
    }

    let end = index
    let wordWidth = 0
    while (end < characters.length && !/\s/.test(characters[end])) {
      wordWidth += advanceOf(characters[end])
      end += 1
    }

    if (x > 0 && x + wordWidth > textCols) {
      line += 1
      x = 0
    }

    for (let cursor = index; cursor < end; cursor += 1) {
      const glyph = getGlyph(characters[cursor], em)
      if (x > 0 && x + glyph.advance > textCols) {
        line += 1
        x = 0
      }
      placed.push({
        index: cursor,
        character: characters[cursor],
        x,
        col: Math.round(x),
        end: Math.round(x + glyph.advance),
        line,
        glyph,
      })
      x += glyph.advance
    }
    index = end
  }

  return {
    characters: placed,
    lines: line + 1,
    endCaret: { col: Math.round(x), line },
    height: geometry.baselineOffset + line * geometry.lineHeight + Math.round(em * 0.6),
  }
}

// Grid position (col, line) of the insertion point before character `index`.
export function caretPosition(layout, index) {
  const at = layout.characters[index]
  return at ? { col: at.col, line: at.line } : layout.endCaret
}

// Which insertion point (character index) a click at text-area cell
// coordinates lands on, or null when the click is not on the writing.
export function caretIndexAt(layout, geometry, col, row) {
  const { lineHeight, baselineOffset, em } = geometry
  const line = Math.round((row - baselineOffset + em * 0.3) / lineHeight)
  const baseline = baselineOffset + line * lineHeight
  if (row < baseline - em * 0.8 || row > baseline + em * 0.35) return null

  const onLine = layout.characters.filter(
    (item) => item.line === line && item.character !== '\n',
  )
  if (!onLine.length) return null
  const first = onLine[0]
  const last = onLine.at(-1)
  if (col < first.col - 1.5 || col > last.end + 1.5) return null

  let best = first.index
  let bestDistance = Math.abs(col - first.col)
  for (const item of onLine) {
    const distance = Math.abs(col - item.end)
    if (distance < bestDistance) {
      best = item.index + 1
      bestDistance = distance
    }
  }
  return best
}

function makeCanvas(width, height, ratio) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const context = canvas.getContext('2d')
  context.scale(ratio, ratio)
  return { canvas, context }
}

// A seamless tile of plain-woven linen in device pixels. Threads are uneven
// in width and tone, with slubs along their length, as real linen is.
function makeLinenTile(ratio) {
  const size = Math.round(LINEN_TILE * ratio)
  const threads = Math.round(LINEN_TILE / LINEN_PITCH / 2) * 2

  // Uneven thread spacing that still wraps exactly round the tile.
  const spacing = (seed) => {
    const widths = Array.from(
      { length: threads },
      (_, i) => 0.7 + hash(i, seed) * 0.6 + (hash(seed, i) > 0.9 ? 0.4 : 0),
    )
    const total = widths.reduce((sum, width) => sum + width, 0)
    const index = new Int16Array(size)
    const along = new Float32Array(size)
    let edge = 0
    let k = 0
    for (let i = 0; i < threads; i += 1) {
      const width = (widths[i] / total) * size
      for (; k < size && k < edge + width; k += 1) {
        index[k] = i
        along[k] = (k + 0.5 - edge) / width
      }
      edge += width
    }
    for (; k < size; k += 1) {
      index[k] = threads - 1
      along[k] = 0.99
    }
    return { index, along }
  }
  const warp = spacing(3.7)
  const weft = spacing(8.1)
  const tone = (seed, i) =>
    0.9 + hash(i, seed) * 0.16 + (hash(seed, i * 3) > 0.93 ? -0.07 : 0)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const image = context.createImageData(size, size)
  const data = image.data
  const slubs = 7

  for (let y = 0; y < size; y += 1) {
    const j = weft.index[y]
    const v = weft.along[y]
    for (let x = 0; x < size; x += 1) {
      const i = warp.index[x]
      const u = warp.along[x]
      const warpOnTop = (i + j) % 2 === 0
      // Slubs: each thread swells and thins along its length.
      const warpSlub = noise(i * 1.7 + 40, (y / size) * slubs)
      const weftSlub = noise(j * 1.3 + 80, (x / size) * slubs)
      const du = (Math.abs(u - 0.5) * 2) / (0.62 + warpSlub * 0.4)
      const dv = (Math.abs(v - 0.5) * 2) / (0.62 + weftSlub * 0.4)
      // Each thread is round, and darkens where it dives under the next.
      let lum = 0.5
      if (du <= 1 && (warpOnTop || dv > 1)) {
        const dip = warpOnTop ? 0.55 + 0.45 * Math.sin(Math.PI * v) : 0.6
        lum = (0.6 + 0.4 * Math.sqrt(1 - du * du) * dip) * tone(2.3, i) * (0.96 + warpSlub * 0.08)
      } else if (dv <= 1) {
        const dip = warpOnTop ? 0.6 : 0.55 + 0.45 * Math.sin(Math.PI * u)
        lum = (0.6 + 0.4 * Math.sqrt(1 - dv * dv) * dip) * tone(5.9, j) * (0.96 + weftSlub * 0.08)
      }
      const fleck = hash(x * 1.31 + 0.5, y * 0.73 + 0.25)
      const light = 0.62 + lum * 0.4 + (fleck - 0.5) * 0.05 + (fleck > 0.997 ? -0.18 : 0)
      const k = (x + y * size) * 4
      data[k] = Math.min(255, LINEN[0] * light)
      data[k + 1] = Math.min(255, LINEN[1] * light)
      data[k + 2] = Math.min(255, LINEN[2] * light * 0.99)
      data[k + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

// Satin-stitch one character. The letter's shape is filled with closely
// laid stitches at a slant, each round and catching the light in the
// middle, darker where it dips into the cloth at either end. Long runs are
// split into staggered stitches, as an embroiderer would. Returns a canvas
// in device pixels and the glyph origin within it in CSS pixels.
function satinSprite(character, size, ratio) {
  const font = `${STITCH_FONT_STYLE} ${size}px ${STITCH_FONT}`
  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  const metrics = measure.measureText(character)
  const pad = Math.ceil(size * 0.25)
  const ox = pad + Math.max(0, metrics.actualBoundingBoxLeft)
  const oy = pad + metrics.actualBoundingBoxAscent
  const width = ox + Math.max(1, metrics.actualBoundingBoxRight) + pad
  const height = oy + Math.max(0, metrics.actualBoundingBoxDescent) + pad
  const W = Math.ceil(width * ratio)
  const H = Math.ceil(height * ratio)

  const mask = document.createElement('canvas')
  mask.width = W
  mask.height = H
  const maskContext = mask.getContext('2d')
  maskContext.scale(ratio, ratio)
  maskContext.font = font
  maskContext.lineJoin = 'round'
  maskContext.fillText(character, ox, oy)
  maskContext.lineWidth = size * SATIN_WEIGHT
  maskContext.strokeText(character, ox, oy)

  // Turn the letter so its stitches lie level, then lay them row by row.
  const D = Math.ceil(Math.hypot(W, H)) + 2
  const turned = document.createElement('canvas')
  turned.width = D
  turned.height = D
  const turnedContext = turned.getContext('2d', { willReadFrequently: true })
  turnedContext.translate(D / 2, D / 2)
  turnedContext.rotate(-SATIN_ANGLE)
  turnedContext.drawImage(mask, -W / 2, -H / 2)
  const alpha = turnedContext.getImageData(0, 0, D, D).data
  const covered = (x, y) => alpha[(y * D + x) * 4 + 3] >= 110

  const stitches = document.createElement('canvas')
  stitches.width = D
  stitches.height = D
  const stitchContext = stitches.getContext('2d')
  const pitch = Math.max(2, 1.25 * ratio)
  const radius = pitch * 0.48
  const longest = size * ratio * 0.32
  const tip = 0.7 * ratio
  let row = 0
  for (let y = pitch / 2; y < D - 1; y += pitch, row += 1) {
    const yy = Math.round(y)
    let x = 0
    while (x < D) {
      while (x < D && !covered(x, yy)) x += 1
      if (x >= D) break
      const start = x
      while (x < D && covered(x, yy)) x += 1
      const length = x - start
      const pieces = Math.ceil(length / longest)
      const stagger = (row % 3) / 3
      const cuts = [start]
      for (let p = 1; p < pieces; p += 1) {
        cuts.push(start + length * ((p - 0.5 + stagger) / pieces))
      }
      cuts.push(x)
      for (let c = 0; c + 1 < cuts.length; c += 1) {
        const a = cuts[c]
        const b = cuts[c + 1]
        if (b - a < 0.5) continue
        const sheen = 0.85 + hash(row, a) * 0.3
        const light = FLOSS_LIGHT.map((value, k) => FLOSS[k] + (value - FLOSS[k]) * sheen)
        const shade = stitchContext.createLinearGradient(a, 0, b, 0)
        shade.addColorStop(0, rgb(FLOSS_DEEP))
        shade.addColorStop(Math.min(0.3, tip / (b - a)), rgb(FLOSS))
        shade.addColorStop(0.42, rgb(light))
        shade.addColorStop(Math.max(0.7, 1 - tip / (b - a)), rgb(FLOSS))
        shade.addColorStop(1, rgb(FLOSS_DEEP))
        stitchContext.fillStyle = shade
        stitchContext.beginPath()
        stitchContext.roundRect(a - 0.3, y - radius, b - a + 0.6, radius * 2, radius)
        stitchContext.fill()
        stitchContext.fillStyle = 'rgba(255, 200, 205, 0.12)'
        stitchContext.fillRect(a + 1, y - radius * 0.6, Math.max(0, b - a - 2), radius * 0.45)
      }
    }
  }

  const sprite = document.createElement('canvas')
  sprite.width = W
  sprite.height = H
  const context = sprite.getContext('2d')
  // The raised thread casts a soft shadow on the cloth.
  if ('filter' in context) context.filter = `blur(${ratio * 0.9}px)`
  context.globalAlpha = 0.45
  context.drawImage(mask, ratio * 0.6, ratio * 1.1)
  context.filter = 'none'
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = SHADOW
  context.fillRect(0, 0, W, H)
  context.globalCompositeOperation = 'source-over'
  context.translate(W / 2, H / 2)
  context.rotate(SATIN_ANGLE)
  context.drawImage(stitches, -D / 2, -D / 2)
  return { canvas: sprite, ox, oy, width, height }
}

// A cross stitch of two short satin bars, for the fairy dust.
function drawCross(context, x, y, size) {
  context.save()
  context.lineCap = 'round'
  for (const [dx, dy] of [[1, 1], [1, -1]]) {
    context.beginPath()
    context.moveTo(x - dx * size, y - dy * size)
    context.lineTo(x + dx * size, y + dy * size)
    context.strokeStyle = 'rgba(74, 54, 40, 0.3)'
    context.lineWidth = 2.1
    context.translate(0.5, 0.8)
    context.stroke()
    context.translate(-0.5, -0.8)
    context.strokeStyle = THREAD_DEEP
    context.lineWidth = 1.9
    context.stroke()
    context.strokeStyle = THREAD
    context.lineWidth = 1.3
    context.stroke()
    context.strokeStyle = rgb(FLOSS_LIGHT, 0.8)
    context.lineWidth = 0.5
    context.stroke()
  }
  context.restore()
}

// A French knot: a small round bead of wrapped thread.
function drawKnot(context, x, y, radius) {
  context.save()
  context.fillStyle = 'rgba(74, 54, 40, 0.3)'
  context.beginPath()
  context.arc(x + 0.5, y + 0.8, radius * 1.1, 0, Math.PI * 2)
  context.fill()
  const bead = context.createRadialGradient(
    x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius,
  )
  bead.addColorStop(0, rgb(FLOSS_LIGHT))
  bead.addColorStop(0.6, THREAD)
  bead.addColorStop(1, THREAD_DEEP)
  context.fillStyle = bead
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

// The seal over the writing: "type anything" stitched in the script, with
// fairy dust of cross stitches and French knots round about. Positions
// are in document cells; `size` scales the title against the writing.
const SEAL_TITLE = 'type anything'
const SEAL_SCALE = 0.8

function sealLayout(geometry) {
  const { seal, em } = geometry
  const scaled = em * SEAL_SCALE
  const space = spaceAdvance(scaled)
  const letters = []
  let width = 0
  for (const character of SEAL_TITLE) {
    if (/\s/.test(character)) {
      width += space
      continue
    }
    letters.push({ character, x: width })
    width += getGlyph(character, scaled).advance
  }
  const left = seal.centre - width / 2
  const baseline = seal.top + 15
  const dust = [
    [-1.12, -9], [-0.95, -12], [-0.62, -12], [-0.2, -13], [0.12, -12],
    [0.48, -13], [0.8, -11], [1.1, -8], [-1.2, 4], [-0.78, 9], [-0.05, 11],
    [0.42, 10], [0.9, 8], [1.24, 3],
  ].map(([across, down], index) => ({
    x: seal.centre + across * (width / 2 + 6),
    y: baseline + down,
    kind: index % 3 === 0 ? 'cross' : 'knot',
  }))
  return {
    letters: letters.map((letter) => ({ ...letter, x: left + letter.x })),
    baseline,
    size: SEAL_SCALE,
    dust,
  }
}

// Sample a cubic Bézier into points.
function bezierPoints(p0, p1, p2, p3, count) {
  const points = []
  for (let i = 0; i <= count; i += 1) {
    const t = i / count
    const u = 1 - t
    points.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return points
}

// Stroke a run of points as one round, plied strand with a cast shadow.
function drawStrand(context, points, width) {
  const trace = () => {
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) context.lineTo(point.x, point.y)
  }

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  // Shadow cast onto the cloth.
  context.translate(1.2, 1.8)
  trace()
  context.strokeStyle = 'rgba(74, 54, 40, 0.28)'
  context.lineWidth = width * 1.25
  context.stroke()
  context.translate(-1.2, -1.8)

  trace()
  context.strokeStyle = THREAD_DEEP
  context.lineWidth = width
  context.stroke()
  context.strokeStyle = THREAD
  context.lineWidth = width * 0.72
  context.stroke()
  context.translate(-width * 0.12, -width * 0.06)
  context.strokeStyle = rgb(FLOSS_LIGHT, 0.85)
  context.lineWidth = width * 0.22
  context.stroke()
  context.translate(width * 0.12, width * 0.06)

  // Ply twist along the strand.
  context.beginPath()
  let travelled = 0
  const step = width * 0.8
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segment = Math.hypot(dx, dy) || 1
    const ux = dx / segment
    const uy = dy / segment
    while (travelled < segment) {
      const cx = a.x + ux * travelled
      const cy = a.y + uy * travelled
      context.moveTo(cx - uy * width * 0.4 - ux * width * 0.32, cy + ux * width * 0.4 - uy * width * 0.32)
      context.lineTo(cx + uy * width * 0.4 + ux * width * 0.32, cy - ux * width * 0.4 + uy * width * 0.32)
      travelled += step
    }
    travelled -= segment
  }
  context.strokeStyle = TWIST
  context.lineWidth = Math.max(0.6, width * 0.2)
  context.stroke()
  context.restore()
}

function threadWidth(geometry) {
  return Math.max(1.6, geometry.cell * 0.5)
}

const lerp = (a, b, t) => a + (b - a) * t

// The thread is one continuous strand from the cloth to the hand off the
// edge of the piece. While stitching it runs taut up to the hand, and each
// stitch is drawn up out of the cloth and pulled tight while the hand
// circles for the next one. At rest the hand drops and the thread goes
// slack, draping down and away from the insertion point. `tension` moves
// smoothly between the two, so the thread never vanishes or pops.
function drawThread(context, origin, geometry, { stitch, progress, tension, swing, lift = 0 }) {
  const { cell } = geometry
  const width = threadWidth(geometry)
  const ease = tension * tension * (3 - 2 * tension)
  const count = 24

  // Taut, working.
  const turn = (stitch + progress) * Math.PI * 2
  const workAngle = -Math.PI * 0.36
  const tug = (1 - progress) ** 3 * 8
  const hand = {
    x: origin.x + Math.cos(workAngle) * (150 - tug) + Math.cos(turn) * 7,
    y: origin.y + Math.sin(workAngle) * (150 - tug) + Math.sin(turn) * 5,
  }
  const loop = Math.max(2.4, cell * 1.6) * (1 - progress * 0.8) * ease
  const loopTop = { x: origin.x + loop * 0.3, y: origin.y - loop * 1.8 }
  const sag = 10 + Math.sin(turn) * 3
  const taut = bezierPoints(
    loopTop,
    { x: lerp(loopTop.x, hand.x, 0.3), y: lerp(loopTop.y, hand.y, 0.3) + sag },
    { x: lerp(loopTop.x, hand.x, 0.7), y: lerp(loopTop.y, hand.y, 0.7) + sag * 0.6 },
    hand,
    count,
  )
  taut.push({ x: hand.x + Math.cos(workAngle) * 2400, y: hand.y + Math.sin(workAngle) * 2400 })

  // Resting: a short loose end hangs straight down from the cloth under
  // its own weight, swaying a little.
  // While unpicking, the same short end is lifted up and away from the
  // stitch it is pulling out.
  const hang = Math.max(56, geometry.em * cell * 0.65)
  const up = lift * lift * (3 - 2 * lift)
  const rest = {
    x: origin.x + cell * 1.5 + swing * cell * 2 + hang * 0.55 * up,
    y: origin.y + hang * (1 - 1.85 * up),
  }
  const slack = bezierPoints(
    origin,
    { x: origin.x + cell * 2.5 + hang * 0.1 * up, y: origin.y + hang * (0.25 - 0.55 * up) },
    { x: rest.x - swing * cell * 1.4 - hang * 0.15 * up, y: origin.y + hang * (0.65 - 1.35 * up) },
    rest,
    count,
  )
  slack.push({ x: rest.x, y: rest.y + 2400 * (1 - 2 * up) })

  const shape = slack.map((point, index) => ({
    x: lerp(point.x, taut[index].x, ease),
    y: lerp(point.y, taut[index].y, ease),
  }))
  // Where the thread leaves the cloth.
  shape.unshift({ ...origin })
  // Pulled taut, the thread pays out to its full length; let go, it
  // gathers back up into the short hanging end.
  const points = trimStrand(shape, lerp(hang, 3200, ease ** 8))

  if (loop > 0.4) {
    context.save()
    context.lineCap = 'round'
    context.beginPath()
    context.ellipse(origin.x, origin.y - loop * 0.9, loop * 0.7, loop, 0.25, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(74, 54, 40, 0.3)'
    context.lineWidth = width * 1.2
    context.stroke()
    context.strokeStyle = THREAD
    context.lineWidth = width * 0.8
    context.stroke()
    context.restore()
  }
  drawStrand(context, points, width)
  if (ease < 0.6) drawFray(context, points, width, 1 - ease / 0.6)
}

// Cut a run of points off after `length` pixels along it.
function trimStrand(points, length) {
  const trimmed = [points[0]]
  let travelled = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (travelled + segment >= length) {
      const t = segment ? (length - travelled) / segment : 0
      trimmed.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })
      return trimmed
    }
    travelled += segment
    trimmed.push(b)
  }
  return trimmed
}

// The cut end of the loose thread, its plies splayed apart.
function drawFray(context, points, width, amount) {
  const tail = points.at(-1)
  const before = points.at(-3) ?? points[0]
  const angle = Math.atan2(tail.y - before.y, tail.x - before.x)
  context.save()
  context.globalAlpha = amount
  context.lineCap = 'round'
  context.strokeStyle = THREAD
  context.lineWidth = Math.max(0.5, width * 0.28)
  for (const spread of [-0.45, 0.05, 0.5]) {
    context.beginPath()
    context.moveTo(tail.x, tail.y)
    context.quadraticCurveTo(
      tail.x + Math.cos(angle + spread * 0.5) * width * 1.6,
      tail.y + Math.sin(angle + spread * 0.5) * width * 1.6,
      tail.x + Math.cos(angle + spread) * width * 2.6,
      tail.y + Math.sin(angle + spread) * width * 2.6,
    )
    context.stroke()
  }
  context.restore()
}

export class EmbroideryRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.textKey = ''
    this.anchor = null
    this.lastFrame = 0
  }

  resize(width, height, geometry) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.ratio = ratio
    this.width = width
    this.height = height
    this.geometry = geometry
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    this.sprites = new Map()
    // The writing is painted for a band of rows taller than the viewport, so
    // scrolling slides the band and repaints only when it runs out.
    this.band = Math.max(24, Math.ceil(geometry.rows * 0.5))
    this.layerRows = geometry.rows + this.band + 2
    this.clothLayer = makeCanvas(width, height + LINEN_TILE, ratio)
    this.lightLayer = makeCanvas(width, height, ratio)
    this.textLayer = makeCanvas(width, this.layerRows * geometry.cell, ratio)
    this.bandStart = 0
    this.paintBase()
    this.textKey = ''
    this.anchor = null
  }

  // The fixed layers: the linen is one tall strip that slides as the page
  // scrolls, under a soft fall of light that stays put.
  paintBase() {
    const { width, height, ratio } = this
    const tile = makeLinenTile(ratio)
    const { canvas, context } = this.clothLayer
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = context.createPattern(tile, 'repeat')
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.restore()

    const light = this.lightLayer.context
    const glow = light.createRadialGradient(
      width * 0.45,
      height * 0.35,
      Math.min(width, height) * 0.1,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.8,
    )
    glow.addColorStop(0, 'rgba(255, 252, 245, 0.08)')
    glow.addColorStop(1, 'rgba(70, 52, 34, 0.16)')
    light.fillStyle = glow
    light.fillRect(0, 0, width, height)
  }

  // The satin-stitched letter for a character at a scale of the writing.
  sprite(character, scale = 1) {
    const key = `${scale}:${character}`
    let sprite = this.sprites.get(key)
    if (!sprite) {
      const { em, cell } = this.geometry
      sprite = satinSprite(character, em * cell * scale, this.ratio)
      this.sprites.set(key, sprite)
    }
    return sprite
  }

  // Draw a letter whose origin is at document cell (gx, baseline gy).
  drawLetter(context, character, gx, gy, scale = 1) {
    const { cell } = this.geometry
    const sprite = this.sprite(character, scale)
    context.drawImage(
      sprite.canvas,
      gx * cell - sprite.ox,
      gy * cell - sprite.oy,
      sprite.width,
      sprite.height,
    )
  }

  // Draw only the first `count` cells' worth of a letter, as far as it has
  // been stitched.
  drawPartial(context, item, baseRow, count) {
    const { cell } = this.geometry
    const { cells } = item.glyph
    const { gx: left, gy: top } = this.toGrid(item.x, baseRow)
    context.save()
    context.beginPath()
    for (let k = 0; k < count && k < cells.length; k += 1) {
      const [dx, dy] = cells[k]
      context.rect((left + dx - 0.6) * cell, (top + dy - 0.6) * cell, cell * 2.2, cell * 2.2)
    }
    context.clip()
    this.drawLetter(context, item.character, left, top)
    context.restore()
  }

  // Map a text cell to document grid coordinates.
  toGrid(col, row) {
    const { geometry } = this
    return { gx: geometry.textLeft + col, gy: geometry.textTop + row }
  }

  // Paint the writing and the seal for the rows of the current band.
  renderText(scene, animating) {
    const { geometry, bandStart, layerRows } = this
    const { context } = this.textLayer
    const { layout } = scene
    const { cell, em } = geometry
    context.clearRect(0, 0, this.width, layerRows * cell)
    const inBand = (gy) => gy >= -em && gy <= layerRows + em
    context.save()
    context.translate(0, -bandStart * cell)

    const { seal } = this
    if (inBand(seal.baseline - bandStart)) {
      for (const letter of seal.letters) {
        this.drawLetter(context, letter.character, letter.x, seal.baseline, seal.size)
      }
      for (const { x, y, kind } of seal.dust) {
        if (kind === 'cross') drawCross(context, x * cell, y * cell, cell * 0.55)
        else drawKnot(context, x * cell, y * cell, Math.max(1.3, cell * 0.38))
      }
    }

    for (const item of layout.characters) {
      if (!item.glyph || animating.has(item.index)) continue
      const { gx, gy } = this.toGrid(
        item.x,
        geometry.baselineOffset + item.line * geometry.lineHeight,
      )
      if (inBand(gy - bandStart)) this.drawLetter(context, item.character, gx, gy)
    }
    context.restore()
  }

  // Draw a deleted letter `pulled` of the way out. Pulling the loose end
  // undoes the last stitch worked first, so the letter unravels back the
  // way it was sewn.
  drawGhostAt(context, ghost, pulled) {
    const { geometry } = this
    const { item } = ghost
    const { cells } = item.glyph
    const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
    const remaining = Math.ceil(cells.length * (1 - pulled))
    if (remaining <= 0) return null
    this.drawPartial(context, item, baseRow, remaining)
    const [dx, dy] = cells[remaining - 1]
    const { gx, gy } = this.toGrid(item.x + dx, baseRow + dy)
    // The loose end leaves the cloth at the last stitch still in place.
    return this.cellCenter(gx, gy)
  }

  cellCenter(gx, gy) {
    const { cell } = this.geometry
    return { x: (gx + 0.5) * cell, y: (gy + 0.5) * cell }
  }

  draw(scene, now) {
    const { geometry, ratio, context } = this
    const { layout, births, placeholder, caret, reducedMotion } = scene
    const { cell, rows } = geometry
    if (scene.pieceGeometry.seal !== this.seal?.source) {
      this.seal = { ...sealLayout(scene.pieceGeometry), source: scene.pieceGeometry.seal }
    }

    // Follow the page scroll exactly, snapped to device pixels so the
    // writing, cloth and thread move as one.
    const scrollY = Math.round(clamp(scene.scrollY, 0, scene.maxScroll) * ratio) / ratio
    const scrollRow = Math.floor(scrollY / cell)
    if (scrollRow < this.bandStart || scrollRow + rows + 1 > this.bandStart + this.layerRows) {
      this.bandStart = Math.max(0, scrollRow - Math.floor(this.band / 2))
      this.textKey = ''
    }

    const animating = new Set()
    let active = null
    for (const item of layout.characters) {
      const birth = births[item.index]
      if (!item.glyph || birth === undefined) continue
      const duration = stitchDuration(item.glyph)
      if (now < birth + duration + CELL_FILL_MS) animating.add(item.index)
      if (now >= birth && now < birth + duration && (!active || birth >= active.birth)) {
        active = { item, birth, duration }
      }
    }

    const textKey = [
      layout.characters.map((item) => `${item.x},${item.line}`).join(';'),
      this.bandStart,
      placeholder,
      [...animating].join(','),
    ].join('|')
    if (textKey !== this.textKey) {
      this.renderText(scene, animating)
      this.textKey = textKey
    }

    const clothOffset = Math.round((scrollY % LINEN_TILE) * ratio)
    const textOffset = Math.round((scrollY - this.bandStart * cell) * ratio)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(this.clothLayer.canvas, 0, -clothOffset)
    context.drawImage(this.lightLayer.canvas, 0, 0)
    context.drawImage(this.textLayer.canvas, 0, -textOffset)
    // Everything below is drawn in document coordinates.
    context.setTransform(ratio, 0, 0, ratio, 0, -scrollY * ratio)

    // Letters being stitched fill in along the order they are worked.
    for (const item of layout.characters) {
      if (!animating.has(item.index)) continue
      const birth = births[item.index]
      const { cells } = item.glyph
      const duration = stitchDuration(item.glyph)
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      const done = Math.ceil(((now - birth + CELL_FILL_MS * 0.5) / duration) * cells.length)
      if (done > 0) this.drawPartial(context, item, baseRow, done)
    }

    // A deleted letter is pulled out like a single thread, last stitch
    // first, picking up speed as it goes.
    let pulling = null
    for (const ghost of scene.ghosts ?? []) {
      if (now >= ghost.end || now < ghost.start) {
        if (now < ghost.start) this.drawGhostAt(context, ghost, 0)
        continue
      }
      const t = clamp((now - ghost.start) / ghost.duration, 0, 1)
      const end = this.drawGhostAt(context, ghost, t * t)
      if (end) pulling = end
    }

    // The thread comes out of the stitch being worked, or rests at the
    // insertion point.
    let target
    let working = false
    let stitch = this.lastStitch ?? { index: 0, progress: 1 }
    if (active) {
      const { item, birth, duration } = active
      const { cells } = item.glyph
      const exact = ((now - birth) / duration) * cells.length
      const position = clamp(Math.floor(exact), 0, cells.length - 1)
      stitch = { index: item.index * 1000 + position, progress: clamp(exact - position, 0, 1) }
      this.lastStitch = { ...stitch, progress: 1 }
      const [dx, dy] = cells[position]
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      const { gx, gy } = this.toGrid(item.x + dx, baseRow + dy)
      target = this.cellCenter(gx, gy)
      working = true
    } else if (pulling) {
      // Unpicking: the short loose end lifts from the stitch being pulled.
      target = pulling
    } else {
      // At rest the thread stays where the last letter before the cursor
      // was finished: its final stitch. With nothing stitched just before
      // the cursor on this line, it waits at the cursor itself.
      const before = layout.characters[(scene.caretIndex ?? 0) - 1]
      if (before?.glyph && before.line === caret.line) {
        const [dx, dy] = before.glyph.cells.at(-1)
        const baseRow = geometry.baselineOffset + before.line * geometry.lineHeight
        const { gx, gy } = this.toGrid(before.x + dx, baseRow + dy)
        target = this.cellCenter(gx, gy)
      } else {
        const row = geometry.baselineOffset + caret.line * geometry.lineHeight - Math.round(geometry.em * 0.2)
        const { gx, gy } = this.toGrid(caret.col, row)
        target = this.cellCenter(gx, gy)
        target.x -= cell / 2
      }
    }

    const elapsed = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16
    this.lastFrame = now
    if (!this.anchor || reducedMotion) {
      this.anchor = { ...target, velocity: 0 }
    } else {
      const previousX = this.anchor.x
      const follow = 1 - Math.exp(-elapsed / (working || pulling ? 22 : 60))
      this.anchor.x += (target.x - this.anchor.x) * follow
      this.anchor.y += (target.y - this.anchor.y) * follow
      // Moving the thread sets it swinging; it settles back slowly.
      const moved = (this.anchor.x - previousX) / cell
      this.anchor.velocity = clamp(this.anchor.velocity * 0.9 - moved * 0.08, -0.8, 0.8)
    }

    // Ease between the taut working thread and the slack resting one. The
    // thread relaxes more slowly than it tightens, like letting go of yarn.
    const tensionTarget = working && !reducedMotion ? 1 : 0
    const settle = tensionTarget > (this.tension ?? 0) ? 90 : 300
    this.tension = reducedMotion
      ? tensionTarget
      : (this.tension ?? 0) + (tensionTarget - (this.tension ?? 0)) * (1 - Math.exp(-elapsed / settle))

    const idleSway = reducedMotion ? 0 : Math.sin(now / 1100) * 0.18
    const liftTarget = pulling && !reducedMotion ? 1 : 0
    this.lift = reducedMotion
      ? liftTarget
      : (this.lift ?? 0) +
        (liftTarget - (this.lift ?? 0)) * (1 - Math.exp(-elapsed / (liftTarget ? 50 : 220)))
    drawThread(context, this.anchor, geometry, {
      stitch: stitch.index,
      progress: stitch.progress,
      tension: this.tension,
      swing: idleSway + this.anchor.velocity,
      lift: this.lift,
    })
  }
}

export function stitchDuration(glyph) {
  return clamp(glyph.cells.length * 4, 280, 650)
}
