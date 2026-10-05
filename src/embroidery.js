// Filet-lace engine: the whole viewport is a crocheted mesh of open cells,
// and text is "stitched" by filling cells solid, the way filet crochet
// pictures are worked.

export const STITCH_FONT = '"Cormorant Garamond", Georgia, serif'
export const STITCH_FONT_STYLE = 'italic 600'
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
// The mesh pattern repeats every this many rows, so the open lace can
// scroll smoothly with the page by sliding one painted strip.
const MESH_PERIOD = 16

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
  const cell = compact ? 2.5 : clamp(Math.round(viewportWidth / 480), 3, 4)
  const em = compact ? 15 : 16
  const motif = compact ? 7 : 9
  const arch = compact ? 5 : 7
  const notch = compact ? 6 : 8
  const cols = Math.ceil(viewportWidth / cell)
  const rows = Math.ceil(viewportHeight / cell)
  const headerRows = Math.ceil(HEADER_HEIGHT / cell)
  // A small, dainty doily centred on a wide expanse of open lace.
  const across = compact
    ? Math.floor(viewportWidth / cell) - 40
    : Math.round(Math.min(viewportWidth * 0.5, 720) / cell)
  const side = Math.floor((Math.floor(viewportWidth / cell) - across) / 2)
  const frame = {
    left: side,
    right: side + across - 1,
    top: headerRows + Math.round(rows * (compact ? 0.06 : 0.12)),
    bottom: Math.floor(viewportHeight / cell) - 1 - Math.round(rows * (compact ? 0.1 : 0.14)),
  }
  // The border, by inset from the outline: a solid edge, a floral band of
  // vines, flowers and leaves, then a solid inner line.
  const band = compact
    ? { start: 2, end: 9, line: 11 }
    : { start: 2, end: 10, line: 12 }
  // The writing sits in the straight-sided middle of the piece, inside the
  // border and clear of the arches.
  const clear = band.line + 3
  const inner = {
    left: frame.left + clear,
    right: frame.right - clear,
    top: frame.top + arch + clear,
    bottom: frame.bottom - arch - clear,
  }
  const padX = compact ? 4 : 6
  const padY = compact ? 3 : 4

  return {
    cell,
    em,
    motif,
    arch,
    notch,
    band,
    cols,
    rows,
    frame,
    inner,
    lineWidth: Math.max(0.8, cell * 0.22),
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
  context.lineWidth = SUBSAMPLE * 0.35
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
  const { cols, rows, lineWidth } = geometry
  context.save()
  context.globalAlpha = 0.82
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
  context.strokeStyle = 'rgba(255, 255, 255, 0.06)'
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
  context.fillStyle = '#d6d6d3'
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

// The piece's outline, a cartouche: arched top and bottom edges, straight
// sides, and concave notches cut out of each corner.
function archOffset(geometry, x) {
  const { frame, arch } = geometry
  const middle = (frame.left + frame.right) / 2
  const half = (frame.right - frame.left) * 0.24
  const t = (x - middle) / half
  if (Math.abs(t) >= 1) return arch
  return arch * (1 - (Math.cos(Math.PI * t) + 1) / 2)
}

function outlineCorners(geometry) {
  const { frame, arch } = geometry
  return [
    [frame.left, frame.top + arch],
    [frame.right, frame.top + arch],
    [frame.left, frame.bottom - arch],
    [frame.right, frame.bottom - arch],
  ]
}

function insideOutline(geometry, x, y, inset) {
  const { frame, notch } = geometry
  if (x < frame.left + inset || x > frame.right - inset) return false
  const rise = archOffset(geometry, x)
  if (y < frame.top + rise + inset || y > frame.bottom - rise - inset) return false
  for (const [cx, cy] of outlineCorners(geometry)) {
    if (Math.hypot(x - cx, y - cy) < notch + inset) return false
  }
  return true
}

// Border cells in viewport-grid coordinates: a solid outer edge and inner
// line following the cartouche outline, with a dotted line of single
// blocks just inside the edge, as on a filet tablecloth.
function frameCells(geometry) {
  const { frame, band } = geometry
  const cells = []
  const ring = (x, y, from, to) =>
    insideOutline(geometry, x, y, from) && !insideOutline(geometry, x, y, to + 1)
  for (let y = frame.top; y <= frame.bottom; y += 1) {
    for (let x = frame.left; x <= frame.right; x += 1) {
      const edge = ring(x, y, 0, 0)
      const line = ring(x, y, band.line, band.line)
      const dots = ring(x, y, band.line + 2, band.line + 2) && (x + y) % 2 === 0
      if (edge || line || dots) cells.push([x, y])
    }
  }
  return cells
}

// Rasterize a small drawing (in cell units) to filet cells, the same way
// glyphs are charted.
function chart(width, height, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = width * SUBSAMPLE
  canvas.height = height * SUBSAMPLE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.scale(SUBSAMPLE, SUBSAMPLE)
  context.fillStyle = '#fff'
  context.strokeStyle = '#fff'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  draw(context)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const cells = []
  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      let covered = 0
      for (let sy = 0; sy < SUBSAMPLE; sy += 1) {
        const offset = ((cy * SUBSAMPLE + sy) * canvas.width + cx * SUBSAMPLE) * 4
        for (let sx = 0; sx < SUBSAMPLE; sx += 1) {
          covered += pixels[offset + sx * 4 + 3] / 255
        }
      }
      if (covered / (SUBSAMPLE * SUBSAMPLE) >= 0.45) cells.push([cx, cy])
    }
  }
  return cells
}

// Four-pointed sparkle with a ring of tiny stars, as in the moon piece.
function sparkle(size) {
  return chart(size, size, (context) => {
    const c = size / 2
    const long = size / 2
    const waist = size * 0.09
    context.beginPath()
    context.moveTo(c, c - long)
    context.lineTo(c + waist, c - waist)
    context.lineTo(c + long, c)
    context.lineTo(c + waist, c + waist)
    context.lineTo(c, c + long)
    context.lineTo(c - waist, c + waist)
    context.lineTo(c - long, c)
    context.lineTo(c - waist, c - waist)
    context.closePath()
    context.fill()
    context.fillRect(c - size * 0.38, c - size * 0.38, 1, 1)
    context.fillRect(c + size * 0.3, c - size * 0.38, 1, 1)
    context.fillRect(c - size * 0.38, c + size * 0.3, 1, 1)
    context.fillRect(c + size * 0.3, c + size * 0.3, 1, 1)
  })
}

// Four-leaf clover on a curved stem.
function clover(size) {
  return chart(size, size, (context) => {
    const c = size / 2
    const leaf = size * 0.2
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      context.beginPath()
      context.arc(c + dx * leaf * 0.95, c - size * 0.08 + dy * leaf * 0.95, leaf, 0, Math.PI * 2)
      context.fill()
    }
    context.lineWidth = Math.max(1, size * 0.09)
    context.beginPath()
    context.moveTo(c, c)
    context.quadraticCurveTo(c + size * 0.12, c + size * 0.3, c + size * 0.3, size - 0.6)
    context.stroke()
  })
}

// A ribbon bow, tied at the top of the piece.
function bow(width) {
  const height = Math.round(width * 0.45)
  return {
    width,
    height,
    cells: chart(width, height, (context) => {
      const c = width / 2
      context.lineWidth = Math.max(1.3, width * 0.055)
      for (const side of [-1, 1]) {
        context.save()
        context.translate(c + side * width * 0.24, height * 0.36)
        context.rotate(side * 0.38)
        context.beginPath()
        context.ellipse(0, 0, width * 0.2, height * 0.24, 0, 0, Math.PI * 2)
        context.stroke()
        context.restore()
        context.beginPath()
        context.moveTo(c, height * 0.45)
        context.quadraticCurveTo(
          c + side * width * 0.12,
          height * 0.7,
          c + side * width * 0.2,
          height - 1,
        )
        context.stroke()
      }
      context.beginPath()
      context.arc(c, height * 0.42, width * 0.05, 0, Math.PI * 2)
      context.fill()
    }),
  }
}

// A small rosette: a ring of petals around a solid centre.
function rosette(size) {
  return chart(size, size, (context) => {
    const c = size / 2
    context.beginPath()
    context.arc(c, c, size * 0.14, 0, Math.PI * 2)
    context.fill()
    for (let k = 0; k < 8; k += 1) {
      const angle = (k / 8) * Math.PI * 2
      context.beginPath()
      context.arc(c + Math.cos(angle) * size * 0.33, c + Math.sin(angle) * size * 0.33, size * 0.09, 0, Math.PI * 2)
      context.fill()
    }
  })
}

// Four round petals around an open eye, charted cell by cell.
const QUATREFOIL = [
  '.XX.XX.',
  'XXXXXXX',
  'XXX.XXX',
  '.X...X.',
  'XXX.XXX',
  'XXXXXXX',
  '.XX.XX.',
].flatMap((row, y) => [...row].flatMap((mark, x) => (mark === 'X' ? [[x, y]] : [])))

// A five-petalled flower with an open eye, as worked in filet roses.
function flower(size) {
  return chart(size, size, (context) => {
    const c = size / 2
    for (let k = 0; k < 5; k += 1) {
      const angle = (k / 5) * Math.PI * 2 - Math.PI / 2
      context.beginPath()
      context.ellipse(
        c + Math.cos(angle) * size * 0.25,
        c + Math.sin(angle) * size * 0.25,
        size * 0.22,
        size * 0.17,
        angle,
        0,
        Math.PI * 2,
      )
      context.fill()
    }
    context.beginPath()
    context.arc(c, c, size * 0.24, 0, Math.PI * 2)
    context.fill()
    context.globalCompositeOperation = 'destination-out'
    context.beginPath()
    context.arc(c, c, size * 0.1, 0, Math.PI * 2)
    context.fill()
    // Hairline gaps between the petals.
    context.lineWidth = Math.max(0.6, size * 0.06)
    for (let k = 0; k < 5; k += 1) {
      const angle = (k / 5) * Math.PI * 2 - Math.PI / 2 + Math.PI / 5
      context.beginPath()
      context.moveTo(c + Math.cos(angle) * size * 0.2, c + Math.sin(angle) * size * 0.2)
      context.lineTo(c + Math.cos(angle) * size * 0.5, c + Math.sin(angle) * size * 0.5)
      context.stroke()
    }
  })
}

// Three round leaves on a short stalk that points right.
function trefoil(size) {
  return chart(size, size, (context) => {
    const c = size / 2
    const r = size * 0.2
    for (const [dx, dy] of [[-0.22, 0], [0.05, -0.27], [0.05, 0.27]]) {
      context.beginPath()
      context.arc(c + dx * size, c + dy * size, r, 0, Math.PI * 2)
      context.fill()
    }
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(c, c)
    context.lineTo(size, c)
    context.stroke()
  })
}

// A pointed leaf lying at `angle`, with an open midrib when large enough.
function leaf(length, angle) {
  const size = Math.ceil(length) + 1
  return chart(size, size, (context) => {
    const c = size / 2
    context.translate(c, c)
    context.rotate(angle)
    const half = length / 2
    const width = length * 0.3
    context.beginPath()
    context.moveTo(-half, 0)
    context.quadraticCurveTo(0, -width * 1.6, half, 0)
    context.quadraticCurveTo(0, width * 1.6, -half, 0)
    context.fill()
    if (length >= 7) {
      context.globalCompositeOperation = 'destination-out'
      context.lineWidth = 0.7
      context.beginPath()
      context.moveTo(-half * 0.5, 0)
      context.lineTo(half * 0.55, 0)
      context.stroke()
    }
  })
}

// The floral band inside the border: a garland along each side, flowers
// strung on a stem with pairs of leaves between them, all running toward
// the middle of the side, and a larger flower spray at each corner.
// Everything is clipped to the band.
function bandCells(geometry) {
  const { frame, band, notch, arch } = geometry
  const width = band.end - band.start + 1
  const centre = band.start + (width - 1) / 2
  // Small bands use a charted quatrefoil, which reads better than a
  // rasterized flower at only a few cells across.
  const bloom = width - 2 < 9 ? 7 : width - 2
  const blossom = bloom === 7 ? QUATREFOIL : flower(bloom)
  const sprig = Math.max(5, Math.round(width * 0.75))
  const seen = new Set()
  const cells = []
  const add = (x, y) => {
    const key = `${x},${y}`
    if (seen.has(key)) return
    if (!insideOutline(geometry, x, y, band.start) || insideOutline(geometry, x, y, band.end + 1)) return
    seen.add(key)
    cells.push([x, y])
  }
  const stamp = (shape, size, x, y) => {
    const left = Math.round(x - (size - 1) / 2)
    const top = Math.round(y - (size - 1) / 2)
    for (const [dx, dy] of shape) add(left + dx, top + dy)
  }

  // Each side, in coordinates along it (u) and across the band (v, inward).
  const corner = notch + band.end + 2
  const sides = [
    { from: frame.left + corner, to: frame.right - corner, at: (u, v) => [u, frame.top + archOffset(geometry, u) + centre + v] },
    { from: frame.left + corner, to: frame.right - corner, at: (u, v) => [u, frame.bottom - archOffset(geometry, u) - centre - v] },
    { from: frame.top + arch + corner, to: frame.bottom - arch - corner, at: (u, v) => [frame.left + centre + v, u] },
    { from: frame.top + arch + corner, to: frame.bottom - arch - corner, at: (u, v) => [frame.right - centre - v, u] },
  ]
  const repeat = bloom + sprig * 2
  for (const side of sides) {
    const length = side.to - side.from
    if (length < repeat) continue
    // A whole number of repeats so each side ends tidily on a flower.
    const count = Math.max(1, Math.round(length / repeat))
    const step = length / count
    const middle = (side.from + side.to) / 2

    // The stem bows gently between flowers, first one way, then the other.
    const bend = width < 11 ? 0 : Math.max(1.5, width * 0.2)
    const wave = (u) => bend * Math.sin(((u - side.from) / step) * Math.PI)
    for (let u = side.from; u <= side.to; u += 0.25) {
      const [x, y] = side.at(u, wave(u))
      add(Math.round(x), Math.round(y))
    }
    for (let k = 0; k <= count; k += 1) {
      const u = side.from + k * step
      const [x, y] = side.at(u, 0)
      stamp(blossom, bloom, x, y)
      if (k === count) break
      // A pair of leaves between flowers, pointing toward the middle.
      for (const offset of [0.5]) {
        const base = u + step * offset
        const heading = base < middle ? 1 : -1
        for (const outward of [-1, 1]) {
          const du = Math.cos(0.85) * heading
          const dv = Math.sin(0.85) * outward
          const v = wave(base)
          const [x0, y0] = side.at(base, v)
          const [x1, y1] = side.at(base + du, v + dv)
          const angle = Math.atan2(y1 - y0, x1 - x0)
          const [lx, ly] = side.at(base + du * sprig * 0.45, v + dv * sprig * 0.45)
          stamp(leaf(sprig, angle), sprig + 1, lx, ly)
        }
      }
    }
  }

  // A flower spray tucked into the band at each corner notch.
  const big = Math.max(9, bloom + 2)
  const rose = flower(big)
  for (const [cx, cy] of outlineCorners(geometry)) {
    const sx = cx < (frame.left + frame.right) / 2 ? 1 : -1
    const sy = cy < (frame.top + frame.bottom) / 2 ? 1 : -1
    const reach = notch + centre
    const fx = cx + sx * reach * 0.72
    const fy = cy + sy * reach * 0.72
    stamp(rose, big, fx, fy)
    // Two leaves, one reaching along each side of the band.
    for (const [dx, dy] of [[sx, 0], [0, sy]]) {
      const shape = leaf(sprig + 1, Math.atan2(dy, dx))
      stamp(shape, sprig + 2, fx + dx * big * 0.9, fy + dy * big * 0.9)
    }
  }
  return cells
}

// Ornament cells in viewport-grid coordinates.
function ornamentCells(geometry) {
  const { frame, motif, arch } = geometry
  const cells = []
  const place = (shape, size, cx, cy) => {
    const left = Math.round(cx - size / 2)
    const top = Math.round(cy - size / 2)
    for (const [x, y] of shape) cells.push([left + x, top + y])
  }

  // A motif sits in each corner notch, outside the border.
  const [topLeft, topRight, bottomLeft, bottomRight] = outlineCorners(geometry)
  const star = sparkle(motif)
  const leaf = clover(motif)
  place(star, motif, topLeft[0] + 1, topLeft[1] - 1)
  place(star, motif, topRight[0], topRight[1] - 1)
  place(leaf, motif, bottomLeft[0] + 1, bottomLeft[1] + 1)
  place(leaf.map(([x, y]) => [motif - 1 - x, y]), motif, bottomRight[0], bottomRight[1] + 1)

  // Small motifs nested in the top and bottom arches, inside the border.
  const middle = (frame.left + frame.right) / 2
  const small = Math.max(5, arch - 2)
  const below = geometry.band.line + 5
  place(sparkle(small), small, middle, frame.top + below + small / 2)
  place(rosette(small + 1), small + 1, middle, frame.bottom - below - (small + 1) / 2)

  // A ribbon bow tied over the top arch.
  const ribbon = bow(motif * 3 + 4)
  for (const [x, y] of ribbon.cells) {
    cells.push([
      Math.round(middle - ribbon.width / 2) + x,
      frame.top - Math.round(ribbon.height * 0.5) + y,
    ])
  }
  return cells
}

// Picot loops all around the outside of the border: the scalloped edge
// that finishes a piece of lace.
function paintPicots(context, geometry) {
  const { frame, cell, lineWidth, notch } = geometry
  const radius = cell * 0.95
  const path = new Path2D()
  const loop = (gx, gy, angle) => {
    const x = gx * cell + lineWidth / 2
    const y = gy * cell + lineWidth / 2
    path.moveTo(x + Math.cos(angle - Math.PI / 2) * radius, y + Math.sin(angle - Math.PI / 2) * radius)
    path.arc(x, y, radius, angle - Math.PI / 2, angle + Math.PI / 2)
  }
  const corners = outlineCorners(geometry)
  const clearOfNotches = (x, y) =>
    corners.every(([cx, cy]) => Math.hypot(x - cx, y - cy) > notch + 1)

  // Top and bottom edges follow the arches.
  for (let x = frame.left + 1; x <= frame.right; x += 2) {
    const rise = archOffset(geometry, x)
    const slope = (archOffset(geometry, x + 0.5) - archOffset(geometry, x - 0.5))
    const top = frame.top + rise
    const bottom = frame.bottom + 1 - rise
    if (clearOfNotches(x, top)) loop(x, top, -Math.PI / 2 + Math.atan(slope))
    if (clearOfNotches(x, bottom)) loop(x, bottom, Math.PI / 2 + Math.atan(slope))
  }
  for (let y = frame.top + 1; y <= frame.bottom; y += 2) {
    if (clearOfNotches(frame.left, y)) loop(frame.left, y, Math.PI)
    if (clearOfNotches(frame.right + 1, y)) loop(frame.right + 1, y, 0)
  }
  // Around each notch, pointing into it.
  for (const [cx, cy] of corners) {
    const steps = Math.round((notch * Math.PI) / 2 / 2)
    for (let k = 0; k <= steps; k += 1) {
      const angle = (k / steps) * Math.PI * 2
      const x = cx + Math.cos(angle) * notch
      const y = cy + Math.sin(angle) * notch
      if (insideOutline(geometry, Math.round(x + Math.cos(angle) * 1.5), Math.round(y + Math.sin(angle) * 1.5), 0)) {
        loop(x, y, angle + Math.PI)
      }
    }
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
function drawThread(context, origin, geometry, { stitch, progress, tension, swing }) {
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
  const hang = Math.max(56, geometry.em * cell * 0.95)
  const rest = { x: origin.x + cell * 1.5 + swing * cell * 2, y: origin.y + hang }
  const slack = bezierPoints(
    origin,
    { x: origin.x + cell * 2.5, y: origin.y + hang * 0.25 },
    { x: rest.x - swing * cell * 1.4, y: origin.y + hang * 0.65 },
    rest,
    count,
  )
  slack.push({ x: rest.x, y: rest.y + 2400 })

  const shape = slack.map((point, index) => ({
    x: lerp(point.x, taut[index].x, ease),
    y: lerp(point.y, taut[index].y, ease),
  }))
  // Where the thread leaves the lace.
  shape.unshift({ ...origin })
  // Pulled taut, the thread pays out to its full length; let go, it
  // gathers back up into the short hanging end.
  const points = trimStrand(shape, lerp(hang, 3200, ease * ease))

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

const HINT = 'just start typing'
const HINT_FONT = `${STITCH_FONT_STYLE} 19px ${STITCH_FONT}`

// The tiny hint shown before anything is written, centred in the piece,
// in document pixels.
function hintPlacement(context, geometry) {
  const { cell, inner } = geometry
  context.font = HINT_FONT
  const width = context.measureText(HINT).width
  return {
    x: ((inner.left + inner.right + 1) / 2) * cell - width / 2,
    y: ((inner.top + inner.bottom + 1) / 2) * cell + 5,
    width,
  }
}

const HINT_PULL_MS = 1100
const HINT_TAIL_MS = 450

// Draw the hint as fine white thread worked over the mesh. Once writing
// begins it is unpicked: the thread is pulled out from the first letter
// on, the stitches vanishing behind it while the loose, crimped strand is
// drawn up and away, until its tail slips free. Returns whether anything
// is still showing.
function drawHint(context, geometry, elapsed) {
  const { x, y, width } = hintPlacement(context, geometry)
  const pulling = elapsed !== null
  const t = pulling ? elapsed : 0
  const progress = pulling ? clamp(t / HINT_PULL_MS, 0, 1) ** 1.4 : 0
  const pullX = x + width * progress
  if (pulling && t > HINT_PULL_MS + HINT_TAIL_MS) return false

  context.save()
  context.font = HINT_FONT
  context.textBaseline = 'alphabetic'
  context.lineJoin = 'round'
  if (progress < 1) {
    context.save()
    if (pulling) {
      context.beginPath()
      context.rect(pullX, y - 40, width + 40, 80)
      context.clip()
    }
    context.strokeStyle = 'rgba(10, 10, 10, 0.85)'
    context.lineWidth = 3
    context.strokeText(HINT, x, y)
    context.fillStyle = THREAD
    context.fillText(HINT, x, y)
    context.restore()
  }

  if (pulling) {
    // The loose strand, crimped from having been stitched, straightening
    // toward the hand that pulls it.
    const hand = { x: pullX + 90 + 70 * progress, y: y - 170 - 50 * progress }
    const slip = clamp((t - HINT_PULL_MS) / HINT_TAIL_MS, 0, 1) ** 2
    const start = {
      x: lerp(pullX, hand.x, slip),
      y: lerp(y - 4, hand.y, slip),
    }
    const far = { x: hand.x + 400, y: hand.y - 900 }
    const dx = hand.x - start.x
    const dy = hand.y - start.y
    const length = Math.hypot(dx, dy) || 1
    const nx = -dy / length
    const ny = dx / length
    const points = []
    const count = 48
    for (let k = 0; k <= count; k += 1) {
      const u = k / count
      const crimp = Math.sin(k * 1.9 + t / 35) * 2.4 * (1 - u) ** 1.5
      points.push({
        x: start.x + dx * u + nx * crimp,
        y: start.y + dy * u + ny * crimp + Math.sin(u * Math.PI) * 18,
      })
    }
    points.push(far)
    const trace = () => {
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
    }
    context.lineCap = 'round'
    trace()
    context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    context.lineWidth = 2.6
    context.stroke()
    context.strokeStyle = THREAD
    context.lineWidth = 1.3
    context.stroke()
  }
  context.restore()
  return true
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
    this.holesLayer = makeCanvas(width, height, ratio)
    this.textLayer = makeCanvas(width, this.layerRows * geometry.cell, ratio)
    this.bandStart = 0
    this.ornamentKey = ''
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

  // The fixed layers: the velvet ground stays put behind the lace, the open
  // mesh is one repeating strip that slides as the page scrolls, and the
  // header links get holes cut in the lace above everything else.
  paintBase() {
    const { geometry } = this
    const { cell, lineWidth } = geometry
    paintVelvet(this.velvetLayer.context, this.width, this.height)
    paintMesh(this.meshLayer.context, {
      ...geometry,
      rows: geometry.rows + MESH_PERIOD + 1,
    })
    soften(this.meshLayer, this.ratio * 0.3)

    // Cut a hole in the lace under each header link, finished with a solid
    // edge, so the links stay legible on top of the fabric.
    const { context } = this.holesLayer
    const endSize = 6
    const endSprig = trefoil(endSize)
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
      // A little lace label: a solid edge, a dotted rule above and below,
      // a flower at each end, and picots hanging from the bottom.
      for (let y = hole.top - 1; y <= hole.bottom + 1; y += 1) {
        for (let x = hole.left - 1; x <= hole.right + 1; x += 1) {
          const outsideY = y < hole.top || y > hole.bottom
          const outsideX = x < hole.left || x > hole.right
          if (outsideX !== outsideY) this.drawBlock(context, x, y)
        }
      }
      for (let x = hole.left; x <= hole.right; x += 2) {
        this.drawBlock(context, x, hole.top - 3)
      }
      const top = Math.round((hole.top + hole.bottom) / 2 - (endSize - 1) / 2)
      for (const [x, y] of endSprig) {
        this.drawBlock(context, hole.left - 2 - endSize + x, top + y)
        this.drawBlock(context, hole.right + 2 + (endSize - 1 - x), top + y)
      }
      const radius = cell * 1.4
      const picots = new Path2D()
      for (let x = hole.left + 1; x <= hole.right; x += 3) {
        const px = x * cell + cell / 2
        const py = (hole.bottom + 2) * cell + lineWidth / 2
        picots.moveTo(px - radius, py)
        picots.arc(px, py, radius, Math.PI, 0, true)
      }
      context.save()
      context.lineCap = 'round'
      context.strokeStyle = THREAD_SHADE
      context.lineWidth = lineWidth * 1.5
      context.stroke(picots)
      context.strokeStyle = THREAD
      context.lineWidth = lineWidth
      context.stroke(picots)
      context.restore()
    }
    soften(this.holesLayer, this.ratio * 0.45)
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
        ...frameCells(pieceGeometry),
        ...bandCells(pieceGeometry),
        ...ornamentCells(pieceGeometry),
      ]
      this.ornamentKey = ornamentKey
    }
    for (const [x, y] of this.ornaments) {
      if (inBand(x, y - bandStart)) this.drawBlock(context, x, y - bandStart)
    }
    context.save()
    context.translate(0, -bandStart * cell)
    paintPicots(context, pieceGeometry)
    context.restore()

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

    // Before anything is written, a tiny hint; once writing begins, its
    // letters come loose and drop away.
    if (placeholder && !this.hintShedAt) {
      this.hintShown = true
      drawHint(context, scene.pieceGeometry, null)
    } else if (this.hintShown && !this.hintGone) {
      this.hintShedAt ??= now
      const showing = drawHint(context, scene.pieceGeometry, now - this.hintShedAt)
      if (!showing || reducedMotion) this.hintGone = true
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
    } else {
      const row = geometry.baselineOffset + caret.line * geometry.lineHeight - Math.round(geometry.em * 0.28)
      const { gx, gy } = this.toGrid(caret.col, row)
      target = this.cellCenter(gx, gy)
      target.x -= cell / 2
    }

    const elapsed = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16
    this.lastFrame = now
    if (!this.anchor || reducedMotion) {
      this.anchor = { ...target, velocity: 0 }
    } else {
      const previousX = this.anchor.x
      const follow = 1 - Math.exp(-elapsed / (working ? 22 : 60))
      this.anchor.x += (target.x - this.anchor.x) * follow
      this.anchor.y += (target.y - this.anchor.y) * follow
      // Moving the thread sets it swinging; it settles back slowly.
      const moved = (this.anchor.x - previousX) / cell
      this.anchor.velocity = clamp(this.anchor.velocity * 0.9 - moved * 0.08, -0.8, 0.8)
    }

    // Ease between the taut working thread and the slack resting one. The
    // thread relaxes more slowly than it tightens, like letting go of yarn.
    const tensionTarget = working && !reducedMotion ? 1 : 0
    const settle = tensionTarget > (this.tension ?? 0) ? 90 : 420
    this.tension = reducedMotion
      ? tensionTarget
      : (this.tension ?? 0) + (tensionTarget - (this.tension ?? 0)) * (1 - Math.exp(-elapsed / settle))

    const idleSway = reducedMotion ? 0 : Math.sin(now / 1100) * 0.18
    drawThread(context, this.anchor, geometry, {
      stitch: stitch.index,
      progress: stitch.progress,
      tension: this.tension,
      swing: idleSway + this.anchor.velocity,
    })
    this.drawHoles()
  }

  // The header links' holes sit above everything, thread included.
  drawHoles() {
    const { context, ratio } = this
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(this.holesLayer.canvas, 0, 0)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
}

export function stitchDuration(glyph) {
  return clamp(glyph.cells.length * 5, 280, 650)
}
