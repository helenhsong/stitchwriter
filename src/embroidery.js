export const STITCH_FONT = '"Cormorant Garamond", Georgia, serif'

const THREAD = '#8f302d'
const THREAD_DARK = '#5e201f'
const THREAD_LIGHT = '#c66557'
const PROMPT_THREAD = '#a76f49'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function splitWord(context, word, maxWidth) {
  const segments = []
  let segment = ''

  for (const character of Array.from(word)) {
    const candidate = segment + character
    if (segment && context.measureText(candidate).width > maxWidth) {
      segments.push(segment)
      segment = character
    } else {
      segment = candidate
    }
  }

  if (segment) segments.push(segment)
  return segments
}

function wrapParagraph(context, paragraph, maxWidth) {
  if (!paragraph.length) return ['']

  const words = paragraph.split(/\s+/)
  const lines = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate
      continue
    }

    if (line) lines.push(line)

    if (context.measureText(word).width <= maxWidth) {
      line = word
      continue
    }

    const segments = splitWord(context, word, maxWidth)
    lines.push(...segments.slice(0, -1))
    line = segments.at(-1) ?? ''
  }

  lines.push(line)
  return lines
}

export function createEmbroideryLayout(value, width, minimumHeight) {
  const safeWidth = Math.max(300, Math.round(width))
  const compact = safeWidth < 520
  const fontSize = Math.round(clamp(safeWidth * 0.098, 42, 72))
  const lineHeight = Math.round(fontSize * 1.16)
  const textInset = compact ? 68 : 96
  const textWidth = safeWidth - textInset * 2
  const displayText = value || 'TYPE ANYTHING'
  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')

  measureContext.font = `600 ${fontSize}px ${STITCH_FONT}`
  const wrappedLines = displayText
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(measureContext, paragraph, textWidth))
  const lines = wrappedLines.length ? wrappedLines : ['']
  const textHeight = Math.max(lineHeight, lines.length * lineHeight)
  const topPadding = compact ? 142 : 168
  const bottomPadding = compact ? 148 : 174
  const height = Math.ceil(
    Math.max(minimumHeight, topPadding + textHeight + bottomPadding),
  )
  const contentTop = Math.max(topPadding, (height - textHeight) / 2 - 4)
  const lineMetrics = lines.map((line, index) => {
    const lineWidth = measureContext.measureText(line).width
    return {
      text: line,
      x: (safeWidth - lineWidth) / 2,
      width: lineWidth,
      baseline: contentTop + fontSize * 0.81 + index * lineHeight,
    }
  })
  const finalLine = lineMetrics.at(-1)
  const stitchGap = compact ? 4.8 : 5.6

  return {
    width: safeWidth,
    height,
    fontSize,
    lineHeight,
    stitchGap,
    textInset,
    contentTop,
    textHeight,
    lines: lineMetrics,
    caret: {
      x: clamp(finalLine.x + finalLine.width + 7, textInset, safeWidth - textInset),
      y: finalLine.baseline - fontSize * 0.72,
      height: fontSize * 0.72,
    },
  }
}

export function rasterizeStitches(layout) {
  const top = Math.max(0, Math.floor(layout.contentTop - layout.fontSize))
  const bottom = Math.min(
    layout.height,
    Math.ceil(layout.contentTop + layout.textHeight + layout.fontSize),
  )
  const maskHeight = Math.max(1, bottom - top)
  const mask = document.createElement('canvas')
  mask.width = layout.width
  mask.height = maskHeight
  const context = mask.getContext('2d', { willReadFrequently: true })

  context.clearRect(0, 0, layout.width, maskHeight)
  context.fillStyle = '#fff'
  context.font = `600 ${layout.fontSize}px ${STITCH_FONT}`
  context.textBaseline = 'alphabetic'
  for (const line of layout.lines) {
    context.fillText(line.text, line.x, line.baseline - top)
  }

  const pixels = context.getImageData(0, 0, layout.width, maskHeight).data
  const stitches = []
  const gap = layout.stitchGap
  const startX = Math.floor(layout.textInset / gap) * gap
  const endX = layout.width - layout.textInset
  const startY = Math.max(top, Math.floor(layout.contentTop / gap) * gap)
  const endY = Math.min(bottom, layout.contentTop + layout.textHeight + gap)

  for (let y = startY; y <= endY; y += gap) {
    for (let x = startX; x <= endX; x += gap) {
      const sampleX = Math.round(x)
      const sampleY = Math.round(y - top)
      if (sampleY < 0 || sampleY >= maskHeight) continue
      const index = (sampleY * layout.width + sampleX) * 4 + 3
      const alpha = pixels[index] ?? 0
      if (alpha > 76) {
        stitches.push({
          x,
          y,
          key: `${Math.round(x / gap)}:${Math.round(y / gap)}`,
        })
      }
    }
  }

  return stitches
}

function drawFabric(context, width, height, gap) {
  const base = context.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, '#f2e4c9')
  base.addColorStop(0.46, '#e7d4b3')
  base.addColorStop(1, '#ddc39d')
  context.fillStyle = base
  context.fillRect(0, 0, width, height)

  const edgeShade = context.createLinearGradient(0, 0, width, 0)
  edgeShade.addColorStop(0, 'rgba(104, 64, 37, 0.12)')
  edgeShade.addColorStop(0.08, 'rgba(255, 250, 233, 0.03)')
  edgeShade.addColorStop(0.5, 'rgba(255, 255, 255, 0.07)')
  edgeShade.addColorStop(0.92, 'rgba(255, 250, 233, 0.02)')
  edgeShade.addColorStop(1, 'rgba(104, 64, 37, 0.14)')
  context.fillStyle = edgeShade
  context.fillRect(0, 0, width, height)

  context.save()
  context.lineWidth = 0.55
  context.strokeStyle = 'rgba(115, 74, 45, 0.16)'
  for (let x = 1; x < width; x += gap) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + Math.sin(x * 0.19) * 0.6, height)
    context.stroke()
  }
  for (let y = 1; y < height; y += gap) {
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y + Math.sin(y * 0.17) * 0.55)
    context.stroke()
  }

  context.fillStyle = 'rgba(112, 72, 40, 0.075)'
  for (let y = 13; y < height; y += 19) {
    for (let x = 9; x < width; x += 23) {
      const offset = Math.sin(x * 12.9898 + y * 78.233)
      if (offset > 0.15) context.fillRect(x + offset * 2, y, 1.2, 0.75)
    }
  }
  context.restore()
}

function addCrossPath(context, x, y, radius) {
  context.moveTo(x - radius, y - radius)
  context.lineTo(x + radius, y + radius)
  context.moveTo(x + radius, y - radius)
  context.lineTo(x - radius, y + radius)
}

function drawCrossBatch(context, stitches, size, color, alpha = 1) {
  if (!stitches.length) return
  const radius = size / 2

  context.save()
  context.globalAlpha = alpha
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  for (const stitch of stitches) addCrossPath(context, stitch.x, stitch.y, radius)
  context.strokeStyle = THREAD_DARK
  context.lineWidth = Math.max(1.15, size * 0.34)
  context.stroke()

  context.beginPath()
  for (const stitch of stitches) addCrossPath(context, stitch.x, stitch.y, radius * 0.92)
  context.strokeStyle = color
  context.lineWidth = Math.max(0.72, size * 0.2)
  context.stroke()

  context.beginPath()
  for (const stitch of stitches) {
    context.moveTo(stitch.x - radius * 0.78, stitch.y - radius * 0.88)
    context.lineTo(stitch.x + radius * 0.72, stitch.y + radius * 0.62)
  }
  context.strokeStyle = THREAD_LIGHT
  context.globalAlpha = alpha * 0.48
  context.lineWidth = Math.max(0.42, size * 0.08)
  context.stroke()
  context.restore()
}

function drawPartialCross(context, stitch, size, progress, color) {
  if (progress <= 0) return
  const radius = size / 2
  const first = clamp(progress * 2, 0, 1)
  const second = clamp((progress - 0.5) * 2, 0, 1)

  context.save()
  context.lineCap = 'round'
  context.strokeStyle = THREAD_DARK
  context.lineWidth = Math.max(1.15, size * 0.34)
  context.beginPath()
  context.moveTo(stitch.x - radius, stitch.y - radius)
  context.lineTo(
    stitch.x - radius + radius * 2 * first,
    stitch.y - radius + radius * 2 * first,
  )
  if (second > 0) {
    context.moveTo(stitch.x + radius, stitch.y - radius)
    context.lineTo(
      stitch.x + radius - radius * 2 * second,
      stitch.y - radius + radius * 2 * second,
    )
  }
  context.stroke()

  context.strokeStyle = color
  context.lineWidth = Math.max(0.72, size * 0.2)
  context.stroke()
  context.restore()
}

function makeBorderStitches(width, height, inset, gap) {
  const stitches = []
  const right = width - inset
  const bottom = height - inset

  for (let x = inset; x <= right; x += gap) {
    stitches.push({ x, y: inset }, { x, y: bottom })
  }
  for (let y = inset + gap; y < bottom; y += gap) {
    stitches.push({ x: inset, y }, { x: right, y })
  }
  return stitches
}

function drawRosette(context, x, y, scale = 1) {
  const points = [
    [0, 0],
    [-6, 0],
    [6, 0],
    [0, -6],
    [0, 6],
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ].map(([dx, dy]) => ({ x: x + dx * scale, y: y + dy * scale }))
  drawCrossBatch(context, points, 4.5 * scale, THREAD, 0.92)
}

function drawStar(context, x, y, scale = 1) {
  const points = [
    [0, -10],
    [0, 0],
    [0, 10],
    [-10, 0],
    [10, 0],
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ].map(([dx, dy]) => ({ x: x + dx * scale, y: y + dy * scale }))
  drawCrossBatch(context, points, 4.2 * scale, THREAD, 0.8)
}

function drawFlourish(context, width, y, direction = 1) {
  const center = width / 2
  const reach = Math.min(112, width * 0.17)

  context.save()
  context.strokeStyle = THREAD
  context.lineWidth = 1.7
  context.lineCap = 'round'
  context.globalAlpha = 0.9
  context.beginPath()
  context.moveTo(center - 2, y)
  context.bezierCurveTo(
    center - reach * 0.26,
    y - 11 * direction,
    center - reach * 0.48,
    y + 13 * direction,
    center - reach,
    y,
  )
  context.moveTo(center + 2, y)
  context.bezierCurveTo(
    center + reach * 0.26,
    y - 11 * direction,
    center + reach * 0.48,
    y + 13 * direction,
    center + reach,
    y,
  )
  context.stroke()
  context.restore()

  drawRosette(context, center, y, 0.82)
  drawRosette(context, center - reach, y, 0.5)
  drawRosette(context, center + reach, y, 0.5)
}

function drawDecorations(context, layout) {
  const outerInset = layout.width < 520 ? 20 : 28
  const borderGap = layout.width < 520 ? 9.5 : 11
  const borderStitches = makeBorderStitches(
    layout.width,
    layout.height,
    outerInset,
    borderGap,
  )
  drawCrossBatch(context, borderStitches, 5, THREAD, 0.94)

  const innerInset = outerInset + 14
  context.save()
  context.strokeStyle = THREAD
  context.lineWidth = 1.35
  context.globalAlpha = 0.82
  context.setLineDash([2, 4])
  context.strokeRect(
    innerInset,
    innerInset,
    layout.width - innerInset * 2,
    layout.height - innerInset * 2,
  )
  context.restore()

  const cornerOffset = innerInset + 12
  drawRosette(context, cornerOffset, cornerOffset, 0.72)
  drawRosette(context, layout.width - cornerOffset, cornerOffset, 0.72)
  drawRosette(context, cornerOffset, layout.height - cornerOffset, 0.72)
  drawRosette(
    context,
    layout.width - cornerOffset,
    layout.height - cornerOffset,
    0.72,
  )

  drawFlourish(context, layout.width, innerInset + 42, 1)
  drawFlourish(context, layout.width, layout.height - innerInset - 42, -1)

  const sideX = innerInset + 12
  for (let y = innerInset + 112; y < layout.height - innerInset - 100; y += 166) {
    drawStar(context, sideX, y, 0.62)
    drawStar(context, layout.width - sideX, y, 0.62)
  }
}

function drawTextStitches(
  context,
  stitches,
  previousKeys,
  gap,
  elapsed,
  prompt,
) {
  const color = prompt ? PROMPT_THREAD : THREAD
  const size = gap * 0.76
  const existing = []
  const completed = []
  const partial = []

  for (const stitch of stitches) {
    if (previousKeys.has(stitch.key)) {
      existing.push(stitch)
      continue
    }

    const stagger = ((stitch.x / gap + stitch.y / gap) % 23) * 7
    const progress = clamp((elapsed - stagger) / 360, 0, 1)
    if (progress >= 1) completed.push(stitch)
    else if (progress > 0) partial.push({ stitch, progress })
  }

  drawCrossBatch(context, existing, size, color, prompt ? 0.72 : 1)
  drawCrossBatch(context, completed, size, color, prompt ? 0.72 : 1)
  for (const item of partial) {
    drawPartialCross(context, item.stitch, size, item.progress, color)
  }
}

export function drawEmbroidery(
  canvas,
  layout,
  stitches,
  previousKeys,
  elapsed,
  prompt,
) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.round(layout.width * ratio)
  const pixelHeight = Math.round(layout.height * ratio)

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  canvas.style.height = `${layout.height}px`

  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, layout.width, layout.height)
  drawFabric(context, layout.width, layout.height, layout.stitchGap)
  drawDecorations(context, layout)
  drawTextStitches(
    context,
    stitches,
    previousKeys,
    layout.stitchGap,
    elapsed,
    prompt,
  )
}
