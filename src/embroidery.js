// Filet-lace engine: the whole viewport is a crocheted mesh of open cells,
// and text is "stitched" by filling cells solid, the way filet crochet
// pictures are worked.

export const STITCH_FONT = '"Cormorant Garamond", Georgia, serif'
export const STITCH_FONT_STYLE = 'italic 700'
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
const CELL_FILL_MS = 110
const BLOCK_VARIANTS = 6

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function createGeometry(viewportWidth, viewportHeight) {
  const compact = viewportWidth < 560
  const cell = compact ? 4.5 : clamp(Math.round(viewportWidth / 180), 6, 9)
  const em = compact ? 15 : 17
  const cols = Math.ceil(viewportWidth / cell)
  const rows = Math.ceil(viewportHeight / cell)
  const headerRows = Math.ceil(HEADER_HEIGHT / cell)
  const side = compact ? 2 : 4
  const frame = {
    left: side,
    right: Math.floor(viewportWidth / cell) - 1 - side,
    top: headerRows + 1,
    bottom: Math.floor(viewportHeight / cell) - 1 - (compact ? 3 : 4),
  }
  // Text lives inside the double border (2 solid + 1 open + 1 solid).
  const inner = {
    left: frame.left + 4,
    right: frame.right - 4,
    top: frame.top + 4,
    bottom: frame.bottom - 4,
  }
  const padX = compact ? 3 : 6
  const padY = compact ? 3 : 5

  return {
    cell,
    em,
    cols,
    rows,
    frame,
    inner,
    lineWidth: Math.max(1, cell * 0.15),
    lineHeight: Math.round(em * 1.3),
    baselineOffset: em,
    textLeft: inner.left + padX,
    textCols: Math.max(10, inner.right - inner.left + 1 - padX * 2),
    textTop: inner.top + padY,
    visibleTextRows: Math.max(1, inner.bottom - inner.top + 1 - padY * 2),
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

// Rasterize one character to filet cells. Cells are relative to the glyph's
// origin column and baseline row, and are ordered the way they are worked:
// row by row, turning back at the end of each row like crochet.
export function getGlyph(character, em) {
  const cacheKey = `${em}:${character}`
  const cached = glyphCache.get(cacheKey)
  if (cached) return cached

  const measure = getMeasureContext(em)
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
  context.lineWidth = SUBSAMPLE * 0.55
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
  const spaceAdvance = getGlyph(' ', em).advance
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
    x: i * cell + lineWidth / 2 + (hash(i, j) - 0.5) * wobble,
    y: j * cell + lineWidth / 2 + (hash(j + 91, i) - 0.5) * wobble,
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
  const { cols, rows, lineWidth } = geometry
  context.save()
  context.globalAlpha = 0.82
  const buckets = [[], [], []]
  const knots = []

  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const here = vertex(geometry, i, j)
      knots.push(here)
      if (i < cols) {
        buckets[Math.floor(hash(i * 3 + 1, j) * 3)].push([here, vertex(geometry, i + 1, j)])
      }
      if (j < rows) {
        buckets[Math.floor(hash(i, j * 3 + 2) * 3)].push([here, vertex(geometry, i, j + 1)])
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
  context.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  context.lineWidth = lineWidth * 3.2
  context.lineCap = 'round'
  context.stroke(halo)

  buckets.forEach((segments, index) =>
    strokeStrand(context, segments, lineWidth, tones[index]),
  )
  strokeTwist(context, buckets.flat(), lineWidth)

  // Small knots where chains meet trebles.
  const knotPath = new Path2D()
  const knotHighlight = new Path2D()
  for (const point of knots) {
    knotPath.moveTo(point.x + lineWidth * 0.95, point.y)
    knotPath.arc(point.x, point.y, lineWidth * 0.95, 0, Math.PI * 2)
    knotHighlight.moveTo(point.x - lineWidth * 0.02, point.y - lineWidth * 0.2)
    knotHighlight.arc(point.x - lineWidth * 0.2, point.y - lineWidth * 0.2, lineWidth * 0.18, 0, Math.PI * 2)
  }
  context.fillStyle = '#d6d6d3'
  context.fill(knotPath)
  context.fillStyle = 'rgba(255, 255, 255, 0.5)'
  context.fill(knotHighlight)

  // Stray fibres.
  const fuzz = new Path2D()
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      if (hash(i * 7 + 3, j * 5 + 1) > 0.18) continue
      const start = vertex(geometry, i, j)
      const along = hash(i, j * 13) * geometry.cell
      const horizontal = hash(j, i * 17) > 0.5
      const x = start.x + (horizontal ? along : 0)
      const y = start.y + (horizontal ? 0 : along)
      const angle = hash(i * 19, j * 23) * Math.PI * 2
      const length = geometry.cell * (0.25 + hash(i * 29, j) * 0.4)
      fuzz.moveTo(x, y)
      fuzz.quadraticCurveTo(
        x + Math.cos(angle + 0.8) * length * 0.6,
        y + Math.sin(angle + 0.8) * length * 0.6,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
      )
    }
  }
  context.strokeStyle = 'rgba(225, 225, 222, 0.22)'
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

// Border cells in viewport-grid coordinates: a double border with stepped
// corners, plus a small diamond motif at the middle of the top and bottom.
function frameCells(geometry) {
  const { frame } = geometry
  const cells = []
  const { left, right, top, bottom } = frame
  const notch = 3

  const push = (x, y) => cells.push([x, y])
  const ring = (inset, thickness) => {
    for (let t = 0; t < thickness; t += 1) {
      const l = left + inset + t
      const r = right - inset - t
      const tp = top + inset + t
      const b = bottom - inset - t
      for (let x = l; x <= r; x += 1) {
        push(x, tp)
        push(x, b)
      }
      for (let y = tp + 1; y < b; y += 1) {
        push(l, y)
        push(r, y)
      }
    }
  }

  ring(0, 2)
  ring(3, 1)

  const corners = [
    [left, top, -1, -1],
    [right, top, 1, -1],
    [left, bottom, -1, 1],
    [right, bottom, 1, 1],
  ]
  for (const [cx, cy, dx, dy] of corners) {
    for (let i = 1; i <= notch - 1; i += 1) {
      for (let j = 1; j <= notch - 1; j += 1) {
        if (i + j <= notch) push(cx + dx * i, cy + dy * j)
      }
    }
  }

  const diamond = (cx, cy) => {
    const shape = [
      [0, -2],
      [-1, -1],
      [1, -1],
      [-2, 0],
      [2, 0],
      [-1, 1],
      [1, 1],
      [0, 2],
    ]
    for (const [dx, dy] of shape) push(cx + dx, cy + dy)
  }
  const middle = Math.round((left + right) / 2)
  diamond(middle, top + 1)
  diamond(middle, bottom - 1)

  return cells
}

// Picot loops along the outside of the border: the scalloped edge that
// finishes a piece of lace.
function paintPicots(context, geometry) {
  const { frame, cell, lineWidth } = geometry
  const radius = cell * 0.95
  const path = new Path2D()
  const left = frame.left * cell
  const right = (frame.right + 1) * cell + lineWidth
  const top = frame.top * cell
  const bottom = (frame.bottom + 1) * cell + lineWidth
  const loop = (x, y, angle) => {
    path.moveTo(x + Math.cos(angle - Math.PI / 2) * radius, y + Math.sin(angle - Math.PI / 2) * radius)
    path.arc(x, y, radius, angle - Math.PI / 2, angle + Math.PI / 2)
  }
  for (let x = left + cell * 4; x <= right - cell * 4; x += cell * 2) {
    loop(x, top, -Math.PI / 2)
    loop(x, bottom, Math.PI / 2)
  }
  for (let y = top + cell * 4; y <= bottom - cell * 4; y += cell * 2) {
    loop(left, y, Math.PI)
    loop(right, y, 0)
  }

  context.save()
  context.lineCap = 'round'
  context.strokeStyle = THREAD_SHADE
  context.lineWidth = lineWidth * 1.5
  context.stroke(path)
  context.strokeStyle = THREAD
  context.lineWidth = lineWidth * 1.0
  context.stroke(path)
  context.restore()
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

function labelHoles(geometry) {
  const { cell } = geometry
  return Array.from(document.querySelectorAll('.ph-project-header a')).map(
    (link) => {
      const bounds = link.getBoundingClientRect()
      return {
        left: Math.floor((bounds.left - 6) / cell),
        right: Math.floor((bounds.right + 6) / cell),
        top: Math.floor((bounds.top - 3) / cell),
        bottom: Math.floor((bounds.bottom + 3) / cell),
      }
    },
  )
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

// The loose end of the working thread, coming out of the lace at the
// insertion point and hanging down under its own weight.
function drawThread(context, origin, geometry, swing) {
  const { cell } = geometry
  const width = Math.max(2.4, cell * 0.42)
  const length = Math.max(54, geometry.em * cell * 1.05)
  const end = {
    x: origin.x + cell * 1.6 + swing * cell * 1.4,
    y: origin.y + length,
  }
  const points = bezierPoints(
    origin,
    { x: origin.x + cell * 2.2, y: origin.y + length * 0.18 },
    { x: end.x - cell * 1.2 - swing * cell, y: origin.y + length * 0.62 },
    end,
    28,
  )

  const trace = () => {
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) context.lineTo(point.x, point.y)
  }

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  // Shadow cast onto the lace.
  context.translate(1.6, 2.4)
  trace()
  context.strokeStyle = 'rgba(0, 0, 0, 0.6)'
  context.lineWidth = width * 1.25
  context.stroke()
  context.translate(-1.6, -2.4)

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

  // Frayed tail: the plies splay apart at the cut end.
  const tail = points.at(-1)
  const before = points.at(-3)
  const angle = Math.atan2(tail.y - before.y, tail.x - before.x)
  context.strokeStyle = THREAD
  context.lineWidth = Math.max(0.6, width * 0.28)
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

  // Where the thread comes up through the lace.
  context.beginPath()
  context.arc(origin.x, origin.y, width * 0.55, 0, Math.PI * 2)
  context.fillStyle = THREAD_SHADE
  context.fill()
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
    this.meshLayer = makeCanvas(width, height, ratio)
    this.textLayer = makeCanvas(width, height, ratio)
    this.paintBase()
    this.textKey = ''
    this.anchor = null
  }

  drawBlock(context, gx, gy, progress = 1) {
    const { cell, lineWidth } = this.geometry
    const sprite = this.blocks[Math.floor(hash(gx * 5 + 2, gy * 3 + 7) * BLOCK_VARIANTS)]
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

  paintBase() {
    const { geometry } = this
    const { context } = this.meshLayer
    const { cell, lineWidth } = geometry
    paintVelvet(context, this.width, this.height)
    paintMesh(context, geometry)

    // Cut a hole in the lace under each header link, finished with a solid
    // edge, so the links stay legible on top of the fabric.
    for (const hole of labelHoles(geometry)) {
      context.save()
      context.beginPath()
      context.rect(
        hole.left * cell + lineWidth,
        hole.top * cell + lineWidth,
        (hole.right - hole.left + 1) * cell,
        (hole.bottom - hole.top + 1) * cell,
      )
      context.clip()
      paintVelvet(context, this.width, this.height)
      context.restore()
      for (let y = hole.top - 1; y <= hole.bottom + 1; y += 1) {
        for (let x = hole.left - 1; x <= hole.right + 1; x += 1) {
          const outsideY = y < hole.top || y > hole.bottom
          const outsideX = x < hole.left || x > hole.right
          if (outsideX !== outsideY) this.drawBlock(context, x, y)
        }
      }
    }

    for (const [x, y] of frameCells(geometry)) this.drawBlock(context, x, y)
    paintPicots(context, geometry)
    soften(this.meshLayer, this.ratio * 0.45)
  }

  // Map a text-area cell to viewport grid coordinates, or null if the
  // border clips it.
  toGrid(col, row, scrollRows) {
    const { geometry } = this
    const gx = geometry.textLeft + col
    const gy = geometry.textTop + row - scrollRows
    if (
      gx < geometry.inner.left ||
      gx > geometry.inner.right ||
      gy < geometry.inner.top ||
      gy > geometry.inner.bottom
    ) {
      return null
    }
    return { gx, gy }
  }

  renderText(scene, animating) {
    const { geometry } = this
    const { context } = this.textLayer
    const { layout, scrollRows, placeholder } = scene
    const { cell, lineWidth } = geometry
    context.clearRect(0, 0, this.width, this.height)

    for (const item of layout.characters) {
      if (!item.glyph || animating.has(item.index)) continue
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      for (const [dx, dy] of item.glyph.cells) {
        const point = this.toGrid(item.col + dx, baseRow + dy, scrollRows)
        if (!point) continue
        if (placeholder) {
          // Pattern-chart dots, as if the design were inked onto the lace.
          const dot = Math.max(1.5, cell * 0.36)
          context.fillStyle = 'rgba(240, 240, 238, 0.42)'
          context.beginPath()
          context.arc(
            point.gx * cell + lineWidth + (cell - lineWidth) / 2,
            point.gy * cell + lineWidth + (cell - lineWidth) / 2,
            dot / 2,
            0,
            Math.PI * 2,
          )
          context.fill()
        } else {
          this.drawBlock(context, point.gx, point.gy)
        }
      }
    }
    if (!placeholder) soften(this.textLayer, this.ratio * 0.35)
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
    const { layout, scrollRows, births, placeholder, caret, reducedMotion } = scene

    const animating = new Set()
    let active = null
    for (const item of layout.characters) {
      const birth = births[item.index]
      if (!item.glyph || placeholder || birth === undefined) continue
      const duration = stitchDuration(item.glyph)
      if (now < birth + duration + CELL_FILL_MS) animating.add(item.index)
      if (now >= birth && now < birth + duration && (!active || birth >= active.birth)) {
        active = { item, birth, duration }
      }
    }

    const textKey = [
      layout.characters.map((item) => `${item.col},${item.line}`).join(';'),
      scrollRows,
      placeholder,
      [...animating].join(','),
    ].join('|')
    if (textKey !== this.textKey) {
      this.renderText(scene, animating)
      this.textKey = textKey
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(this.meshLayer.canvas, 0, 0)
    context.drawImage(this.textLayer.canvas, 0, 0)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

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
        const point = this.toGrid(item.col + dx, baseRow + dy, scrollRows)
        if (point) this.drawBlock(context, point.gx, point.gy, progress)
      })
    }

    // The thread comes out of the cell being worked, or rests at the
    // insertion point.
    let target = null
    let working = false
    if (active) {
      const { item, birth, duration } = active
      const { cells } = item.glyph
      const position = clamp(Math.floor(((now - birth) / duration) * cells.length), 0, cells.length - 1)
      const [dx, dy] = cells[position]
      const baseRow = geometry.baselineOffset + item.line * geometry.lineHeight
      const point = this.toGrid(item.col + dx, baseRow + dy, scrollRows)
      if (point) {
        target = this.cellCenter(point.gx, point.gy)
        working = true
      }
    }
    if (!target) {
      const row = geometry.baselineOffset + caret.line * geometry.lineHeight - Math.round(geometry.em * 0.28)
      const point = this.toGrid(caret.col, row, scrollRows)
      if (point) {
        target = this.cellCenter(point.gx, point.gy)
        target.x -= geometry.cell / 2
      }
    }

    const elapsed = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16
    this.lastFrame = now
    if (!target) return
    if (!this.anchor || reducedMotion) {
      this.anchor = { ...target, velocity: 0 }
    } else {
      const previousX = this.anchor.x
      const follow = 1 - Math.exp(-elapsed / (working ? 22 : 60))
      this.anchor.x += (target.x - this.anchor.x) * follow
      this.anchor.y += (target.y - this.anchor.y) * follow
      // Moving the thread sets its tail swinging; it settles back slowly.
      const moved = (this.anchor.x - previousX) / geometry.cell
      this.anchor.velocity = clamp(this.anchor.velocity * 0.9 - moved * 0.08, -0.8, 0.8)
    }

    const idleSway = reducedMotion ? 0 : Math.sin(now / 1100) * 0.18
    drawThread(context, this.anchor, geometry, idleSway + this.anchor.velocity)
  }
}

export function stitchDuration(glyph) {
  return clamp(glyph.cells.length * 7, 220, 520)
}
