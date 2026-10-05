// Filet-lace engine: the whole viewport is a crocheted mesh of open cells,
// and text is "stitched" by filling cells solid, the way filet crochet
// pictures are worked.

export const STITCH_FONT = '"Cormorant Garamond", Georgia, serif'
export const STITCH_FONT_STYLE = 'italic 700'
export const HEADER_HEIGHT = 66

const BACKDROP = '#0c0b0a'
const THREAD = '#ebe4d4'
const THREAD_SHADE = '#b8ae9b'
const THREAD_HIGHLIGHT = '#fffaf0'

const SUBSAMPLE = 8
const COVERAGE = 0.42
const CELL_FILL_MS = 90

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function createGeometry(viewportWidth, viewportHeight) {
  const compact = viewportWidth < 560
  const cell = compact ? 4 : clamp(Math.round(viewportWidth / 180), 6, 9)
  const em = compact ? 18 : 17
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
    lineHeight: Math.round(em * 1.3),
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
// origin column and baseline row, and are ordered the way the needle works
// them: row by row, turning back at the end of each row like crochet.
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
// edge; rows are baseline rows relative to the text area's top.
export function layoutText(text, geometry) {
  const { em, lineHeight, textCols } = geometry
  const baselineOffset = Math.round(em * 1.0)
  const spaceAdvance = getGlyph(' ', em).advance
  const characters = Array.from(text)
  const placed = []
  let line = 0
  let x = 0

  const advanceOf = (character) =>
    character === ' ' ? spaceAdvance : getGlyph(character, em).advance

  let index = 0
  while (index < characters.length) {
    const character = characters[index]

    if (character === '\n') {
      placed.push({ index, character, col: Math.round(x), line, glyph: null })
      line += 1
      x = 0
      index += 1
      continue
    }

    if (character === ' ') {
      placed.push({ index, character, col: Math.round(x), line, glyph: null })
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
        line,
        glyph,
      })
      x += glyph.advance
    }
    index = end
  }

  const lastLine = line
  return {
    characters: placed,
    lines: lastLine + 1,
    baselineOffset,
    caret: {
      col: Math.min(Math.round(x) + 1, textCols),
      row: baselineOffset + lastLine * lineHeight - Math.round(em * 0.32),
      line: lastLine,
    },
    height: baselineOffset + lastLine * lineHeight + Math.round(em * 0.5),
  }
}

function makeMeshTile(cell, ratio) {
  const tileCells = 4
  const size = cell * tileCells
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size * ratio)
  canvas.height = Math.round(size * ratio)
  const context = canvas.getContext('2d')
  context.scale(ratio, ratio)
  context.fillStyle = BACKDROP
  context.fillRect(0, 0, size, size)

  const lineWidth = Math.max(1.3, cell * 0.24)

  for (let i = 0; i < tileCells; i += 1) {
    for (let j = 0; j < tileCells; j += 1) {
      const x = i * cell
      const y = j * cell
      const tone = 0.82 + hash(i, j) * 0.18
      context.globalAlpha = tone
      context.fillStyle = THREAD_SHADE
      context.fillRect(x, y, cell, lineWidth)
      context.fillRect(x, y, lineWidth, cell)
      context.fillStyle = THREAD
      context.fillRect(x, y, cell, lineWidth * 0.62)
      context.fillRect(x, y, lineWidth * 0.62, cell)
      // Twisted ply: tiny highlights along each thread.
      context.globalAlpha = 0.55 * tone
      context.fillStyle = THREAD_HIGHLIGHT
      for (let k = 1; k < cell; k += 2.5) {
        context.fillRect(x + k, y + lineWidth * 0.12, 0.9, lineWidth * 0.35)
        context.fillRect(x + lineWidth * 0.12, y + k, lineWidth * 0.35, 0.9)
      }
      // Knot where the threads cross.
      context.globalAlpha = tone
      context.fillStyle = THREAD
      context.fillRect(x - 0.3, y - 0.3, lineWidth + 0.6, lineWidth + 0.6)
    }
  }
  context.globalAlpha = 1
  return canvas
}

function drawFilledCell(context, x, y, cell, lineWidth, progress = 1) {
  const width = cell + lineWidth
  const bar = width / 3

  if (progress >= 1) {
    context.fillStyle = THREAD
    context.fillRect(x, y, width, width)
    context.fillStyle = 'rgba(120, 108, 88, 0.22)'
    context.fillRect(x + bar - 0.3, y, 0.6, width)
    context.fillRect(x + bar * 2 - 0.3, y, 0.6, width)
    context.fillStyle = 'rgba(255, 252, 244, 0.5)'
    context.fillRect(x + bar * 0.35, y, 0.7, width)
    context.fillRect(x + bar * 1.35, y, 0.7, width)
    return
  }

  // A filet block is worked as three trebles; grow each bar upward in turn.
  for (let k = 0; k < 3; k += 1) {
    const amount = clamp(progress * 3 - k, 0, 1)
    if (amount <= 0) continue
    const height = width * amount
    context.fillStyle = THREAD
    context.fillRect(x + bar * k, y + width - height, bar + 0.2, height)
    context.fillStyle = 'rgba(255, 252, 244, 0.5)'
    context.fillRect(x + bar * (k + 0.35), y + width - height, 0.7, height)
  }
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

  // Stepped corner blocks that sit outside the border, like the reference
  // pieces' notched corners.
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

function needleShape(tipX, tipY, cell) {
  const length = Math.max(48, cell * 9)
  const angle = -Math.PI * 0.32
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  return {
    tipX,
    tipY,
    eyeX: tipX + dx * length * 0.86,
    eyeY: tipY + dy * length * 0.86,
    endX: tipX + dx * length,
    endY: tipY + dy * length,
    dx,
    dy,
  }
}

function drawThread(context, from, to, sag, cell) {
  const width = Math.max(2, cell * 0.42)
  const midX = (from.x + to.x) / 2
  const c1x = from.x + (midX - from.x) * 0.6
  const c2x = to.x + (midX - to.x) * 0.6
  const lowest = Math.max(from.y, to.y) + sag

  context.save()
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.bezierCurveTo(c1x, lowest, c2x, lowest, to.x, to.y)
  context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  context.lineWidth = width + 2
  context.stroke()
  context.strokeStyle = THREAD_SHADE
  context.lineWidth = width
  context.stroke()
  context.strokeStyle = THREAD
  context.lineWidth = width * 0.55
  context.stroke()
  context.setLineDash([1.2, 2.6])
  context.strokeStyle = THREAD_HIGHLIGHT
  context.lineWidth = width * 0.3
  context.stroke()
  context.restore()
}

function drawNeedle(context, needle) {
  const { tipX, tipY, endX, endY, eyeX, eyeY, dx, dy } = needle
  const nx = -dy
  const ny = dx

  context.save()
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(endX, endY)
  context.strokeStyle = 'rgba(0, 0, 0, 0.6)'
  context.lineWidth = 5.4
  context.stroke()

  const steel = context.createLinearGradient(
    tipX + nx * 2,
    tipY + ny * 2,
    tipX - nx * 2,
    tipY - ny * 2,
  )
  steel.addColorStop(0, '#6f7378')
  steel.addColorStop(0.45, '#f4f6f8')
  steel.addColorStop(1, '#8a8f95')
  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(endX, endY)
  context.strokeStyle = steel
  context.lineWidth = 3.2
  context.stroke()

  context.beginPath()
  context.moveTo(eyeX - dx * 3.2, eyeY - dy * 3.2)
  context.lineTo(eyeX + dx * 3.2, eyeY + dy * 3.2)
  context.strokeStyle = '#1a1a1a'
  context.lineWidth = 0.9
  context.stroke()
  context.restore()
}

export class LaceRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.staticLayer = document.createElement('canvas')
    this.staticKey = ''
    this.needle = null
    this.lastFrame = 0
  }

  resize(width, height, geometry) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.ratio = ratio
    this.width = width
    this.height = height
    this.geometry = geometry
    this.lineWidth = Math.max(1.3, geometry.cell * 0.24)
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    this.staticLayer.width = this.canvas.width
    this.staticLayer.height = this.canvas.height
    this.meshTile = makeMeshTile(geometry.cell, ratio)
    this.frame = frameCells(geometry)
    this.holes = labelHoles(geometry)
    this.staticKey = ''
    this.needle = null
  }

  // Map a text-area cell (col, row) to viewport pixels, or null if it is
  // clipped by the border.
  cellToScreen(col, row, scrollRows) {
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
    return { x: gx * geometry.cell, y: gy * geometry.cell }
  }

  renderStatic(scene) {
    const { geometry, ratio, lineWidth } = this
    const context = this.staticLayer.getContext('2d')
    context.setTransform(1, 0, 0, 1, 0, 0)
    const pattern = context.createPattern(this.meshTile, 'repeat')
    pattern.setTransform(new DOMMatrix().scale(1 / ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = pattern
    context.fillRect(0, 0, this.width, this.height)

    // Cut a hole in the lace under each header link, finished with a solid
    // buttonhole edge, so the links stay legible on top of the fabric.
    for (const hole of this.holes) {
      for (let y = hole.top - 1; y <= hole.bottom + 1; y += 1) {
        for (let x = hole.left - 1; x <= hole.right + 1; x += 1) {
          const edge =
            y < hole.top || y > hole.bottom || x < hole.left || x > hole.right
          const corner =
            (y < hole.top || y > hole.bottom) && (x < hole.left || x > hole.right)
          if (corner) continue
          if (edge) {
            drawFilledCell(context, x * geometry.cell, y * geometry.cell, geometry.cell, lineWidth)
          } else {
            context.fillStyle = BACKDROP
            context.fillRect(
              x * geometry.cell + lineWidth,
              y * geometry.cell + lineWidth,
              geometry.cell,
              geometry.cell,
            )
          }
        }
      }
    }

    for (const [x, y] of this.frame) {
      drawFilledCell(context, x * geometry.cell, y * geometry.cell, geometry.cell, lineWidth)
    }

    const { layout, scrollRows, animating, placeholder } = scene
    for (const placedCharacter of layout.characters) {
      if (!placedCharacter.glyph || animating.has(placedCharacter.index)) continue
      const baseRow = layout.baselineOffset + placedCharacter.line * geometry.lineHeight
      for (const [dx, dy] of placedCharacter.glyph.cells) {
        const point = this.cellToScreen(placedCharacter.col + dx, baseRow + dy, scrollRows)
        if (!point) continue
        if (placeholder) {
          context.fillStyle = 'rgba(235, 228, 212, 0.62)'
          const dot = Math.max(2, geometry.cell * 0.5)
          context.fillRect(
            point.x + lineWidth + (geometry.cell - lineWidth - dot) / 2,
            point.y + lineWidth + (geometry.cell - lineWidth - dot) / 2,
            dot,
            dot,
          )
        } else {
          drawFilledCell(context, point.x, point.y, geometry.cell, lineWidth)
        }
      }
    }
  }

  draw(scene, now) {
    const { geometry, ratio, lineWidth, context } = this
    const { layout, scrollRows, births, placeholder, focused, reducedMotion } = scene

    const animating = new Set()
    let active = null
    let lastStitched = null
    for (const placedCharacter of layout.characters) {
      const birth = births[placedCharacter.index]
      if (!placedCharacter.glyph || placeholder || birth === undefined) continue
      const duration = stitchDuration(placedCharacter.glyph)
      if (now < birth + duration + CELL_FILL_MS) animating.add(placedCharacter.index)
      if (now >= birth && (!active || birth >= active.birth)) {
        active = { placedCharacter, birth, duration }
      }
    }

    const staticKey = [
      layout.characters.length,
      layout.lines,
      scrollRows,
      placeholder,
      [...animating].join(','),
      geometry.cell,
    ].join('|')
    if (staticKey !== this.staticKey) {
      this.renderStatic({ layout, scrollRows, animating, placeholder })
      this.staticKey = staticKey
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(this.staticLayer, 0, 0)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const cellCenter = (point) => ({
      x: point.x + lineWidth + (geometry.cell - lineWidth) / 2,
      y: point.y + lineWidth + (geometry.cell - lineWidth) / 2,
    })

    for (const placedCharacter of layout.characters) {
      if (!animating.has(placedCharacter.index)) continue
      const birth = births[placedCharacter.index]
      const { cells } = placedCharacter.glyph
      const duration = stitchDuration(placedCharacter.glyph)
      const baseRow = layout.baselineOffset + placedCharacter.line * geometry.lineHeight
      cells.forEach(([dx, dy], cellIndex) => {
        const start = birth + (cellIndex / cells.length) * duration
        const progress = clamp((now - start) / CELL_FILL_MS, 0, 1)
        if (progress <= 0) return
        const point = this.cellToScreen(placedCharacter.col + dx, baseRow + dy, scrollRows)
        if (point) drawFilledCell(context, point.x, point.y, geometry.cell, lineWidth, progress)
      })
    }

    // Where the needle should be, and where its thread is anchored.
    let target
    let stitching = false
    if (active && now < active.birth + active.duration) {
      const { placedCharacter, birth, duration } = active
      const { cells } = placedCharacter.glyph
      const position = clamp(((now - birth) / duration) * cells.length, 0, cells.length - 1)
      const [dx, dy] = cells[Math.floor(position)]
      const baseRow = layout.baselineOffset + placedCharacter.line * geometry.lineHeight
      const point = this.cellToScreen(placedCharacter.col + dx, baseRow + dy, scrollRows)
      if (point) {
        target = cellCenter(point)
        stitching = true
        const previous = cells[Math.max(0, Math.floor(position) - 1)]
        const anchorPoint = this.cellToScreen(
          placedCharacter.col + previous[0],
          baseRow + previous[1],
          scrollRows,
        )
        lastStitched = anchorPoint ? cellCenter(anchorPoint) : null
      }
    }

    if (!target) {
      const caretPoint = this.cellToScreen(layout.caret.col, layout.caret.row, scrollRows)
      target = caretPoint
        ? cellCenter(caretPoint)
        : {
            x: (geometry.textLeft + layout.caret.col) * geometry.cell,
            y: (geometry.inner.bottom - 2) * geometry.cell,
          }
      const last = [...layout.characters].reverse().find((item) => item.glyph)
      if (last && !placeholder) {
        const { cells } = last.glyph
        const [dx, dy] = cells[cells.length - 1] ?? [0, 0]
        const baseRow = layout.baselineOffset + last.line * geometry.lineHeight
        const anchorPoint = this.cellToScreen(last.col + dx, baseRow + dy, scrollRows)
        lastStitched = anchorPoint ? cellCenter(anchorPoint) : null
      }
    }

    const elapsed = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16
    this.lastFrame = now
    if (!this.needle || reducedMotion) {
      this.needle = { ...target }
    } else {
      const follow = 1 - Math.exp(-elapsed / (stitching ? 26 : 70))
      this.needle.x += (target.x - this.needle.x) * follow
      this.needle.y += (target.y - this.needle.y) * follow
    }

    const bob = focused && !stitching && !reducedMotion ? Math.sin(now / 420) * 1.6 : 0
    const needle = needleShape(this.needle.x, this.needle.y + bob, geometry.cell)
    const eye = { x: needle.eyeX, y: needle.eyeY }
    const sway = reducedMotion ? 0 : Math.sin(now / 900) * geometry.cell * 0.6

    if (lastStitched) {
      drawThread(context, lastStitched, eye, geometry.cell * 2.2 + sway, geometry.cell)
    } else {
      const loose = {
        x: eye.x - geometry.cell * 5 + sway,
        y: eye.y + geometry.cell * 11,
      }
      drawThread(context, eye, loose, geometry.cell * 1.5, geometry.cell)
    }
    drawNeedle(context, needle)

    return animating.size > 0 || stitching
  }
}

export function stitchDuration(glyph) {
  return clamp(glyph.cells.length * 7, 220, 520)
}
