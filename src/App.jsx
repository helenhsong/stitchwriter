import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import '@fontsource/cormorant-garamond/latin-700-italic.css'
import readme from '../README.md?raw'
import {
  LaceRenderer,
  STITCH_FONT,
  STITCH_FONT_STYLE,
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

function App() {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [scrollRows, setScrollRows] = useState(0)
  const canvasRef = useRef(null)
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
  const documentHeight = viewport.height + overflowRows * geometry.cell

  // Schedule newly typed characters to be stitched one after another.
  useLayoutEffect(() => {
    if (!layout) return
    const previous = Array.from(previousTextRef.current)
    const next = Array.from(text)
    let common = 0
    while (
      common < previous.length &&
      common < next.length &&
      previous[common] === next[common]
    ) {
      common += 1
    }

    const births = birthsRef.current.slice(0, common)
    const added = next.length - common
    const now = performance.now()
    const bulk = added > 6
    const spacing = bulk ? Math.min(60, 1100 / added) : 150
    let lastBirth = births.reduce(
      (latest, birth) => (birth === undefined ? latest : Math.max(latest, birth)),
      -Infinity,
    )

    for (let index = common; index < next.length; index += 1) {
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
          scrollRows: Math.min(scrollRows, overflowRows),
          births: birthsRef.current,
          placeholder,
          focused,
          reducedMotion,
        }
      : null
  }, [focused, layout, overflowRows, placeholder, reducedMotion, scrollRows])

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
  }, [fontReady, readmeOpen, reducedMotion, text, focused, scrollRows, geometry])

  // Keep the needle on screen as the text grows past the bottom border.
  useEffect(() => {
    if (!focused || !layout) return
    const caretBottom = layout.caret.row + Math.round(geometry.em * 0.6)
    const visibleBottom = scrollRows + geometry.visibleTextRows
    if (caretBottom > visibleBottom) {
      window.scrollTo({
        top: (caretBottom - geometry.visibleTextRows) * geometry.cell,
        behavior: 'auto',
      })
    }
  }, [focused, geometry, layout, scrollRows])

  const focusInput = () => inputRef.current?.focus({ preventScroll: true })
  const keepCaretAtEnd = (event) => {
    const input = event.currentTarget
    const end = input.value.length
    if (input.selectionStart !== end || input.selectionEnd !== end) {
      input.setSelectionRange(end, end)
    }
  }

  return (
    <>
      <ProjectHeader readme={readme} />
      <main
        className="lace-page"
        aria-busy={!fontReady}
        style={{ height: `${documentHeight - 66}px` }}
        onClick={focusInput}
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
          onChange={(event) => setText(event.target.value)}
          onSelect={keepCaretAtEnd}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
          aria-label="Text to stitch"
          autoCapitalize="sentences"
          maxLength={12000}
          spellCheck={false}
        />
      </main>
    </>
  )
}

export default App
