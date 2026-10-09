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
  loadKitFace,
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

// Ready once the fallback face, the header's fonts and Helen's font kit have
// loaded (or given up); returns the kit's typeface for the writing, or null
// without it.
function useStitchFace() {
  const [state, setState] = useState({ ready: false, face: null })

  useEffect(() => {
    let active = true
    const timeout = (ms, value) => new Promise((resolve) => window.setTimeout(() => resolve(value), ms))
    const fallback = document.fonts
      ? Promise.all([document.fonts.load(`${STITCH_FONT_STYLE} 72px ${STITCH_FONT}`), document.fonts.ready])
      : Promise.resolve()

    Promise.all([
      Promise.race([fallback, timeout(1800)]),
      Promise.race([loadKitFace().catch(() => null), timeout(2500, null)]),
    ]).then(([, face]) => {
      if (active) setState({ ready: true, face })
    })

    return () => {
      active = false
    }
  }, [])

  return state
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
  const [selection, setSelection] = useState(null)
  const dragRef = useRef(null)
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
  // While deleted letters are unpicked, the writing after them stays where
  // it was, and closes up once the last stitch is out.
  const [held, setHeldState] = useState(null)
  const heldRef = useRef(null)
  const setHeld = useCallback((value) => {
    heldRef.current = value
    setHeldState(value)
  }, [])
  const holdTimerRef = useRef(0)
  const sceneRef = useRef(null)
  const { ready: fontReady, face: stitchFace } = useStitchFace()
  const reducedMotion = useReducedMotion()
  const viewport = useViewport()
  const readmeOpen = useReadmeOpen()

  const geometry = useMemo(
    () => createGeometry(viewport.width, viewport.height),
    [viewport.width, viewport.height],
  )
  const placeholder = !text
  const layout = useMemo(
    () => (fontReady ? layoutText(text, geometry, stitchFace) : null),
    [fontReady, geometry, stitchFace, text],
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

  useEffect(() => () => {
    window.clearTimeout(ghostTimerRef.current)
    window.clearTimeout(holdTimerRef.current)
  }, [])

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
    const lastEnd = ghosts.reduce((latest, ghost) => Math.max(latest, ghost.end), 0)
    const current = heldRef.current
    const heldBase = current?.text === previousTextRef.current ? current.layout : oldLayout
    if (removed > 0 && added === 0 && suffix > 0 && heldBase && lastEnd > now) {
      const characters = layout.characters.map((item) => {
        const before = heldBase.characters[item.index + removed]
        return item.index < prefix || !before
          ? item
          : { ...item, col: before.col, end: before.end, line: before.line }
      })
      setHeld({ text, layout: { ...layout, characters, height: Math.max(layout.height, heldBase.height) } })
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = window.setTimeout(() => setHeld(null), lastEnd - now)
    } else if (current && (current.text !== text || layout !== oldLayout)) {
      window.clearTimeout(holdTimerRef.current)
      setHeld(null)
    }
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
  }, [holdForGhosts, layout, reducedMotion, setHeld, text])

  useLayoutEffect(() => {
    sceneRef.current = layout
      ? {
          layout: held?.text === text ? held.layout : layout,
          maxScroll,
          pieceGeometry,
          births: birthsRef.current,
          placeholder,
          caret: caretCell,
          caretIndex: caret,
          selection,
          reducedMotion,
          face: stitchFace,
        }
      : null
  }, [caret, caretCell, held, layout, maxScroll, pieceGeometry, placeholder, reducedMotion, selection, stitchFace, text])

  useEffect(() => {
    if (!fontReady || !canvasRef.current) return undefined
    const renderer = new LaceRenderer(canvasRef.current)
    renderer.resize(viewport.width, viewport.height, geometry)
    rendererRef.current = renderer
  }, [fontReady, geometry, viewport.height, viewport.width])

  useEffect(() => {
    // The lace keeps painting under the README veil, so it is all there to
    // fade back in when README closes.
    if (!fontReady) return undefined
    let frame = 0

    const paint = (now) => {
      const scene = sceneRef.current
      const renderer = rendererRef.current
      if (scene && renderer) {
        scene.births = birthsRef.current
        scene.ghosts = ghostsRef.current
        // Read the scroll position every frame so the lace moves with the
        // page smoothly instead of in steps. Scrolling README leaves it be.
        scene.scrollY = readmeOpen ? (scene.scrollY ?? 0) : (mainRef.current?.scrollTop ?? 0)
        scene.hideWriting =
          document.querySelector('.ph-project-header a[aria-expanded]')?.getAttribute('aria-expanded') === 'true'
        renderer.draw(scene, now)
        // The page fades in as one piece once the lace has a first frame,
        // instead of the header and the lace popping in one after another.
        document.documentElement.dataset.laceReady = ''
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
    const scroller = mainRef.current
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [caret, fontReady, geometry, readmeOpen, reducedMotion, selection, text])

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
    const scroller = mainRef.current
    if (!scroller) return
    const scrollRows = scroller.scrollTop / geometry.cell
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
      scroller.scrollTo({
        top: lastLine
          ? scroller.scrollHeight
          : (caretBottom - geometry.rows + 3) * geometry.cell,
      })
    } else if (caretTop - scrollRows < headerRows + 1) {
      scroller.scrollTo({ top: Math.max(0, caretTop - headerRows - 1) * geometry.cell })
    }
  }, [caretCell.line, geometry, layout, placeholder])

  // Pull every stitch out, last letter first, and start again.
  const unstitchAll = () => {
    const input = inputRef.current
    setText('')
    setCaret(0)
    setSelection(null)
    input?.focus({ preventScroll: true })
  }

  // Copy the writing as plain text, and say so for a moment.
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef(0)
  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])
  const copyText = async () => {
    const input = inputRef.current
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Older browsers: copy from the hidden input itself.
      input?.select()
      document.execCommand('copy')
      input?.setSelectionRange(input.value.length, input.value.length)
    }
    input?.focus({ preventScroll: true })
    setCopied(true)
    window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600)
  }

  const syncCaret = (input) => {
    const offset = input.selectionDirection === 'backward'
      ? input.selectionStart
      : input.selectionEnd
    setCaret(codePointLength(input.value.slice(0, offset)))
    const start = codePointLength(input.value.slice(0, input.selectionStart))
    const end = codePointLength(input.value.slice(0, input.selectionEnd))
    setSelection((current) =>
      start < end
        ? current?.start === start && current?.end === end
          ? current
          : { start, end }
        : null,
    )
  }

  // The input's offset for an insertion point counted in characters.
  const offsetOf = (index) => Array.from(text).slice(0, index).join('').length

  // Map a pointer position to an insertion point in the writing, if any.
  const hitTest = (clientX, clientY) => {
    if (!layout || placeholder) return null
    const scrollRows = Math.min(mainRef.current?.scrollTop ?? 0, maxScroll) / geometry.cell
    const col = clientX / geometry.cell - geometry.textLeft
    const row = clientY / geometry.cell - geometry.textTop + scrollRows
    const x = clientX / geometry.cell
    const y = clientY / geometry.cell + scrollRows
    const { inner } = pieceGeometry
    const insideBorder =
      x >= inner.left && x <= inner.right + 1 && y >= inner.top && y <= inner.bottom + 1
    return insideBorder ? caretIndexAt(layout, geometry, col, row) : null
  }

  // A right click slips the hidden input under the pointer, so the
  // browser's own menu (Cut, Copy, Paste, Select All) acts on the writing.
  // It goes back out of the way once the pointer moves on after the menu.
  const menuRef = useRef('')
  const openMenu = (event) => {
    const input = inputRef.current
    if (!input) return
    const index = hitTest(event.clientX, event.clientY)
    const inside = selection && index !== null && index >= selection.start && index <= selection.end
    if (index !== null && !inside) {
      const offset = offsetOf(index)
      input.setSelectionRange(offset, offset)
      syncCaret(input)
    }
    input.style.left = `${event.clientX}px`
    input.style.top = `${event.clientY}px`
    input.classList.add('lace-input-menu')
    input.focus({ preventScroll: true })
    menuRef.current = 'open'
  }
  const closeMenu = () => {
    const input = inputRef.current
    if (!input || !menuRef.current) return
    input.classList.remove('lace-input-menu')
    input.style.left = ''
    input.style.top = ''
    menuRef.current = ''
  }
  useEffect(() => {
    const onMove = () => { if (menuRef.current === 'shown') closeMenu() }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('keydown', closeMenu, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('keydown', closeMenu, true)
    }
  })

  // Dragging across the writing with a mouse selects it.
  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button === 2) {
      openMenu(event)
      return
    }
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const index = hitTest(event.clientX, event.clientY)
    if (index === null) return
    dragRef.current = { anchor: index, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerUp = (event) => {
    const input = inputRef.current
    const drag = dragRef.current
    dragRef.current = null
    if (!input || event.button !== 0) return
    input.focus({ preventScroll: true })
    if (drag?.moved) return
    const index = hitTest(event.clientX, event.clientY)
    if (index === null) return
    const offset = offsetOf(index)
    input.setSelectionRange(offset, offset)
    syncCaret(input)
  }

  const onPointerMove = (event) => {
    if (!mainRef.current) return
    const index = hitTest(event.clientX, event.clientY)
    const drag = dragRef.current
    mainRef.current.style.cursor = index !== null || drag ? 'text' : 'default'
    const input = inputRef.current
    if (!drag || !input || index === null || (!drag.moved && index === drag.anchor)) return
    drag.moved = true
    const [from, to] = index < drag.anchor ? [index, drag.anchor] : [drag.anchor, index]
    input.setSelectionRange(offsetOf(from), offsetOf(to), index < drag.anchor ? 'backward' : 'forward')
    syncCaret(input)
  }

  return (
    <>
      <ProjectHeader readme={readme} />
      <button
        type="button"
        // The header's own label style, so it matches helenhsong.com.
        className="lace-unstitch ph-label w-fit cursor-pointer text-xs leading-[150%] font-['iAWriterMonoV-Regular','iA_Writer_Mono_V',system-ui,sans-serif] transition-colors focus:outline-none focus-visible:outline-none"
        onMouseDown={(event) => event.preventDefault()}
        onClick={unstitchAll}
        disabled={!text}
      >
        Unstitch all
      </button>
      <button
        type="button"
        className="lace-copy ph-label w-fit cursor-pointer text-xs leading-[150%] font-['iAWriterMonoV-Regular','iA_Writer_Mono_V',system-ui,sans-serif] transition-colors focus:outline-none focus-visible:outline-none"
        onMouseDown={(event) => event.preventDefault()}
        onClick={copyText}
        disabled={!text}
        aria-live="polite"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
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
        onContextMenu={() => { if (menuRef.current) menuRef.current = 'shown' }}
        // Once the menu is done, a click here belongs to the lace below.
        onMouseDown={(event) => { if (menuRef.current) event.preventDefault() }}
        onPointerDown={(event) => {
          if (!menuRef.current) return
          closeMenu()
          onPointerDown(event)
        }}
        onPointerUp={onPointerUp}
        aria-label="Text to stitch"
        autoCapitalize="sentences"
        autoFocus
        maxLength={12000}
        spellCheck={false}
      />
      {/* The page scrolls in this full-window layer over the lace, so its
          thin scrollbar floats on the lace instead of taking a strip of the
          window or pushing anything aside. */}
      <main
        ref={mainRef}
        className="lace-page"
        aria-busy={!fontReady}
        // Keep focus in the hidden input; clicks only move the insertion
        // point when they land on the writing.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
      >
        <div style={{ height: `${documentHeight}px` }} />
      </main>
    </>
  )
}

export default App
