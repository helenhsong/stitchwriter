// Filet-lace engine: the whole viewport is a crocheted mesh of open cells,
// and text is "stitched" by filling cells solid, the way filet crochet
// pictures are worked.

import { CHARTED_SCRIPT, SPACE_ADVANCE } from './chartedScript.js'

export const STITCH_FONT = '"Playfair Display", Georgia, serif'
export const STITCH_FONT_STYLE = 'italic 400'
// Helen's Adobe Fonts kit. The typed writing is stitched in its typeface;
// if the kit can't load (offline, or a domain the kit doesn't allow), the
// writing falls back to the charted script.
const FONT_KIT = 'https://use.typekit.net/yso6mwu.css'

const familiesLoaded = () => new Set([...document.fonts].map((face) => face.family))

// Load the kit and return its typeface for stitching, or null.
export async function loadKitFace() {
  if (!document.fonts) return null
  const before = familiesLoaded()
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONT_KIT
  const loaded = new Promise((resolve) => {
    link.onload = () => resolve(true)
    link.onerror = () => resolve(false)
  })
  document.head.append(link)
  if (!(await loaded)) return null
  const added = [...document.fonts].filter((face) => !before.has(face.family))
  // The kit's typeface for the writing is Argent Pixel CF.
  const argent = added.filter((face) => /argent/i.test(face.family))
  const faces = argent.length ? argent : added
  // The lightest italic weight the kit offers (a variable face's weight
  // is a range; its low end is used), or the lightest of any if it has no
  // italic.
  const weightOf = (item) => (item.weight === 'normal' ? 400 : item.weight === 'bold' ? 700 : parseFloat(item.weight))
  const italic = faces.filter((item) => item.style !== 'normal')
  const face = (italic.length ? italic : faces).reduce(
    (lightest, item) => (!lightest || weightOf(item) < weightOf(lightest) ? item : lightest),
    null,
  )
  if (!face) return null
  const family = `"${face.family.replace(/^["']|["']$/g, '')}"`
  const style = `${face.style === 'normal' ? '' : `${face.style} `}${weightOf(face)}`
  try {
    const ready = await document.fonts.load(`${style} 72px ${family}`)
    if (!ready.length) return null
    // Outlines are rasterized as drawn, with no thickening, so the face
    // keeps the weight it has on Adobe's site.
    return { family, style, thicken: 0, ...findPixelGrid(family, style) }
  } catch {
    return null
  }
}

// A pixel face is drawn on a square grid of its own. Find how many of its
// pixels make one em and where that grid sits, so each of its pixels can be
// worked as whole stitches instead of being resampled across cell edges.
// Returns {} for a face that is not on a grid.
function findPixelGrid(family, style) {
  const size = 480
  const canvas = document.createElement('canvas')
  canvas.width = size * 6
  canvas.height = Math.ceil(size * 1.6)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const baseline = Math.round(size * 1.2)
  context.font = `${style} ${size}px ${family}`
  context.fillStyle = '#fff'
  context.fillText('HOMBgahxyz', 0, baseline)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const inked = (x, y) => data[(y * width + x) * 4 + 3] >= 128
  // Every place the ink starts or stops, across rows and down columns,
  // measured from the drawing origin and the baseline.
  const edges = { x: [], y: [] }
  for (let y = 0; y < height; y += 3) {
    for (let x = 1; x < width; x += 1) if (inked(x, y) !== inked(x - 1, y)) edges.x.push(x)
  }
  for (let x = 0; x < width; x += 3) {
    for (let y = 1; y < height; y += 1) if (inked(x, y) !== inked(x, y - 1)) edges.y.push(y - baseline)
  }
  if (edges.x.length < 40) return {}
  // How tightly the edges fall on a grid of this pitch, and its phase.
  const fit = (positions, pitch) => {
    let cos = 0
    let sin = 0
    for (const position of positions) {
      const angle = (2 * Math.PI * position) / pitch
      cos += Math.cos(angle)
      sin += Math.sin(angle)
    }
    // The nearest offset of the grid from the origin, in pitches.
    const phase = Math.atan2(sin, cos) / (2 * Math.PI)
    return { strength: Math.hypot(cos, sin) / positions.length, phase: phase - Math.round(phase) }
  }
  // The coarsest grid that every edge falls on; a finer one (a multiple of
  // it) fits too, a coarser one does not.
  for (let grid = 6; grid <= 48; grid += 1) {
    const pitch = size / grid
    const across = fit(edges.x, pitch)
    const down = fit(edges.y, pitch)
    if (across.strength > 0.9 && down.strength > 0.9) {
      return { grid, phase: { x: across.phase, y: down.phase } }
    }
  }
  return {}
}

// How many stitches across one pixel of a pixel face is worked at this em,
// or 0 to draw the face freely.
function gridScale(em, face) {
  if (!face?.grid || face.grid > em * 1.3) return 0
  return Math.max(1, Math.round(em / face.grid))
}

// The face's size in cells at this em.
function faceSize(em, face) {
  const scale = gridScale(em, face)
  return scale ? scale * face.grid : em
}

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
// The mesh is worked at one fixed gauge: each open hole is this many CSS
// pixels across.
const MESH_CELL = 2.25
// Letters are charted at this em; a larger em works each charted stitch
// as a square of cells.
const CHART_EM = 10
// Mesh thread width as a share of the filled blocks' thread.
const MESH_THREAD = 0.55

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function createGeometry(viewportWidth, viewportHeight, face) {
  const compact = viewportWidth < 560
  // A fine, tight mesh, the same at every window size.
  const cell = MESH_CELL
  // Letters are charted at one stitch per cell on phones and two on wider
  // screens; em sizes everything else (fallback punctuation, spacing, the
  // caret) to match them.
  // A pixel face can't be worked smaller than one stitch per pixel, so on
  // phones the writing grows to the face's own pixel size.
  const em = compact && face?.grid > CHART_EM * 1.3 ? face.grid : CHART_EM * (compact ? 1 : 2)
  const cols = Math.ceil(viewportWidth / cell)
  const rows = Math.ceil(viewportHeight / cell)
  // The seal: an embroidered title with fairy dust at the top
  // of the page, between the header links on wide screens. It is charted
  // one stitch per cell, smaller still on phones.
  const centre = Math.floor(Math.floor(viewportWidth / cell) / 2)
  const sealTop = Math.round((compact ? 114 : 80) / cell) - 14
  // Below the seal, open lace for the writing.
  const across = compact
    ? Math.floor(viewportWidth / cell) - Math.round(48 / cell)
    : Math.round(Math.min(viewportWidth * 0.56, 760) / cell)
  const inner = {
    left: centre - Math.floor(across / 2),
    right: centre - Math.floor(across / 2) + across - 1,
    top: Math.round((compact ? 180 : 188) / cell),
    bottom: Math.floor(viewportHeight / cell) - 1 - Math.round((compact ? 30 : 64) / cell),
  }
  // The writing area doubles as the piece's extent, which grows with it.
  const frame = { ...inner }
  return {
    cell,
    em,
    seal: { centre, top: sealTop, scale: compact ? 0.72 : 1 },
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
    ? `${face.style} ${faceSize(em, face) * SUBSAMPLE}px ${face.family}`
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

  // Letters come from the charted script alphabet, worked row by row. At a
  // larger em each charted stitch becomes a square of cells, keeping its
  // bottom edge on the baseline.
  const charted = !face && CHARTED_SCRIPT.get(character)
  if (charted) {
    const scale = Math.max(1, Math.round(em / CHART_EM))
    const rows = charted.rows
      .filter((row) => row.length)
      .flatMap((row) =>
        Array.from({ length: scale }, (_, j) =>
          row.flatMap(([x, y]) =>
            Array.from({ length: scale }, (_, i) => [x * scale + i, y * scale + j - (scale - 1)]),
          ),
        ),
      )
    const cells = rows.flatMap((row, index) => (index % 2 ? [...row].reverse() : row))
    const glyph = { cells, advance: charted.advance * scale, stitches: cells.length / scale ** 2 }
    glyphCache.set(cacheKey, glyph)
    return glyph
  }

  const measure = getMeasureContext(em, face)
  const scale = gridScale(em, face)
  const size = faceSize(em, face)
  // On a pixel face the advance is a whole number of its pixels.
  const rawAdvance = measure.measureText(character).width / SUBSAMPLE
  const advance = scale ? Math.round(rawAdvance / scale) * scale : rawAdvance
  const pad = Math.ceil(size * 0.5)
  const ascent = Math.ceil(size * 1.05)
  const descent = Math.ceil(size * 0.45)
  // Slide a pixel face so its pixel edges land on cell edges.
  const shift = scale
    ? {
        x: -Math.round(face.phase.x * scale * SUBSAMPLE),
        y: -Math.round(face.phase.y * scale * SUBSAMPLE),
      }
    : { x: 0, y: 0 }
  const widthCells = Math.ceil(advance) + pad * 2
  const heightCells = ascent + descent
  const canvas = document.createElement('canvas')
  canvas.width = widthCells * SUBSAMPLE
  canvas.height = heightCells * SUBSAMPLE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.font = measure.font
  context.fillStyle = '#fff'
  context.textBaseline = 'alphabetic'
  context.fillText(character, pad * SUBSAMPLE + shift.x, ascent * SUBSAMPLE + shift.y)
  // Thicken hairlines so thin serifs and joins survive at filet resolution.
  context.strokeStyle = '#fff'
  context.lineJoin = 'round'
  const thicken = face?.thicken ?? THICKEN
  context.lineWidth = SUBSAMPLE * thicken
  if (thicken > 0) {
    context.strokeText(character, pad * SUBSAMPLE + shift.x, ascent * SUBSAMPLE + shift.y)
  }

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
  const glyph = { cells, advance, stitches: cells.length * (CHART_EM / em) ** 2 }
  glyphCache.set(cacheKey, glyph)
  return glyph
}

// Lay text out on the grid. Columns are relative to the text area's left
// edge; lines are counted from the text area's top.
export function layoutText(text, geometry, face) {
  const { em, textCols } = geometry
  const spaceAdvance = face
    ? Math.max(2, Math.round(getMeasureContext(em, face).measureText(' ').width / SUBSAMPLE))
    : SPACE_ADVANCE * Math.max(1, Math.round(em / CHART_EM))
  const characters = Array.from(text)
  const placed = []
  let line = 0
  let x = 0

  const advanceOf = (character) =>
    /\s/.test(character) ? spaceAdvance : getGlyph(character, em, face).advance

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
      const glyph = getGlyph(characters[cursor], em, face)
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

// The seal over the writing: "type anything" stitched in the writing's
// typeface, with fairy dust scattered round about. It is worked one stitch
// per cell: a pixel face at its own pixel size, so each of its pixels is a
// stitch, anything else at the charted em.
function sealCells(geometry, face) {
  const { centre, top } = geometry.seal
  const em = face?.grid ? face.grid : CHART_EM
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
    /\s/.test(character) ? null : getGlyph(character, em, face),
  )
  const space = Math.round(em * (face?.grid ? 0.3 : 0.4))
  const width = glyphs.reduce((sum, glyph) => sum + (glyph ? glyph.advance : space), 0)
  const left = Math.round(centre - width / 2)
  // Keep the words centred where the charted script sat, however tall the
  // face is.
  const rows = glyphs.flatMap((glyph) => (glyph ? glyph.cells.map(([, dy]) => dy) : []))
  const inkTop = Math.min(...rows)
  const inkBottom = Math.max(...rows)
  const baseline = top + 13 - Math.round((inkTop + inkBottom) / 2)
  let x = left
  for (const glyph of glyphs) {
    if (!glyph) {
      x += space
      continue
    }
    for (const [dx, dy] of glyph.cells) mark(Math.round(x) + dx, baseline + dy)
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
    // Dust above the words keeps its distance from their tops, and dust
    // below from their bottoms (the charted script's run from -7 to 3).
    const dy = down < 0 ? baseline + inkTop + 7 + down : baseline + inkBottom - 3 + down
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

// Lift the stitching off the lace with a very faint shadow, down and to
// the right, as if the thread stands a little proud of the mesh.
function raise(layer, ratio) {
  const { canvas, context } = layer
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  copy.getContext('2d').drawImage(canvas, 0, 0)
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.shadowColor = 'rgba(0, 0, 0, 0.32)'
  context.shadowBlur = 1.5 * ratio
  context.shadowOffsetX = 0.6 * ratio
  context.shadowOffsetY = 1 * ratio
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

// Selected letters look worn loose: stray fibres curl out from the edges of
// their stitches, with a faint halo of fuzz. Built once per selection.
function frayPaths(layout, selection, geometry, toGrid) {
  const { cell, baselineOffset, lineHeight } = geometry
  const hairs = new Path2D()
  const fuzz = new Path2D()
  const halo = new Path2D()
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const hair = (x, y, angle, length, bend) => {
    hairs.moveTo(x, y)
    hairs.quadraticCurveTo(
      x + Math.cos(angle + bend) * length * 0.55,
      y + Math.sin(angle + bend) * length * 0.55,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    )
  }
  for (const item of layout.characters) {
    if (!item.glyph || item.index < selection.start || item.index >= selection.end) continue
    const baseRow = baselineOffset + item.line * lineHeight
    const cells = item.glyph.cells.map(([dx, dy]) => toGrid(item.col + dx, baseRow + dy))
    const filled = new Set(cells.map(({ gx, gy }) => `${gx},${gy}`))
    for (const { gx, gy } of cells) {
      fuzz.rect(gx * cell - cell * 0.35, gy * cell - cell * 0.35, cell * 1.7, cell * 1.7)
      halo.rect(gx * cell - cell * 0.9, gy * cell - cell * 0.9, cell * 2.8, cell * 2.8)
      // Loose fibres stand off every exposed edge of the stitching...
      sides.forEach(([sx, sy], side) => {
        if (filled.has(`${gx + sx},${gy + sy}`)) return
        for (let strand = 0; strand < 2; strand++) {
          const seed = side + strand * 4
          if (hash(gx * 3.1 + seed, gy * 1.7 - seed) > (strand ? 0.08 : 0.5)) continue
          const along = hash(gx + seed * 5.3, gy * 2.9)
          const x = (gx + 0.5 + sx * 0.5 + (sy ? along - 0.5 : 0)) * cell
          const y = (gy + 0.5 + sy * 0.5 + (sx ? along - 0.5 : 0)) * cell
          const angle = Math.atan2(sy, sx) + (hash(gy * 7.7, gx + seed) - 0.5) * 1.5
          const length = cell * (0.8 + hash(gx * 1.3, gy * 5.1 + seed) * 1.6)
          hair(x, y, angle, length, (hash(seed * 9.1 + gx, gy) - 0.5) * 2)
        }
      })
      // ...and a few short ones lift off the face of the stitches.
      if (hash(gx * 0.7 + 11, gy * 1.9) < 0.06) {
        const angle = hash(gx * 4.3, gy * 0.9 + 3) * Math.PI * 2
        hair((gx + 0.5) * cell, (gy + 0.5) * cell, angle, cell * (0.8 + hash(gy, gx * 2.2) * 0.9), 0.8)
      }
    }
  }
  return { hairs, fuzz, halo }
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
    const ornamentKey = `${pieceGeometry.frame.bottom}:${scene.face?.family ?? ''}:${scene.face?.style ?? ''}`
    if (ornamentKey !== this.ornamentKey) {
      this.ornaments = [
        ...sealCells(pieceGeometry, scene.face),
      ]
      this.ornamentKey = ornamentKey
    }
    // The seal is worked finer than the writing, one stitch per cell; on
    // phones its blocks are drawn smaller still, about its middle.
    const { centre, top, scale } = pieceGeometry.seal
    const middle = top + 14
    context.save()
    context.translate(centre * cell, (middle - bandStart) * cell)
    context.scale(scale, scale)
    context.translate(-centre * cell, -(middle - bandStart) * cell)
    for (const [x, y] of this.ornaments) {
      if (inBand(x, y - bandStart)) this.drawBlock(context, x, y - bandStart)
    }
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
    raise(this.textLayer, this.ratio)
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

    const layoutKey = layout.characters.map((item) => `${item.col},${item.line}`).join(';')
    const textKey = [
      layoutKey,
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
    context.globalAlpha = 1
    context.drawImage(this.velvetLayer.canvas, 0, 0)
    context.drawImage(this.meshLayer.canvas, 0, -meshOffset)

    // Under README the lace stays, but the stitching and thread fade away
    // so README reads clearly over plain lace, and fade back after.
    const sinceFade = this.lastFade ? Math.min(64, now - this.lastFade) : 16
    this.lastFade = now
    const shown = scene.hideWriting ? 0 : 1
    this.writing = reducedMotion || this.writing === undefined
      ? shown
      : this.writing + (shown - this.writing) * (1 - Math.exp(-sinceFade / 110))
    if (this.writing < 0.005) return
    context.globalAlpha = this.writing
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

    // Selected letters fray, easing in and out.
    const selection = scene.selection
    const frayKey = selection ? `${selection.start}:${selection.end}:${cell}:${layoutKey}` : ''
    if (frayKey && frayKey !== this.frayKey) {
      this.frayed = frayPaths(layout, selection, geometry, (col, row) => this.toGrid(col, row))
      this.frayKey = frayKey
    }
    const frayTarget = frayKey ? 1 : 0
    this.fray = reducedMotion
      ? frayTarget
      : (this.fray ?? 0) + (frayTarget - (this.fray ?? 0)) * (1 - Math.exp(-sinceFade / 90))
    if (this.frayed && this.fray > 0.01) {
      const { lineWidth } = geometry
      context.save()
      context.globalAlpha = this.writing * this.fray
      context.fillStyle = 'rgba(255, 255, 255, 0.03)'
      context.fill(this.frayed.halo)
      context.fillStyle = 'rgba(255, 255, 255, 0.05)'
      context.fill(this.frayed.fuzz)
      context.lineCap = 'round'
      context.strokeStyle = 'rgba(0, 0, 0, 0.45)'
      context.lineWidth = lineWidth * 0.9
      context.translate(0.4, 0.6)
      context.stroke(this.frayed.hairs)
      context.translate(-0.4, -0.6)
      context.strokeStyle = 'rgba(236, 236, 232, 0.85)'
      context.lineWidth = lineWidth * 0.55
      context.stroke(this.frayed.hairs)
      context.restore()
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
  return clamp(glyph.stitches * 5, 280, 650)
}
