import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import readme from '../README.md?raw'
import {
  STITCH_FONT,
  createEmbroideryLayout,
  drawEmbroidery,
  rasterizeStitches,
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

function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight)

  useEffect(() => {
    const update = () => setHeight(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return height
}

function useFontReady() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 1800))
    const fontLoad = document.fonts?.load(`600 72px ${STITCH_FONT}`) ?? Promise.resolve()

    Promise.race([fontLoad, timeout]).then(() => {
      if (active) setReady(true)
    })

    return () => {
      active = false
    }
  }, [])

  return ready
}

function App() {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [clothWidth, setClothWidth] = useState(720)
  const canvasRef = useRef(null)
  const clothRef = useRef(null)
  const motionRef = useRef(null)
  const inputRef = useRef(null)
  const caretRef = useRef(null)
  const previousStitchesRef = useRef([])
  const previousTextRef = useRef(null)
  const fontReady = useFontReady()
  const reducedMotion = useReducedMotion()
  const viewportHeight = useViewportHeight()

  useLayoutEffect(() => {
    if (!fontReady || !clothRef.current) return undefined

    const update = () => setClothWidth(clothRef.current.clientWidth)
    const observer = new ResizeObserver(update)
    update()
    observer.observe(clothRef.current)
    return () => observer.disconnect()
  }, [fontReady])

  const minimumHeight = Math.max(640, viewportHeight - 126)
  const layout = useMemo(
    () =>
      createEmbroideryLayout(fontReady ? text : '', clothWidth, minimumHeight),
    [clothWidth, fontReady, minimumHeight, text],
  )
  const stitches = useMemo(
    () => (fontReady ? rasterizeStitches(layout) : []),
    [fontReady, layout],
  )

  useEffect(() => {
    if (!fontReady || !canvasRef.current) return undefined

    let animationFrame
    const textChanged = previousTextRef.current !== text
    const previousKeys = textChanged
      ? new Set(previousStitchesRef.current.map((stitch) => stitch.key))
      : new Set(stitches.map((stitch) => stitch.key))
    const startedAt = performance.now()

    const paint = (now) => {
      const elapsed = reducedMotion ? 1000 : now - startedAt
      drawEmbroidery(
        canvasRef.current,
        layout,
        stitches,
        previousKeys,
        elapsed,
        !text,
      )
      if (!reducedMotion && elapsed < 560) {
        animationFrame = requestAnimationFrame(paint)
      }
    }

    animationFrame = requestAnimationFrame(paint)
    previousStitchesRef.current = stitches
    previousTextRef.current = text

    return () => cancelAnimationFrame(animationFrame)
  }, [fontReady, layout, reducedMotion, stitches, text])

  useEffect(() => {
    if (!fontReady || reducedMotion || !motionRef.current) return undefined

    let lastScroll = window.scrollY
    let velocity = 0
    let animationFrame = 0

    const settle = () => {
      velocity *= 0.82
      const scroll = window.scrollY
      const tilt = Math.max(-1.2, Math.min(1.2, velocity * 0.055))
      const sway = Math.sin(scroll * 0.008) * 2.2
      motionRef.current?.style.setProperty('--cloth-tilt', `${tilt}deg`)
      motionRef.current?.style.setProperty(
        '--cloth-shift',
        `${sway + Math.max(-5, Math.min(5, velocity * 0.11))}px`,
      )
      motionRef.current?.style.setProperty('--weave-y', `${scroll * -0.08}px`)

      if (Math.abs(velocity) > 0.04) {
        animationFrame = requestAnimationFrame(settle)
      } else {
        animationFrame = 0
      }
    }

    const onScroll = () => {
      const nextScroll = window.scrollY
      velocity += nextScroll - lastScroll
      lastScroll = nextScroll
      if (!animationFrame) animationFrame = requestAnimationFrame(settle)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(animationFrame)
    }
  }, [fontReady, reducedMotion])

  useEffect(() => {
    if (!focused || !text || !caretRef.current) return undefined

    const animationFrame = requestAnimationFrame(() => {
      const bounds = caretRef.current.getBoundingClientRect()
      if (bounds.bottom > window.innerHeight - 80) {
        window.scrollBy({
          top: bounds.bottom - window.innerHeight + 112,
          behavior: reducedMotion ? 'auto' : 'smooth',
        })
      }
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [focused, layout.height, reducedMotion, text])

  const focusInput = () => inputRef.current?.focus({ preventScroll: true })
  const clearText = () => {
    setText('')
    requestAnimationFrame(focusInput)
  }

  return (
    <>
      <ProjectHeader readme={readme} />
      <main className="project-page" aria-busy={!fontReady}>
        <section className="stitch-stage" aria-label="Interactive embroidery canvas">
          {!fontReady ? (
            <div className="stitch-loader" role="status" aria-live="polite">
              <span className="loader-thread" aria-hidden="true" />
              <span>threading the needle…</span>
            </div>
          ) : (
            <>
              <div
                ref={motionRef}
                className={`cloth-motion${focused ? ' is-focused' : ''}`}
              >
                <div
                  ref={clothRef}
                  className="cloth-surface"
                  onClick={focusInput}
                  style={{ height: `${layout.height}px` }}
                >
                  <textarea
                    ref={inputRef}
                    className="stitch-input"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') event.currentTarget.blur()
                    }}
                    aria-label="Text to embroider"
                    autoCapitalize="sentences"
                    maxLength={12000}
                    spellCheck
                  />
                  <canvas
                    ref={canvasRef}
                    className="embroidery-canvas"
                    width={layout.width}
                    height={layout.height}
                    role="img"
                    aria-label={
                      text
                        ? `Cross-stitched text: ${text.slice(0, 180)}`
                        : 'An empty cross-stitch sampler'
                    }
                  />
                  {text && focused && (
                    <span
                      ref={caretRef}
                      className="stitch-caret"
                      aria-hidden="true"
                      style={{
                        left: `${layout.caret.x}px`,
                        top: `${layout.caret.y}px`,
                        height: `${layout.caret.height}px`,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="stitch-controls">
                <p>click the cloth and type · paste works too</p>
                {text && (
                  <button type="button" onClick={clearText}>
                    unpick all
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </>
  )
}

export default App
