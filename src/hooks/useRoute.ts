/**
 * useRoute — the planner's state machine.
 *
 * Owns the `RouteCore` inside an undo/redo history, derives renderable
 * `Segment`s, and orchestrates async snap-to-roads requests for any non-manual
 * gap that doesn't yet have cached geometry. Drag interactions update the
 * present without spamming history: one snapshot is taken at the first move.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { haversine } from '../lib/geo'
import { createLimiter, type Limiter } from '../lib/limiter'
import {
  type HistoryState,
  canRedo as histCanRedo,
  canUndo as histCanUndo,
  initHistory,
  pushHistory,
  redo as histRedo,
  replacePresent,
  undo as histUndo,
} from '../lib/history'
import {
  addPoint,
  clearRoute,
  deletePoint,
  deriveSegments,
  emptyCore,
  type GeomCache,
  insertPoint,
  movePoint,
  outAndBack,
  returnToStart,
  reverse,
  routeCoords,
  segSig,
  setAllModes,
  setDefaultMode as setDefaultModeOp,
  setSegmentMode,
  setUnit as setUnitOp,
  totalDistance,
  totalDuration,
} from '../lib/route-model'
import type { LatLng, RouteCore, TravelMode, Unit } from '../lib/types'
import { routingService } from '../services/routing'
import type { SnapMode } from '../services/types'

// Max simultaneous snap requests to the routing server. The public Valhalla
// instance drops bursts, so we keep a modest cap and let the rest queue — this
// is what lets a many-waypoint shape snap fully instead of partially.
const MAX_CONCURRENT_SNAPS = 5

type Action =
  | { type: 'commit'; core: RouteCore }
  | { type: 'replace'; core: RouteCore }
  | { type: 'snapshot' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; core: RouteCore }

function reducer(h: HistoryState<RouteCore>, action: Action): HistoryState<RouteCore> {
  switch (action.type) {
    case 'commit':
      return pushHistory(h, action.core)
    case 'replace':
      return replacePresent(h, action.core)
    case 'snapshot':
      return pushHistory(h, h.present)
    case 'undo':
      return histUndo(h)
    case 'redo':
      return histRedo(h)
    case 'reset':
      return initHistory(action.core)
    default:
      return h
  }
}

export interface UseRouteResult {
  core: RouteCore
  segments: ReturnType<typeof deriveSegments>
  coords: LatLng[]
  totalMeters: number
  totalSeconds: number
  snapping: boolean
  canUndo: boolean
  canRedo: boolean
  // edits (history)
  addPointAt: (at: LatLng) => void
  deletePointAt: (index: number) => void
  setSegMode: (segIndex: number, mode: TravelMode) => void
  applyModeToAll: (mode: TravelMode) => void
  clear: () => void
  reverseRoute: () => void
  loopToStart: () => void
  outBack: () => void
  loadCore: (core: RouteCore) => void
  /**
   * Replace the route with `core` as an undoable history step (unlike loadCore,
   * which resets history). An optional pre-snapped `geom` cache (keyed by
   * `segSig`) is merged first so a route built with known geometry — e.g. a
   * planned route — renders at its measured length and fires no snap requests.
   */
  commitCore: (core: RouteCore, geom?: GeomCache) => void
  // prefs (no history)
  setDefaultMode: (mode: TravelMode) => void
  setUnit: (unit: Unit) => void
  // history
  undo: () => void
  redo: () => void
  // drag
  beginPointDrag: () => void
  dragPoint: (index: number, at: LatLng) => void
  endPointDrag: (index: number, at: LatLng) => void
  beginInsert: (segIndex: number, at: LatLng) => number
}

export function useRoute(initial?: RouteCore): UseRouteResult {
  const [hist, dispatch] = useReducer(
    reducer,
    undefined,
    () => initHistory(initial ?? emptyCore()),
  )
  const core = hist.present
  const coreRef = useRef(core)
  coreRef.current = core

  const [geom, setGeom] = useState<GeomCache>(() => new Map())
  const geomRef = useRef(geom)
  geomRef.current = geom
  // `inflight` tracks every gap we still want snapped — queued OR running. The
  // limiter caps how many actually hit the router at once so a many-waypoint
  // shape doesn't flood the public server (which then drops requests).
  const inflight = useRef<Map<string, AbortController>>(new Map())
  const limiterRef = useRef<Limiter | null>(null)
  if (!limiterRef.current) limiterRef.current = createLimiter(MAX_CONCURRENT_SNAPS)
  const [snapping, setSnapping] = useState(false)
  const pendingSnap = useRef(false)
  // True while a vertex (or a drag-to-insert) is being dragged. We move the
  // point on every frame for a live straight-line preview, but DON'T fire any
  // snap requests until the drag ends — otherwise every intermediate position
  // spawns a Valhalla request and the real result queues behind dozens of them.
  const dragging = useRef(false)

  const segments = useMemo(() => deriveSegments(core, geom), [core, geom])
  const coords = useMemo(() => routeCoords(segments), [segments])
  const totalMeters = useMemo(() => totalDistance(segments), [segments])
  const totalSeconds = useMemo(() => totalDuration(segments), [segments])

  // Snap any non-manual gap lacking cached geometry. In-flight requests for
  // segments that are still part of the route are NOT cancelled across edits —
  // only requests for segments that no longer exist get aborted. This avoids
  // the re-fetch churn that made routing feel slow when adding points quickly.
  useEffect(() => {
    // While a drag is in progress, show straight-line previews only — defer all
    // network snapping to the drag-end commit below.
    if (dragging.current) return

    const needed = new Map<string, { mode: SnapMode; a: LatLng; b: LatLng }>()
    for (let i = 0; i < core.modes.length; i += 1) {
      const mode = core.modes[i]
      if (mode === 'manual') continue
      const a = core.points[i]
      const b = core.points[i + 1]
      needed.set(segSig(a, b, mode), { mode, a, b })
    }

    // Abort requests for segments that no longer exist.
    for (const [sig, ctrl] of inflight.current) {
      if (!needed.has(sig)) {
        ctrl.abort()
        inflight.current.delete(sig)
      }
    }

    // Queue a request for each needed segment that isn't cached or already
    // queued/running. The limiter throttles how many run concurrently; segments
    // aborted before their slot opens see `ctrl.signal.aborted` and no-op.
    needed.forEach(({ mode, a, b }, sig) => {
      if (geomRef.current.has(sig) || inflight.current.has(sig)) return
      const ctrl = new AbortController()
      inflight.current.set(sig, ctrl)
      limiterRef.current!
        .run(() => {
          if (ctrl.signal.aborted) return Promise.resolve()
          return routingService
            .snap(mode, a, b, ctrl.signal)
            .then((leg) => {
              if (ctrl.signal.aborted) return
              setGeom((prev) => {
                const next = new Map(prev)
                next.set(sig, { coords: leg.coords, distance: leg.distance, duration: leg.duration })
                return next
              })
            })
            .catch(() => {
              if (ctrl.signal.aborted) return
              // Cache a straight-line fallback flagged as error (prevents retry-loop).
              setGeom((prev) => {
                const next = new Map(prev)
                next.set(sig, { coords: [a, b], distance: haversine(a, b), error: true })
                return next
              })
            })
        })
        .finally(() => {
          // Only clear if THIS controller still owns the slot. Guards the
          // abort-then-recreate-same-signature race: a stale aborted task must
          // not delete the entry belonging to its live replacement.
          if (inflight.current.get(sig) === ctrl) {
            inflight.current.delete(sig)
            setSnapping(inflight.current.size > 0)
          }
        })
    })

    setSnapping(inflight.current.size > 0)
  }, [core])

  // Abort any outstanding routing requests on unmount.
  useEffect(
    () => () => {
      for (const ctrl of inflight.current.values()) ctrl.abort()
      inflight.current.clear()
    },
    [],
  )

  const commit = useCallback((next: RouteCore) => dispatch({ type: 'commit', core: next }), [])
  const replace = useCallback((next: RouteCore) => dispatch({ type: 'replace', core: next }), [])

  const snapIfNeeded = useCallback(() => {
    if (pendingSnap.current) {
      dispatch({ type: 'snapshot' })
      pendingSnap.current = false
    }
  }, [])

  return {
    core,
    segments,
    coords,
    totalMeters,
    totalSeconds,
    snapping,
    canUndo: histCanUndo(hist),
    canRedo: histCanRedo(hist),

    addPointAt: useCallback((at) => commit(addPoint(coreRef.current, at)), [commit]),
    deletePointAt: useCallback((index) => commit(deletePoint(coreRef.current, index)), [commit]),
    setSegMode: useCallback(
      (segIndex, mode) => commit(setSegmentMode(coreRef.current, segIndex, mode)),
      [commit],
    ),
    applyModeToAll: useCallback((mode) => commit(setAllModes(coreRef.current, mode)), [commit]),
    clear: useCallback(() => commit(clearRoute(coreRef.current)), [commit]),
    reverseRoute: useCallback(() => commit(reverse(coreRef.current)), [commit]),
    loopToStart: useCallback(() => commit(returnToStart(coreRef.current)), [commit]),
    outBack: useCallback(() => commit(outAndBack(coreRef.current)), [commit]),
    loadCore: useCallback((next) => dispatch({ type: 'reset', core: next }), []),
    commitCore: useCallback(
      (next, geom) => {
        // Seed pre-snapped geometry BEFORE the commit dispatch. Both run in one
        // React batch, so geomRef is refreshed (carrying these sigs) before the
        // [core] snap effect runs — it then skips the seeded gaps entirely and
        // fires zero requests. Splitting these across two ticks would let the
        // effect snap before the seed lands.
        if (geom && geom.size > 0) setGeom((prev) => new Map([...prev, ...geom]))
        commit(next)
      },
      [commit],
    ),

    setDefaultMode: useCallback((mode) => replace(setDefaultModeOp(coreRef.current, mode)), [replace]),
    setUnit: useCallback((unit) => replace(setUnitOp(coreRef.current, unit)), [replace]),

    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),

    beginPointDrag: useCallback(() => {
      dragging.current = true
      pendingSnap.current = true
    }, []),
    dragPoint: useCallback(
      (index, at) => {
        snapIfNeeded()
        replace(movePoint(coreRef.current, index, at))
      },
      [replace, snapIfNeeded],
    ),
    endPointDrag: useCallback(
      (index, at) => {
        snapIfNeeded()
        // Clear the drag flag *before* the final replace so the snapping effect
        // runs once on the committed position and fires the real route request.
        dragging.current = false
        pendingSnap.current = false
        replace(movePoint(coreRef.current, index, at))
      },
      [replace, snapIfNeeded],
    ),
    beginInsert: useCallback((segIndex, at) => {
      const { core: next, index } = insertPoint(coreRef.current, segIndex, at)
      if (index < 0) return -1
      dispatch({ type: 'snapshot' })
      dragging.current = true
      dispatch({ type: 'replace', core: next })
      // Advance the working ref synchronously. Dispatches don't update coreRef
      // until the next render, but the drag's first mousemove can fire sooner —
      // without this, that move would build on the pre-insert core and silently
      // drop the just-inserted point on a fast drag.
      coreRef.current = next
      pendingSnap.current = false
      return index
    }, []),
  }
}
