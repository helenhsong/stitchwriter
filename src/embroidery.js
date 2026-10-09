// Filet-lace engine: the whole viewport is a crocheted mesh of open cells,
// and text is "stitched" by filling cells solid, the way filet crochet
// pictures are worked.

import { CHARTED_SCRIPT, SPACE_ADVANCE } from './chartedScript.js'

export const STITCH_FONT = '"Playfair Display", Georgia, serif'
export const STITCH_FONT_STYLE = 'italic 400'
export const HEADER_HEIGHT = 66

const VELVET = '#0a0a0a'
const THREAD_DEEP = '#8e8d89'
const THREAD_SHADE = '#cfcecb'
const THREAD = '#f3f3f1'
const THREAD_LIGHT = '#fafaf9'
const THREAD_HIGHLIGHT = '#ffffff'
const TWIST = 'rgba(110, 110, 106, 0.26)'

const SUBSAMPLE = 8
const COVERAGE = 0.42
// How much hairlines are thickened before charting, in cells. Just enough
// that fine serifs and joins survive as single stitches.
const THICKEN = 0.2
const CELL_FILL_MS = 110
const BLOCK_VARIANTS = 6
// The mesh pattern repeats every this many rows, so the open lace can
// scroll smoothly with the page by sliding one painted strip.
const MESH_PERIOD = 16
// Mesh thread width as a share of the filled blocks' thread.
const MESH_THREAD = 0.55

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function createGeometry(viewportWidth, viewportHeight) {
  const compact = viewportWidth < 560
  // A fine mesh, like thread-weight filet lace: more, smaller cells.
  const cell = compact ? 3 : clamp(Math.round(viewportWidth / 480) + 1, 4, 5)
  // Letters are charted at one stitch per cell; em sizes everything else
  // (fallback punctuation, spacing, the caret) to match them.
  const em = 10
  const cols = Math.ceil(viewportWidth / cell)
  const rows = Math.ceil(viewportHeight / cell)
  const headerRows = Math.ceil(HEADER_HEIGHT / cell)
  // The seal: an embroidered title with fairy dust at the top
  // of the page, between the header buttons on wide screens.
  const centre = Math.floor(Math.floor(viewportWidth / cell) / 2)
  const sealTop = compact ? headerRows + 2 : 6
  const sealBottom = sealTop + 28
  // Below the seal, open lace for the writing.
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
    lineWidth: Math.max(0.8, cell * 0.22),
    lineHeight: Math.round(em * 1.4),
    baselineOffset: em,
    textLeft: inner.left,
    textCols: Math.max(10, inner.right - inner.left + 1),
    textTop: inner.top,
    visibleTextRows: Math.max(1, inner.bottom - inner.top + 1),
  }
}

const glyphCache = new Map()
let measureContext = null

function getMeasureContext(em, face) {
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  measureContext.font = face
    ? `${face.style} ${em * SUBSAMPLE}px ${face.family}`
    : `${STITCH_FONT_STYLE} ${em * SUBSAMPLE}px ${STITCH_FONT}`
  return measureContext
}

// Rasterize one character to filet cells. Cells are relative to the glyph's
// origin column and baseline row, and are ordered the way they are worked:
// row by row, turning back at the end of each row like crochet.
export function getGlyph(character, em, face) {
  const cacheKey = `${em}:${face?.family ?? ''}:${character}`
  const cached = glyphCache.get(cacheKey)
  if (cached) return cached

  // Letters come from the charted script alphabet, worked row by row.
  const charted = !face && CHARTED_SCRIPT.get(character)
  if (charted) {
    const cells = charted.rows
      .filter((row) => row.length)
      .flatMap((row, index) => (index % 2 ? [...row].reverse() : row))
    const glyph = { cells, advance: charted.advance }
    glyphCache.set(cacheKey, glyph)
    return glyph
  }

  const measure = getMeasureContext(em, face)
  const advance = measure.measureText(character).width / SUBSAMPLE
  const pad = Math.ceil(em * 0.5)
  const ascent = Math.ceil(em * 1.05)
  const descent = Math.ceil(em * 0.45)
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
  // Thicken hairlines so thin serifs and joins survive at filet resolution.
  context.strokeStyle = '#fff'
  context.lineJoin = 'round'
  context.lineWidth = SUBSAMPLE * (face?.thicken ?? THICKEN)
  context.strokeText(character, pad * SUBSAMPLE, ascent * SUBSAMPLE)

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const rowsOfCells = []
  const area = SUBSAMPLE * SUBSAMPLE

  for (let cy = 0; cy < heightCells; cy += 1) {
    const row = []
    for (let cx = 0; cx < widthCells; cx += 1) {
      let covered = 0
      for (let sy = 0; sy < SUBSAMPLE; sy += 1) {
        const offset = ((cy * SUBSAMPLE + sy) * canvas.width + cx * SUBSAMPLE) * 4
        for (let sx = 0; sx < SUBSAMPLE; sx += 1) {
          covered += pixels[offset + sx * 4 + 3] / 255
        }
      }
      if (covered / area >= COVERAGE) row.push([cx - pad, cy - ascent])
    }
    if (row.length) rowsOfCells.push(row)
  }

  const cells = rowsOfCells.flatMap((row, index) =>
    index % 2 ? row.reverse() : row,
  )
  const glyph = { cells, advance }
  glyphCache.set(cacheKey, glyph)
  return glyph
}

// Lay text out on the grid. Columns are relative to the text area's left
// edge; lines are counted from the text area's top.
export function layoutText(text, geometry) {
  const { em, textCols } = geometry
  const spaceAdvance = SPACE_ADVANCE
  const characters = Array.from(text)
  const placed = []
  let line = 0
  let x = 0

  const advanceOf = (character) =>
    /\s/.test(character) ? spaceAdvance : getGlyph(character, em).advance

  let index = 0
  while (index < characters.length) {
    const character = characters[index]

    if (character === '\n') {
      placed.push({ index, character, col: Math.round(x), end: Math.round(x), line, glyph: null })
      line += 1
      x = 0
      index += 1
      continue
    }

    if (/\s/.test(character)) {
      placed.push({
        index,
        character,
        col: Math.round(x),
        end: Math.round(x + spaceAdvance),
        line,
        glyph: null,
      })
      x += spaceAdvance
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
    height: geometry.baselineOffset + line * geometry.lineHeight + Math.round(em * 0.5),
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
  const line = Math.round((row - baselineOffset + em * 0.35) / lineHeight)
  const baseline = baselineOffset + line * lineHeight
  if (row < baseline - em * 1.0 || row > baseline + em * 0.4) return null

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

// A dark velvet ground: fine speckled pile with a soft vignette.
function paintVelvet(context, width, height) {
  context.fillStyle = VELVET
  context.fillRect(0, 0, width, height)

  const tile = document.createElement('canvas')
  tile.width = 96
  tile.height = 96
  const tileContext = tile.getContext('2d')
  const image = tileContext.createImageData(96, 96)
  for (let i = 0; i < image.data.length; i += 4) {
    const pixel = i / 4
    const shade = hash(pixel % 96, Math.floor(pixel / 96))
    image.data[i] = 36
    image.data[i + 1] = 36
    image.data[i + 2] = 36
    image.data[i + 3] = shade > 0.55 ? Math.round((shade - 0.55) * 70) : 0
  }
  tileContext.putImageData(image, 0, 0)
  context.fillStyle = context.createPattern(tile, 'repeat')
  context.fillRect(0, 0, width, height)

  const vignette = context.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  )
  vignette.addColorStop(0, 'rgba(30, 30, 30, 0.3)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)
}

// Jittered mesh vertex: hand-worked mesh is never perfectly square.
function vertex(geometry, i, j) {
  const { cell, lineWidth } = geometry
  const wobble = cell * 0.07
  return {
    x: i * cell + lineWidth / 2 + (hash(i, j % MESH_PERIOD) - 0.5) * wobble,
    y: j * cell + lineWidth / 2 + (hash((j % MESH_PERIOD) + 91, i) - 0.5) * wobble,
  }
}

// Stroke one batch of thread segments as a round, plied strand.
function strokeStrand(context, segments, width, tone) {
  const path = new Path2D()
  for (const [a, b] of segments) {
    path.moveTo(a.x, a.y)
    path.lineTo(b.x, b.y)
  }

  context.lineCap = 'round'
  context.save()
  context.translate(0.5, 0.9)
  context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  context.lineWidth = width * 1.15
  context.stroke(path)
  context.restore()

  context.strokeStyle = THREAD_DEEP
  context.lineWidth = width
  context.stroke(path)
  context.save()
  context.translate(-width * 0.06, -width * 0.06)
  context.strokeStyle = tone
  context.lineWidth = width * 0.8
  context.stroke(path)
  context.translate(-width * 0.1, -width * 0.1)
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  context.lineWidth = width * 0.22
  context.stroke(path)
  context.restore()
}

// Diagonal twist marks across each segment, so the strand reads as plied.
function strokeTwist(context, segments, width) {
  const path = new Path2D()
  const step = Math.max(1.6, width * 0.95)
  for (const [a, b] of segments) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    const ux = dx / length
    const uy = dy / length
    const nx = -uy
    const ny = ux
    for (let t = step * 0.6; t < length; t += step) {
      const cx = a.x + ux * t
      const cy = a.y + uy * t
      path.moveTo(cx - nx * width * 0.42 - ux * width * 0.3, cy - ny * width * 0.42 - uy * width * 0.3)
      path.lineTo(cx + nx * width * 0.42 + ux * width * 0.3, cy + ny * width * 0.42 + uy * width * 0.3)
    }
  }
  context.strokeStyle = TWIST
  context.lineWidth = Math.max(0.5, width * 0.22)
  context.lineCap = 'round'
  context.stroke(path)
}

function paintMesh(context, geometry) {
  const { cols, rows } = geometry
  // The open mesh is worked in a much finer, fainter thread than the
  // filled blocks, so stitched letters read clearly against it.
  const lineWidth = geometry.lineWidth * MESH_THREAD
  context.save()
  context.globalAlpha = 0.5
  const buckets = [[], [], []]
  const knots = []

  for (let j = 0; j <= rows; j += 1) {
    const jp = j % MESH_PERIOD
    for (let i = 0; i <= cols; i += 1) {
      const here = vertex(geometry, i, j)
      knots.push(here)
      if (i < cols) {
        buckets[Math.floor(hash(i * 3 + 1, jp) * 3)].push([here, vertex(geometry, i + 1, j)])
      }
      if (j < rows) {
        buckets[Math.floor(hash(i, jp * 3 + 2) * 3)].push([here, vertex(geometry, i, j + 1)])
      }
    }
  }

  // Open mesh is a little greyer than the solid blocks, as in real
  // filet lace, so the worked design stands out.
  const tones = ['#d8d8d5', '#e2e2df', '#cfcfcc']

  // A faint halo of loose fibre around every thread, as cotton lace has.
  const halo = new Path2D()
  for (const [a, b] of buckets.flat()) {
    halo.moveTo(a.x, a.y)
    halo.lineTo(b.x, b.y)
  }
  context.strokeStyle = 'rgba(255, 255, 255, 0.03)'
  context.lineWidth = lineWidth * 3.2
  context.lineCap = 'round'
  context.stroke(halo)

  buckets.forEach((segments, index) =>
    strokeStrand(context, segments, lineWidth, tones[index]),
  )
  if (lineWidth >= 1.4) strokeTwist(context, buckets.flat(), lineWidth)

  // Small knots where chains meet trebles.
  const knotPath = new Path2D()
  const knotHighlight = new Path2D()
  for (const point of knots) {
    knotPath.moveTo(point.x + lineWidth * 0.95, point.y)
    knotPath.arc(point.x, point.y, lineWidth * 0.95, 0, Math.PI * 2)
    knotHighlight.moveTo(point.x - lineWidth * 0.02, point.y - lineWidth * 0.2)
    knotHighlight.arc(point.x - lineWidth * 0.2, point.y - lineWidth * 0.2, lineWidth * 0.18, 0, Math.PI * 2)
  }
  context.fillStyle = '#c4c4c0'
  context.fill(knotPath)
  context.fillStyle = 'rgba(255, 255, 255, 0.5)'
  context.fill(knotHighlight)

  // Stray fibres.
  const fuzz = new Path2D()
  for (let j = 0; j < rows; j += 1) {
    const jp = j % MESH_PERIOD
    for (let i = 0; i < cols; i += 1) {
      if (hash(i * 7 + 3, jp * 5 + 1) > 0.18) continue
      const start = vertex(geometry, i, j)
      const along = hash(i, jp * 13) * geometry.cell
      const horizontal = hash(jp, i * 17) > 0.5
      const x = start.x + (horizontal ? along : 0)
      const y = start.y + (horizontal ? 0 : along)
      const angle = hash(i * 19, jp * 23) * Math.PI * 2
      const length = geometry.cell * (0.25 + hash(i * 29, jp) * 0.4)
      fuzz.moveTo(x, y)
      fuzz.quadraticCurveTo(
        x + Math.cos(angle + 0.8) * length * 0.6,
        y + Math.sin(angle + 0.8) * length * 0.6,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
      )
    }
  }
  context.strokeStyle = 'rgba(225, 225, 222, 0.12)'
  context.lineWidth = 0.45
  context.stroke(fuzz)
  context.restore()
}

// One filled filet block: three treble posts topped by a chain, with
// round shading and plied twist. A few variants keep it from tiling.
function makeBlockSprites(geometry, ratio) {
  const { cell, lineWidth } = geometry
  const size = cell + lineWidth
  const sprites = []

  for (let variant = 0; variant < BLOCK_VARIANTS; variant += 1) {
    const { canvas, context } = makeCanvas(size, size, ratio)
    const post = size / 3
    context.fillStyle = THREAD_SHADE
    context.fillRect(0, 0, size, size)

    for (let k = 0; k < 3; k += 1) {
      const x = k * post
      const shade = context.createLinearGradient(x, 0, x + post, 0)
      shade.addColorStop(0, '#e2e1de')
      shade.addColorStop(0.35, variant % 2 ? THREAD_LIGHT : THREAD)
      shade.addColorStop(0.55, THREAD_HIGHLIGHT)
      shade.addColorStop(1, '#dddcd8')
      context.fillStyle = shade
      context.fillRect(x + 0.25, 0, post - 0.5, size)
      if (k > 0) {
        context.fillStyle = 'rgba(40, 40, 38, 0.22)'
        context.fillRect(x - 0.2, lineWidth * 0.8, 0.45, size - lineWidth * 0.8)
      }

      context.strokeStyle = TWIST
      context.lineWidth = Math.max(0.5, post * 0.16)
      context.beginPath()
      const step = Math.max(1.5, post * 0.8)
      const phase = hash(variant, k) * step
      for (let y = -step + phase; y < size + step; y += step) {
        context.moveTo(x + post * 0.12, y + post * 0.45)
        context.lineTo(x + post * 0.88, y - post * 0.25)
      }
      context.stroke()
    }

    // Chain across the top edge.
    const chain = context.createLinearGradient(0, 0, 0, lineWidth)
    chain.addColorStop(0, THREAD_LIGHT)
    chain.addColorStop(1, THREAD_SHADE)
    context.fillStyle = chain
    context.fillRect(0, 0, size, lineWidth * 0.85)
    context.strokeStyle = TWIST
    context.lineWidth = Math.max(0.5, lineWidth * 0.2)
    context.beginPath()
    for (let x = hash(variant, 9) * 2; x < size; x += Math.max(1.6, lineWidth)) {
      context.moveTo(x, lineWidth * 0.1)
      context.lineTo(x + lineWidth * 0.5, lineWidth * 0.75)
    }
    context.stroke()

    sprites.push(canvas)
  }
  return sprites
}

// Hand-charted motifs, as on a cross-stitch sampler. X is a stitch.
function parseChart(rows) {
  const width = Math.max(...rows.map((row) => row.length))
  const cells = rows.flatMap((row, y) =>
    [...row].flatMap((mark, x) => (mark === 'X' ? [[x, y]] : [])),
  )
  return { width, height: rows.length, cells }
}

// Fairy dust: open diamonds of four stitches, little trios and lone
// stitches.
const DIAMOND = parseChart(['.X.', 'X.X', '.X.'])
const TRIO = parseChart(['X.X', '.X.'])

// The seal over the writing: "type anything" stitched in the charted
// script, with fairy dust scattered round about.
function sealCells(geometry) {
  const { seal, em } = geometry
  const { centre, top } = seal
  const seen = new Set()
  const cells = []
  const mark = (x, y) => {
    const gx = Math.round(x)
    const gy = Math.round(y)
    const key = `${gx},${gy}`
    if (seen.has(key)) return
    seen.add(key)
    cells.push([gx, gy])
  }
  const stamp = (chart, x, y) => {
    for (const [dx, dy] of chart.cells) mark(x + dx, y + dy)
  }
  const glyphs = Array.from('type anything').map((character) =>
    /\s/.test(character) ? null : getGlyph(character, em),
  )
  const space = 4
  const width = glyphs.reduce((sum, glyph) => sum + (glyph ? glyph.advance : space), 0)
  const left = Math.round(centre - width / 2)
  const baseline = top + 15
  let x = left
  for (const glyph of glyphs) {
    if (!glyph) {
      x += space
      continue
    }
    for (const [dx, dy] of glyph.cells) mark(x + dx, baseline + dy)
    x += glyph.advance
  }

  // Fairy dust drifting round the words.
  const dust = [
    [-1.12, -9], [-0.95, -12], [-0.62, -12], [-0.2, -13], [0.12, -12],
    [0.48, -13], [0.8, -11], [1.1, -8], [-1.2, 4], [-0.78, 9], [-0.05, 11],
    [0.42, 10], [0.9, 8], [1.24, 3],
  ]
  for (const [i, [across, down]] of dust.entries()) {
    const dx = centre + across * (width / 2 + 6)
    const dy = baseline + down
    if (i % 3 === 0) stamp(DIAMOND, dx - 1, dy - 1)
    else if (i % 5 === 1) stamp(TRIO, dx - 1, dy)
    else mark(dx, dy)
  }
  return cells
}

// Soften a finished layer slightly: lace thread is fuzzy, never crisp.
function soften(layer, amount) {
  const { canvas, context } = layer
  if (!('filter' in context)) return
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  copy.getContext('2d').drawImage(canvas, 0, 0)
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.filter = `blur(${amount}px)`
  context.drawImage(copy, 0, 0)
  context.restore()
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

  // Shadow cast onto the lace.
  context.translate(1.2, 1.8)
  trace()
  context.strokeStyle = 'rgba(0, 0, 0, 0.6)'
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
  context.strokeStyle = 'rgba(255, 255, 255, 0.75)'
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

// The thread is one continuous strand from the lace to the hand off the
// edge of the piece. While stitching it runs taut up to the hand, and each
// stitch is worked as a loop drawn up out of the mesh and pulled tight
// while the hand circles to wrap the yarn for the next one. At rest the
// hand drops and the thread goes slack, draping down and away from the
// insertion point. `tension` moves smoothly between the two, so the thread
// never vanishes or pops.
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

  // Resting: a short loose end hangs straight down from the lace under its
  // own weight, swaying a little.
  // While unpicking, the same short end is lifted up and away from the
  // stitch it is pulling out.
  const hang = Math.max(56, geometry.em * cell * 0.95)
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
  // Where the thread leaves the lace.
  shape.unshift({ ...origin })
  // Pulled taut, the thread pays out to its full length; let go, it
  // gathers back up into the short hanging end.
  const points = trimStrand(shape, lerp(hang, 3200, ease ** 8))

  if (loop > 0.4) {
    context.save()
    context.lineCap = 'round'
    context.beginPath()
    context.ellipse(origin.x, origin.y - loop * 0.9, loop * 0.7, loop, 0.25, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(0, 0, 0, 0.5)'
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

export class LaceRenderer {
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
    this.blocks = makeBlockSprites(geometry, ratio)
    // The writing is painted for a band of rows taller than the viewport, so
    // scrolling slides the band and repaints only when it runs out.
    this.band = Math.max(24, Math.ceil(geometry.rows * 0.5))
    this.layerRows = geometry.rows + this.band + 2
    this.velvetLayer = makeCanvas(width, height, ratio)
    this.meshLayer = makeCanvas(width, height + (MESH_PERIOD + 1) * geometry.cell, ratio)
    this.textLayer = makeCanvas(width, this.layerRows * geometry.cell, ratio)
    this.bandStart = 0
    this.ornamentKey = ''
    this.paintBase()
    this.textKey = ''
    this.anchor = null
  }

  drawBlock(context, gx, gy, progress = 1, seed = null) {
    const { cell, lineWidth } = this.geometry
    const variant = seed === null ? hash(gx * 5 + 2, gy * 3 + 7) : hash(seed * 5 + 2, 7)
    const sprite = this.blocks[Math.floor(variant * BLOCK_VARIANTS)]
    const x = gx * cell
    const y = gy * cell
    const size = cell + lineWidth
    if (progress >= 1) {
      context.drawImage(sprite, x, y, size, size)
      return
    }
    // Work the three trebles in turn, each growing up from the row below.
    const post = size / 3
    const scale = sprite.width / size
    for (let k = 0; k < 3; k += 1) {
      const amount = clamp(progress * 3 - k, 0, 1)
      if (amount <= 0) continue
      const height = size * amount
      context.drawImage(
        sprite,
        k * post * scale,
        (size - height) * scale,
        post * scale,
        height * scale,
        x + k * post,
        y + size - height,
        post,
        height,
      )
    }
  }

  // The fixed layers: the velvet ground stays put behind the lace, and the
  // open mesh is one repeating strip that slides as the page scrolls.
  paintBase() {
    const { geometry } = this
    paintVelvet(this.velvetLayer.context, this.width, this.height)
    paintMesh(this.meshLayer.context, {
      ...geometry,
      rows: geometry.rows + MESH_PERIOD + 1,
    })
    soften(this.meshLayer, this.ratio * 0.3)
  }

  // Map a text cell to document grid coordinates.
  toGrid(col, row) {
    const { geometry } = this
    return { gx: geometry.textLeft + col, gy: geometry.textTop + row }
  }

  // Paint the writing and its border for the rows of the current band.
  renderText(scene, animating) {
    const { geometry, bandStart, layerRows } = this
    const { context } = this.textLayer
    const { layout, pieceGeometry } = scene
    const { cell, cols } = geometry
    context.clearRect(0, 0, this.width, layerRows * cell)
    const inBand = (gx, gy) => gx >= -1 && gx <= cols && gy >= -1 && gy <= layerRows

    // The border and ornaments grow with the writing, so they live in
    // document space and scroll with it.
    const ornamentKey = `${pieceGeometry.frame.bottom}`
    if (ornamentKey !== this.ornamentKey) {
      this.ornaments = [
        ...sealCells(pieceGeometry),
      ]
      this.ornamentKey = ornamentKey
    }
    for (const [x, y] of this.ornaments) {
      if (inBand(x, y - bandStart)) this.drawBlock(context, x, y - bandStart)
    }

    for (const item of layout.characters) {
      if (!item.glyph || animating.has(item.index)) continue
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      for (const [dx, dy] of item.glyph.cells) {
        const { gx, gy: row } = this.toGrid(item.col + dx, baseRow + dy)
        const gy = row - bandStart
        if (inBand(gx, gy)) this.drawBlock(context, gx, gy)
      }
    }
    soften(this.textLayer, this.ratio * 0.3)
  }

  // Draw a deleted letter `pulled` of the way out. Pulling the loose end
  // undoes the last stitch worked first, so the run of stitches slides
  // back along its path toward the first one and out through that hole:
  // the letter empties from the bottom up.
  drawGhostAt(context, ghost, pulled, firstRow, lastRow) {
    const { geometry } = this
    const { item } = ghost
    const { cells } = item.glyph
    const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
    const shift = pulled * cells.length
    let end = null
    for (let k = cells.length - 1; k >= 0; k -= 1) {
      const at = k - shift
      if (at < 0) break
      const from = cells[Math.ceil(at)]
      const to = cells[Math.max(0, Math.ceil(at) - 1)]
      const f = Math.ceil(at) - at
      const { gx, gy } = this.toGrid(
        item.col + from[0] + (to[0] - from[0]) * f,
        baseRow + from[1] + (to[1] - from[1]) * f,
      )
      // The loose end leaves the lace at the last stitch still in place.
      end ??= this.cellCenter(gx, gy)
      if (gy >= firstRow && gy <= lastRow) this.drawBlock(context, gx, gy, 1, k)
    }
    return end
  }

  cellCenter(gx, gy) {
    const { cell, lineWidth } = this.geometry
    return {
      x: gx * cell + lineWidth + (cell - lineWidth) / 2,
      y: gy * cell + lineWidth + (cell - lineWidth) / 2,
    }
  }

  draw(scene, now) {
    const { geometry, ratio, context } = this
    const { layout, births, placeholder, caret, reducedMotion } = scene
    const { cell, rows } = geometry

    // Follow the page scroll exactly, snapped to device pixels so the
    // writing, mesh and thread move as one.
    const scrollY = Math.round(clamp(scene.scrollY, 0, scene.maxScroll) * ratio) / ratio
    const scrollRow = Math.floor(scrollY / cell)
    const firstRow = scrollRow - 1
    const lastRow = scrollRow + rows + 1
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
      layout.characters.map((item) => `${item.col},${item.line}`).join(';'),
      this.bandStart,
      placeholder,
      scene.pieceGeometry.frame.bottom,
      [...animating].join(','),
    ].join('|')
    if (textKey !== this.textKey) {
      this.renderText(scene, animating)
      this.textKey = textKey
    }

    const meshOffset = Math.round((scrollY % (MESH_PERIOD * cell)) * ratio)
    const textOffset = Math.round((scrollY - this.bandStart * cell) * ratio)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(this.velvetLayer.canvas, 0, 0)
    context.drawImage(this.meshLayer.canvas, 0, -meshOffset)
    context.drawImage(this.textLayer.canvas, 0, -textOffset)
    // Everything below is drawn in document coordinates.
    context.setTransform(ratio, 0, 0, ratio, 0, -scrollY * ratio)

    for (const item of layout.characters) {
      if (!animating.has(item.index)) continue
      const birth = births[item.index]
      const { cells } = item.glyph
      const duration = stitchDuration(item.glyph)
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      cells.forEach(([dx, dy], cellIndex) => {
        const start = birth + (cellIndex / cells.length) * duration
        const progress = clamp((now - start) / CELL_FILL_MS, 0, 1)
        if (progress <= 0) return
        const { gx, gy } = this.toGrid(item.col + dx, baseRow + dy)
        if (gy >= firstRow && gy <= lastRow) this.drawBlock(context, gx, gy, progress)
      })
    }

    // A deleted letter is pulled out like a single thread: the run of
    // stitches slides back along the path it was worked in and is drawn
    // out, last stitch first, picking up speed as it goes.
    let pulling = null
    for (const ghost of scene.ghosts ?? []) {
      if (now >= ghost.end || now < ghost.start) {
        if (now < ghost.start) this.drawGhostAt(context, ghost, 0, firstRow, lastRow)
        continue
      }
      const t = clamp((now - ghost.start) / ghost.duration, 0, 1)
      const end = this.drawGhostAt(context, ghost, t * t, firstRow, lastRow)
      if (end) pulling = end
    }

    // The thread comes out of the cell being worked, or rests at the
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
      const { gx, gy } = this.toGrid(item.col + dx, baseRow + dy)
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
        const { gx, gy } = this.toGrid(before.col + dx, baseRow + dy)
        target = this.cellCenter(gx, gy)
      } else {
        const row = geometry.baselineOffset + caret.line * geometry.lineHeight - Math.round(geometry.em * 0.28)
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
  return clamp(glyph.cells.length * 5, 280, 650)
}
