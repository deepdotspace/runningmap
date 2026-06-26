/**
 * Pure operations on a `RouteCore`. Every function returns a new core (never
 * mutates) so it composes cleanly with the undo/redo history. Snapped geometry
 * is not handled here — see `deriveSegments` for the straight-line placeholders
 * and `useRoute` for async snapping.
 */

import { haversine } from './geo'
import {
  type LatLng,
  type RouteCore,
  type Segment,
  type TravelMode,
  type Unit,
  genId,
} from './types'

export function emptyCore(defaultMode: TravelMode = 'foot', unit: Unit = 'mi'): RouteCore {
  return { points: [], modes: [], defaultMode, unit }
}

/** Append a point. The new gap (if any) inherits the current default mode. */
export function addPoint(core: RouteCore, at: LatLng): RouteCore {
  const points = [...core.points, { id: genId(), lat: at.lat, lng: at.lng }]
  const modes = core.points.length >= 1 ? [...core.modes, core.defaultMode] : [...core.modes]
  return { ...core, points, modes }
}

/** Move an existing point (keeps its id and adjacent segment modes). */
export function movePoint(core: RouteCore, index: number, to: LatLng): RouteCore {
  if (index < 0 || index >= core.points.length) return core
  const points = core.points.map((p, i) =>
    i === index ? { ...p, lat: to.lat, lng: to.lng } : p,
  )
  return { ...core, points }
}

/**
 * Insert a point in the middle of segment `segIndex` (the gap between
 * points[segIndex] and points[segIndex+1]). Both resulting halves inherit the
 * original segment's mode. Returns the new core and the new point's index.
 */
export function insertPoint(
  core: RouteCore,
  segIndex: number,
  at: LatLng,
): { core: RouteCore; index: number } {
  if (segIndex < 0 || segIndex >= core.modes.length) return { core, index: -1 }
  const points = [...core.points]
  const modes = [...core.modes]
  const newIndex = segIndex + 1
  points.splice(newIndex, 0, { id: genId(), lat: at.lat, lng: at.lng })
  modes.splice(newIndex, 0, modes[segIndex])
  return { core: { ...core, points, modes }, index: newIndex }
}

/** Remove a point, merging the two adjacent gaps into one where applicable. */
export function deletePoint(core: RouteCore, index: number): RouteCore {
  const n = core.points.length
  if (index < 0 || index >= n) return core
  const points = [...core.points]
  const modes = [...core.modes]
  points.splice(index, 1)
  if (modes.length > 0) {
    // Drop the gap after the point, except for the last point where only the
    // gap before it exists. Interior removals keep modes[index-1] (the merge).
    const modeIndex = index === n - 1 ? index - 1 : index
    if (modeIndex >= 0 && modeIndex < modes.length) modes.splice(modeIndex, 1)
  }
  return { ...core, points, modes }
}

export function setSegmentMode(core: RouteCore, segIndex: number, mode: TravelMode): RouteCore {
  if (segIndex < 0 || segIndex >= core.modes.length) return core
  const modes = core.modes.map((m, i) => (i === segIndex ? mode : m))
  return { ...core, modes }
}

export function setDefaultMode(core: RouteCore, mode: TravelMode): RouteCore {
  return { ...core, defaultMode: mode }
}

/** Apply a mode to every existing segment *and* future ones. */
export function setAllModes(core: RouteCore, mode: TravelMode): RouteCore {
  return { ...core, defaultMode: mode, modes: core.modes.map(() => mode) }
}

export function setUnit(core: RouteCore, unit: Unit): RouteCore {
  return { ...core, unit }
}

export function clearRoute(core: RouteCore): RouteCore {
  return { ...core, points: [], modes: [] }
}

/** Reverse the direction of travel. */
export function reverse(core: RouteCore): RouteCore {
  return { ...core, points: [...core.points].reverse(), modes: [...core.modes].reverse() }
}

/** Append a closing leg back to the start point (loop the route). */
export function returnToStart(core: RouteCore): RouteCore {
  if (core.points.length < 2) return core
  const first = core.points[0]
  const points = [...core.points, { id: genId(), lat: first.lat, lng: first.lng }]
  const modes = [...core.modes, core.defaultMode]
  return { ...core, points, modes }
}

/** Append a mirrored return leg: A→B→C becomes A→B→C→B→A. */
export function outAndBack(core: RouteCore): RouteCore {
  if (core.points.length < 2) return core
  const returnPoints = core.points
    .slice(0, -1)
    .reverse()
    .map((p) => ({ id: genId(), lat: p.lat, lng: p.lng }))
  const returnModes = [...core.modes].reverse()
  return {
    ...core,
    points: [...core.points, ...returnPoints],
    modes: [...core.modes, ...returnModes],
  }
}

/**
 * Fallback travel speeds (metres/second) used to estimate time when the router
 * doesn't report one (manual segments, or a straight-line snap failure). Chosen
 * to match the routing engine's defaults so estimates blend with real legs:
 * walking ~5 km/h, cycling ~15 km/h, driving ~40 km/h (urban average).
 */
const MODE_SPEED_MPS: Record<TravelMode, number> = {
  foot: 1.39,
  bike: 4.17,
  car: 11.11,
  manual: 1.39,
}

/** Estimate travel seconds for a distance in metres under a given mode. */
export function estimateDuration(meters: number, mode: TravelMode): number {
  return meters / MODE_SPEED_MPS[mode]
}

/** Signature identifying a gap's geometry (endpoints + mode) for caching. */
export function segSig(a: LatLng, b: LatLng, mode: TravelMode): string {
  const r = (n: number) => n.toFixed(6)
  return `${mode}:${r(a.lat)},${r(a.lng)}:${r(b.lat)},${r(b.lng)}`
}

/** Straight-line placeholder segment. Manual segments are final; others pend. */
export function straightSegment(a: LatLng, b: LatLng, mode: TravelMode): Segment {
  const distance = haversine(a, b)
  return {
    mode,
    coords: [
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
    ],
    distance,
    duration: estimateDuration(distance, mode),
    pending: mode !== 'manual',
  }
}

/**
 * Snapped geometry for one gap — what the geom cache stores and
 * {@link deriveSegments} reads. `error` marks a straight-line fallback cached so
 * a failed snap isn't retried. Shared so the hook's cache and any pre-snapped
 * seed (e.g. a planned route) use one shape.
 */
export type SnappedGeom = { coords: LatLng[]; distance: number; duration?: number; error?: boolean }

/** A keyed map of snapped geometry, keyed by {@link segSig}. */
export type GeomCache = Map<string, SnappedGeom>

/**
 * Derive renderable segments from a core, overlaying any cached snapped
 * geometry. Cache entries that aren't present yield straight-line placeholders
 * flagged `pending` (manual segments are never pending).
 */
export function deriveSegments(core: RouteCore, cache: GeomCache): Segment[] {
  const segments: Segment[] = []
  for (let i = 0; i < core.modes.length; i += 1) {
    const a = core.points[i]
    const b = core.points[i + 1]
    const mode = core.modes[i]
    if (mode === 'manual') {
      segments.push(straightSegment(a, b, mode))
      continue
    }
    const hit = cache.get(segSig(a, b, mode))
    if (hit) {
      segments.push({
        mode,
        coords: hit.coords,
        distance: hit.distance,
        // Prefer the router's time; fall back to a mode-speed estimate.
        duration: hit.duration ?? estimateDuration(hit.distance, mode),
        pending: false,
        error: hit.error,
      })
    } else {
      segments.push(straightSegment(a, b, mode))
    }
  }
  return segments
}

/** Flattened geometry of the whole route (de-duplicating shared endpoints). */
export function routeCoords(segments: Segment[]): LatLng[] {
  const out: LatLng[] = []
  for (const seg of segments) {
    for (let i = 0; i < seg.coords.length; i += 1) {
      // Skip a segment's first point when it equals the previous segment's last.
      if (i === 0 && out.length > 0) {
        const last = out[out.length - 1]
        const c = seg.coords[0]
        if (last.lat === c.lat && last.lng === c.lng) continue
      }
      out.push(seg.coords[i])
    }
  }
  return out
}

export function totalDistance(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + s.distance, 0)
}

/** Total estimated travel time of the whole route, in seconds. */
export function totalDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + s.duration, 0)
}

/**
 * The route's primary travel mode — the one covering the most segments. Used to
 * label a saved route as a walk / ride / drive. Defaults to the core's
 * `defaultMode` for an empty route.
 */
export function dominantMode(core: RouteCore): TravelMode {
  if (core.modes.length === 0) return core.defaultMode
  const counts = new Map<TravelMode, number>()
  for (const m of core.modes) counts.set(m, (counts.get(m) ?? 0) + 1)
  let best: TravelMode = core.modes[0]
  let bestN = 0
  for (const [m, n] of counts) {
    if (n > bestN) {
      best = m
      bestN = n
    }
  }
  return best
}
