/**
 * Draw-a-shape panel — get a route shaped like a real icon, centred on the
 * current map view.
 *
 * Two free sources (no AI, no DeepSpace credits):
 *   • Quick presets  → the curated built-in shapes (instant, offline).
 *   • Icon search    → type a word, search the Iconify library, pick an icon;
 *     its silhouette is traced into the route. Far more recognisable than asking
 *     an LLM to invent coordinates.
 *
 * Output: shapes always trace the **exact outline** — straight (manual)
 * segments following the silhouette precisely. Road-snapping a silhouette
 * distorts it badly (a dog stops looking like a dog), so it's deliberately not
 * offered here; the planner's per-segment mode controls can still snap a leg
 * later if the user really wants to.
 *
 * This panel only produces a `RouteCore`; the planner confirms, loads, and fits
 * it, then lets the user edit any points.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, PenTool, Search, X } from 'lucide-react'
import { shapeNames, SHAPE_LIBRARY, type NormalizedShape } from '../../lib/shapes'
import { searchIcons, fetchIconShape, type IconResult } from '../../services/icons'
import { placeShape } from '../../lib/shape-geo'
import { shapeToRouteCore } from '../../lib/shape-route'
import type { LatLng, RouteCore, Unit } from '../../lib/types'

/** How a drawn route was produced — surfaced to the user after drawing. */
export interface ShapeDrawMeta {
  source: 'library' | 'icon'
  word: string
}

interface ShapePanelProps {
  /** Current map centre — the shape is drawn around it. */
  getCenter: () => LatLng
  /** Hand the built route + how it was made to the planner (it confirms + loads). */
  onDraw: (core: RouteCore, meta: ShapeDrawMeta) => void
  unit: Unit
}

const SIZE_MIN_KM = 0.5
const SIZE_MAX_KM = 6
const EXACT_WAYPOINTS = 80

export function ShapePanel({ getCenter, onDraw, unit }: ShapePanelProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IconResult[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle')
  const [tracingId, setTracingId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [sizeKm, setSizeKm] = useState(2.5)
  const [rotationDeg, setRotationDeg] = useState(0)

  const searchAbort = useRef<AbortController | null>(null)
  const traceAbort = useRef<AbortController | null>(null)

  // Abort any in-flight network on unmount.
  useEffect(
    () => () => {
      searchAbort.current?.abort()
      traceAbort.current?.abort()
    },
    [],
  )

  // Debounced icon search (mirrors SearchBox).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearchStatus('idle')
      return
    }
    const ctrl = new AbortController()
    searchAbort.current = ctrl
    const timer = setTimeout(() => {
      setSearchStatus('loading')
      searchIcons(q, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return
          setResults(res)
          setSearchStatus(res.length === 0 ? 'empty' : 'idle')
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSearchStatus('error')
        })
    }, 400)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [query])

  const draw = (shape: NormalizedShape, source: ShapeDrawMeta['source']) => {
    const points = placeShape(shape, getCenter(), sizeKm * 1000, rotationDeg)
    // Always the exact outline: manual segments trace the silhouette precisely.
    // `mode: 'manual'` makes `shapeToRouteCore` fill `modes` with `'manual'`, and
    // `useRoute` skips manual gaps (`if (mode === 'manual') continue`), so a drawn
    // shape fires zero snap calls and never gets distorted by road-snapping.
    const core = shapeToRouteCore(points, {
      unit,
      mode: 'manual',
      maxWaypoints: EXACT_WAYPOINTS,
    })
    onDraw(core, { source, word: shape.name })
  }

  const pickIcon = (icon: IconResult) => {
    if (tracingId) return
    traceAbort.current?.abort()
    const ctrl = new AbortController()
    traceAbort.current = ctrl
    setTracingId(icon.id)
    setErrorMsg('')
    fetchIconShape(icon.id, ctrl.signal, EXACT_WAYPOINTS)
      .then((shape) => {
        if (ctrl.signal.aborted) return
        setTracingId(null)
        if (!shape) {
          setErrorMsg('Couldn’t trace that icon — try another (solid/filled icons work best).')
          return
        }
        draw({ ...shape, name: query.trim() || shape.name }, 'icon')
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setTracingId(null)
        setErrorMsg('Couldn’t trace that icon — try another.')
      })
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="shape-toggle"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-sm text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-card"
      >
        <PenTool className="h-4 w-4 text-primary" aria-hidden />
        Draw a shape
      </button>
    )
  }

  return (
    <div
      data-testid="shape-panel"
      className="pointer-events-auto w-72 max-w-[80vw] rounded-2xl border border-border bg-card/90 p-3 shadow-xl backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <PenTool className="h-4 w-4 text-primary" aria-hidden />
          Draw a shape
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            searchAbort.current?.abort()
            traceAbort.current?.abort()
            setOpen(false)
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick presets — instant, offline, no network */}
      <span className="mb-1 block text-xs text-muted-foreground">Quick shapes</span>
      <div className="mb-3 flex flex-wrap gap-1">
        {shapeNames().map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => draw(SHAPE_LIBRARY[name], 'library')}
            className="rounded-md bg-secondary px-2 py-1 text-xs capitalize text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            {name}
          </button>
        ))}
      </div>

      {/* Icon search */}
      <div className="mb-1 flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 focus-within:border-primary">
        {searchStatus === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <input
          data-testid="shape-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (errorMsg) setErrorMsg('')
          }}
          placeholder="Search icons: dog, cat, tree…"
          aria-label="Search icons"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Free icon search (no AI / no credits). Solid, filled icons trace best.
      </p>

      {searchStatus === 'error' && (
        <p className="mb-2 text-center text-sm text-warning">Search failed. Try again.</p>
      )}
      {searchStatus === 'empty' && (
        <p className="mb-2 text-center text-sm text-muted-foreground">
          No icons found — try a simpler word (e.g. “cat” instead of “hello kitty”).
        </p>
      )}
      {results.length > 0 && (
        <div
          data-testid="shape-results"
          className="mb-3 grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto"
        >
          {results.map((icon) => (
            <button
              key={icon.id}
              type="button"
              title={icon.id}
              onClick={() => pickIcon(icon)}
              disabled={tracingId != null}
              // White tile + dark glyph (THUMB_COLOR) so every icon is clearly
              // visible on the dark glass panel, not blended into the background.
              className="flex aspect-square items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
            >
              {tracingId === icon.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-500" aria-hidden />
              ) : (
                <img src={icon.svgUrl} alt={icon.name} className="h-full w-full" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Size + rotation (native range inputs — no Slider primitive in the UI kit) */}
      <label className="mb-2 block text-xs text-muted-foreground">
        <span className="mb-1 flex items-center justify-between">
          <span>Size</span>
          <span className="text-foreground">{sizeKm.toFixed(1)} km</span>
        </span>
        <input
          data-testid="shape-size"
          type="range"
          min={SIZE_MIN_KM}
          max={SIZE_MAX_KM}
          step={0.5}
          value={sizeKm}
          onChange={(e) => setSizeKm(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Shape size in kilometres"
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        <span className="mb-1 flex items-center justify-between">
          <span>Rotation</span>
          <span className="text-foreground">{rotationDeg}°</span>
        </span>
        <input
          type="range"
          min={0}
          max={345}
          step={15}
          value={rotationDeg}
          onChange={(e) => setRotationDeg(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Shape rotation in degrees"
        />
      </label>

      {errorMsg && <p className="mt-2 text-center text-sm text-warning">{errorMsg}</p>}
    </div>
  )
}
