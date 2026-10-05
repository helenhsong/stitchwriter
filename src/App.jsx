import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import '@fontsource/cormorant-garamond/latin-600-italic.css'
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
} from './embroidery.js'

const PLACEHOLDER = 'Type anything…'

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
    const update = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return size
}

function useFontReady() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 1800))
    const fontLoad =
      document.fonts?.load(`${STITCH_FONT_STYLE} 72px ${STITCH_FONT}`) ??
      Promise.resolve()

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
  const [scrollRows, setScrollRows] = useState(0)
  const canvasRef = useRef(null)
  const mainRef = useRef(null)
  const rendererRef = useRef(null)
  const inputRef = useRef(null)
  const birthsRef = useRef([])
  const previousTextRef = useRef('')
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
    () => (fontReady ? layoutText(text || PLACEHOLDER, geometry) : null),
    [fontReady, geometry, text],
  )
  const overflowRows = layout
    ? Math.max(0, layout.height - geometry.visibleTextRows)
    : 0
  const visibleScrollRows = Math.min(scrollRows, overflowRows)
  const documentHeight = viewport.height + overflowRows * geometry.cell
  // The piece itself grows downward as the writing overflows it.
  const pieceGeometry = useMemo(
    () => ({
      ...geometry,
      frame: { ...geometry.frame, bottom: geometry.frame.bottom + overflowRows },
      inner: { ...geometry.inner, bottom: geometry.inner.bottom + overflowRows },
    }),
    [geometry, overflowRows],
  )
  const caretCell = useMemo(
    () => (layout ? caretPosition(layout, placeholder ? 0 : caret) : { col: 0, line: 0 }),
    [caret, layout, placeholder],
  )

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
  }, [layout, reducedMotion, text])

  useEffect(() => {
    const update = () => setScrollRows(Math.floor(window.scrollY / geometry.cell))
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [geometry.cell])

  useLayoutEffect(() => {
    sceneRef.current = layout
      ? {
          layout,
          scrollRows: visibleScrollRows,
          pieceGeometry,
          births: birthsRef.current,
          placeholder,
          caret: caretCell,
          reducedMotion,
        }
      : null
  }, [caretCell, layout, pieceGeometry, placeholder, reducedMotion, visibleScrollRows])

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
        renderer.draw(scene, now)
      }
      if (!reducedMotion) frame = requestAnimationFrame(paint)
    }

    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [caret, fontReady, geometry, readmeOpen, reducedMotion, scrollRows, text])

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

  // Keep the insertion point on screen as the piece grows.
  useEffect(() => {
    if (!layout || placeholder) return
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
  }, [caretCell.line, geometry, layout, placeholder, scrollRows])

  const syncCaret = (input) => {
    const offset = input.selectionDirection === 'backward'
      ? input.selectionStart
      : input.selectionEnd
    setCaret(codePointLength(input.value.slice(0, offset)))
  }

  // Map a pointer position to an insertion point in the writing, if any.
  const hitTest = (clientX, clientY) => {
    if (!layout || placeholder) return null
    const col = clientX / geometry.cell - geometry.textLeft
    const row = clientY / geometry.cell - geometry.textTop + visibleScrollRows
    const x = clientX / geometry.cell
    const y = clientY / geometry.cell + visibleScrollRows
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
        {!fontReady && (
          <div className="lace-loader" role="status" aria-live="polite">
            threading the needle…
          </div>
        )}
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
