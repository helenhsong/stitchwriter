import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import '@fontsource/playfair-display/latin-400-italic.css'
import readme from '../README.md?raw'
import {
  HEADER_HEIGHT,
  LaceRenderer,
  STITCH_FONT,
  STITCH_FONT_STYLE,
  caretIndexAt,
  caretPosition,
  createGeometry,
  layoutText,
  stitchDuration,
} from './embroidery.js'

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return reduced
}

function useViewport() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  useEffect(() => {
    // Repainting the whole mesh is costly, so wait for resizing to settle.
    let timer = 0
    const update = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => setSize({ width: window.innerWidth, height: window.innerHeight }),
        150,
      )
    }
    window.addEventListener('resize', update)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', update)
    }
  }, [])

  return size
}

function useFontReady() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 1800))
    const fontLoad = document.fonts
      ? document.fonts.load(`${STITCH_FONT_STYLE} 72px ${STITCH_FONT}`)
      : Promise.resolve()

    Promise.race([fontLoad, timeout]).then(() => {
      if (active) setReady(true)
    })

    return () => {
      active = false
    }
  }, [])

  return ready
}

// ProjectHeader marks <html data-ph-open> while its README panel is showing.
function useReadmeOpen() {
  const [open, setOpen] = useState(() =>
    document.documentElement.hasAttribute('data-ph-open'),
  )

  useEffect(() => {
    const root = document.documentElement
    const update = () => setOpen(root.hasAttribute('data-ph-open'))
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-ph-open'] })
    update()
    return () => observer.disconnect()
  }, [])

  return open
}

function codePointLength(value) {
  return Array.from(value).length
}

function App() {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const canvasRef = useRef(null)
  const mainRef = useRef(null)
  const rendererRef = useRef(null)
  const inputRef = useRef(null)
  const birthsRef = useRef([])
  const ghostsRef = useRef([])
  const previousLayoutRef = useRef(null)
  const previousTextRef = useRef('')
  const ghostTimerRef = useRef(0)
  // Rows the piece must keep while deleted letters are still unravelling,
  // so the border only draws in as the stitches come out.
  const [ghostRows, setGhostRows] = useState(0)
  const sceneRef = useRef(null)
  const fontReady = useFontReady()
  const reducedMotion = useReducedMotion()
  const viewport = useViewport()
  const readmeOpen = useReadmeOpen()

  const geometry = useMemo(
    () => createGeometry(viewport.width, viewport.height),
    [viewport.width, viewport.height],
  )
  const placeholder = !text
  const layout = useMemo(
    () => (fontReady ? layoutText(text, geometry) : null),
    [fontReady, geometry, text],
  )
  // The piece is sized to its writing: it starts one line tall and grows
  // a row at a time as the writing gets longer.
  const growRows = layout
    ? Math.max(layout.height, ghostRows) - geometry.visibleTextRows
    : 0
  const overflowRows = Math.max(0, growRows)
  const maxScroll = overflowRows * geometry.cell
  const documentHeight = viewport.height + overflowRows * geometry.cell
  const pieceGeometry = useMemo(
    () => ({
      ...geometry,
      frame: { ...geometry.frame, bottom: geometry.frame.bottom + growRows },
      inner: { ...geometry.inner, bottom: geometry.inner.bottom + growRows },
    }),
    [geometry, growRows],
  )
  const caretCell = useMemo(
    () => (layout ? caretPosition(layout, caret) : { col: 0, line: 0 }),
    [caret, layout],
  )

  // Keep the piece tall enough for every letter still being unpicked, and
  // let it draw in as each one finishes.
  const holdForGhosts = useCallback(function hold() {
    window.clearTimeout(ghostTimerRef.current)
    const now = performance.now()
    let rows = 0
    let nextEnd = Infinity
    for (const ghost of ghostsRef.current) {
      if (now >= ghost.end) continue
      rows = Math.max(
        rows,
        geometry.baselineOffset +
          ghost.item.line * geometry.lineHeight +
          Math.round(geometry.em * 0.5),
      )
      nextEnd = Math.min(nextEnd, ghost.end)
    }
    setGhostRows(rows)
    if (nextEnd < Infinity) {
      ghostTimerRef.current = window.setTimeout(hold, nextEnd - now)
    }
  }, [geometry])

  useEffect(() => () => window.clearTimeout(ghostTimerRef.current), [])

  // Schedule newly typed characters to be stitched one after another. Only
  // the changed span is new: text before and after an insertion keeps its
  // stitches.
  useLayoutEffect(() => {
    if (!layout) return
    const previous = Array.from(previousTextRef.current)
    const next = Array.from(text)
    let prefix = 0
    while (
      prefix < previous.length &&
      prefix < next.length &&
      previous[prefix] === next[prefix]
    ) {
      prefix += 1
    }
    let suffix = 0
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1
    }

    const oldBirths = birthsRef.current
    const births = oldBirths.slice(0, prefix)
    const added = next.length - prefix - suffix
    const now = performance.now()

    // Deleted letters are unpicked where they stood, the last one typed
    // coming out first.
    const removed = previous.length - prefix - suffix
    const oldLayout = previousLayoutRef.current
    const ghosts = ghostsRef.current.filter((ghost) => now < ghost.end)
    if (removed > 0 && oldLayout && !reducedMotion) {
      const gap = removed > 6 ? Math.min(30, 500 / removed) : 70
      let order = 0
      for (let index = prefix + removed - 1; index >= prefix; index -= 1) {
        const item = oldLayout.characters[index]
        const birth = oldBirths[index]
        if (!item?.glyph || (birth !== undefined && birth > now)) continue
        const start = now + order * gap
        const duration = Math.min(300, stitchDuration(item.glyph) * 0.6)
        ghosts.push({ item, start, duration, end: start + duration })
        order += 1
      }
    }
    ghostsRef.current = ghosts
    previousLayoutRef.current = layout
    holdForGhosts()
    const bulk = added > 6
    const spacing = bulk ? Math.min(60, 1100 / added) : 150
    let lastBirth = oldBirths.reduce(
      (latest, birth) => (birth === undefined ? latest : Math.max(latest, birth)),
      -Infinity,
    )

    for (let index = prefix; index < prefix + added; index += 1) {
      const character = next[index]
      if (reducedMotion || /\s/.test(character)) {
        births[index] = reducedMotion ? -Infinity : undefined
        continue
      }
      // Pastes are stitched quickly; fast typing catches up gradually.
      const backlog = Math.max(0, lastBirth - now)
      const gap = bulk ? spacing : Math.max(20, spacing - backlog * 0.5)
      const birth = Math.max(now, lastBirth + gap)
      births[index] = birth
      lastBirth = birth
    }
    births.push(...oldBirths.slice(previous.length - suffix))

    birthsRef.current = births
    previousTextRef.current = text
  }, [holdForGhosts, layout, reducedMotion, text])

  useLayoutEffect(() => {
    sceneRef.current = layout
      ? {
          layout,
          maxScroll,
          pieceGeometry,
          births: birthsRef.current,
          placeholder,
          caret: caretCell,
          caretIndex: caret,
          reducedMotion,
        }
      : null
  }, [caret, caretCell, layout, maxScroll, pieceGeometry, placeholder, reducedMotion])

  useEffect(() => {
    if (!fontReady || readmeOpen || !canvasRef.current) return undefined
    const renderer = new LaceRenderer(canvasRef.current)
    renderer.resize(viewport.width, viewport.height, geometry)
    rendererRef.current = renderer
  }, [fontReady, geometry, readmeOpen, viewport.height, viewport.width])

  useEffect(() => {
    if (!fontReady || readmeOpen) return undefined
    let frame = 0

    const paint = (now) => {
      const scene = sceneRef.current
      const renderer = rendererRef.current
      if (scene && renderer) {
        scene.births = birthsRef.current
        scene.ghosts = ghostsRef.current
        // Read the scroll position every frame so the lace moves with the
        // page smoothly instead of in steps.
        scene.scrollY = window.scrollY
        renderer.draw(scene, now)
      }
      if (!reducedMotion) frame = requestAnimationFrame(paint)
    }

    frame = requestAnimationFrame(paint)
    // With reduced motion there is no running loop, so repaint on scroll.
    const onScroll = () => {
      if (!reducedMotion) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [caret, fontReady, geometry, readmeOpen, reducedMotion, text])

  // Ready to type as soon as the page opens, and any key typed while focus
  // is elsewhere on the page goes to the lace.
  useEffect(() => {
    if (!fontReady || readmeOpen) return undefined
    const input = inputRef.current
    input?.focus({ preventScroll: true })

    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (document.activeElement === input) return
      if (document.activeElement?.closest?.('a, button, input, select')) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab') return
      }
      input?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fontReady, readmeOpen])

  // Keep the insertion point on screen as the piece grows. This only runs
  // when the writing or the insertion point changes, never on scroll, so
  // the page can be scrolled freely.
  useEffect(() => {
    if (!layout || placeholder) return
    const scrollRows = window.scrollY / geometry.cell
    const caretBottom =
      geometry.textTop +
      geometry.baselineOffset +
      caretCell.line * geometry.lineHeight +
      Math.round(geometry.em * 0.9)
    const caretTop = caretBottom - geometry.lineHeight - Math.round(geometry.em * 0.4)
    const headerRows = Math.ceil(HEADER_HEIGHT / geometry.cell)
    if (caretBottom - scrollRows > geometry.rows - 3) {
      // On the last line, show the whole bottom of the piece.
      const lastLine = caretCell.line === layout.lines - 1
      window.scrollTo({
        top: lastLine
          ? document.documentElement.scrollHeight
          : (caretBottom - geometry.rows + 3) * geometry.cell,
      })
    } else if (caretTop - scrollRows < headerRows + 1) {
      window.scrollTo({ top: Math.max(0, caretTop - headerRows - 1) * geometry.cell })
    }
  }, [caretCell.line, geometry, layout, placeholder])

  const syncCaret = (input) => {
    const offset = input.selectionDirection === 'backward'
      ? input.selectionStart
      : input.selectionEnd
    setCaret(codePointLength(input.value.slice(0, offset)))
  }

  // Map a pointer position to an insertion point in the writing, if any.
  const hitTest = (clientX, clientY) => {
    if (!layout || placeholder) return null
    const scrollRows = Math.min(window.scrollY, maxScroll) / geometry.cell
    const col = clientX / geometry.cell - geometry.textLeft
    const row = clientY / geometry.cell - geometry.textTop + scrollRows
    const x = clientX / geometry.cell
    const y = clientY / geometry.cell + scrollRows
    const { inner } = pieceGeometry
    const insideBorder =
      x >= inner.left && x <= inner.right + 1 && y >= inner.top && y <= inner.bottom + 1
    return insideBorder ? caretIndexAt(layout, geometry, col, row) : null
  }

  const onPointerUp = (event) => {
    const input = inputRef.current
    if (!input) return
    const index = hitTest(event.clientX, event.clientY)
    input.focus({ preventScroll: true })
    if (index === null) return
    const offset = Array.from(text).slice(0, index).join('').length
    input.setSelectionRange(offset, offset)
    setCaret(index)
  }

  const onPointerMove = (event) => {
    if (!mainRef.current) return
    const overText = hitTest(event.clientX, event.clientY) !== null
    mainRef.current.style.cursor = overText ? 'text' : 'default'
  }

  return (
    <>
      <ProjectHeader readme={readme} />
      <main
        ref={mainRef}
        className="lace-page"
        aria-busy={!fontReady}
        style={{ height: `${documentHeight - HEADER_HEIGHT}px` }}
        // Keep focus in the hidden input; clicks only move the insertion
        // point when they land on the writing.
        onMouseDown={(event) => event.preventDefault()}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
      >
        <canvas
          ref={canvasRef}
          className="lace-canvas"
          role="img"
          aria-label={
            text
              ? `Filet-lace text: ${text.slice(0, 180)}`
              : 'An empty piece of filet lace'
          }
        />
        <textarea
          ref={inputRef}
          className="lace-input"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            syncCaret(event.target)
          }}
          onSelect={(event) => syncCaret(event.currentTarget)}
          aria-label="Text to stitch"
          autoCapitalize="sentences"
          autoFocus
          maxLength={12000}
          spellCheck={false}
        />
      </main>
    </>
  )
}

export default App
