/**
 * Turn placed shape coordinates into a `RouteCore` the planner can render and
 * snap. Every gap gets the chosen travel mode; `useRoute`'s existing snapping
 * effect then connects each consecutive pair along real streets.
 */

import { type GeomCache, type SnappedGeom, segSig } from './route-model'
import { genId, type LatLng, type RouteCore, type RoutePoint, type TravelMode, type Unit } from './types'

/** Default cap on shape waypoints → bounds the number of per-gap snap calls. */
export const DEFAULT_MAX_WAYPOINTS = 32

/**
 * Downsample `points` to at most `maxN`, evenly by index, always preserving the
 * first and last point. Returns the input unchanged when already within budget.
 * (A silent cap would read as "drew the whole shape" when it didn't — callers
 * keep shapes low-vertex so this rarely triggers; it's a safety bound on the
 * number of per-gap snap calls a dense shape can generate.)
 */
export function resampleWaypoints(points: LatLng[], maxN: number): LatLng[] {
  if (maxN < 2 || points.length <= maxN) return points
  const out: LatLng[] = []
  const last = points.length - 1
  for (let i = 0; i < maxN; i += 1) {
    out.push(points[Math.round((last * i) / (maxN - 1))])
  }
  return out
}

/**
 * Build a `RouteCore` from ordered coordinates. `modes.length` is always
 * `points.length - 1` (one mode per gap), matching the route model invariant.
 */
export function shapeToRouteCore(
  points: LatLng[],
  opts: { unit: Unit; mode: TravelMode; maxWaypoints?: number },
): RouteCore {
  const capped = resampleWaypoints(points, opts.maxWaypoints ?? DEFAULT_MAX_WAYPOINTS)
  // Drop consecutive identical points so we never build a zero-length gap (which
  // would fire a wasted snap request). AI-generated shapes can repeat a point.
  const deduped = capped.filter(
    (p, i) => i === 0 || p.lat !== capped[i - 1].lat || p.lng !== capped[i - 1].lng,
  )
  const routePoints: RoutePoint[] = deduped.map((p) => ({ id: genId(), lat: p.lat, lng: p.lng }))
  const modes: TravelMode[] =
    routePoints.length >= 2 ? Array(routePoints.length - 1).fill(opts.mode) : []
  return { points: routePoints, modes, defaultMode: opts.mode, unit: opts.unit }
}

/**
 * The on-road vertices of a measured route: each gap's snapped leg starts and
 * ends on a road, and consecutive legs meet (`legs[i].end === legs[i+1].start`),
 * so the vertex list is `[leg0.start, leg1.start, …, legN.end]` — one more than
 * the leg count. For a closed loop the final vertex is forced bit-identical to
 * the first so {@link shapeToRouteCore}'s dedupe still closes the ring. Returns
 * `[]` if any leg lacks geometry (caller falls back to the raw seed).
 */
function onRoadVertices(legs: readonly SnappedGeom[], closed: boolean): LatLng[] {
  if (legs.length === 0 || legs.some((l) => l.coords.length === 0)) return []
  const verts: LatLng[] = [legs[0].coords[0]]
  for (let i = 1; i < legs.length; i += 1) verts.push(legs[i].coords[0])
  const lastLeg = legs[legs.length - 1].coords
  verts.push(lastLeg[lastLeg.length - 1])
  if (closed) verts[verts.length - 1] = verts[0]
  return verts
}

/**
 * Build a planned route from a geometric seed and its measured snapped legs.
 * When the legs cover the seed, the route's vertices are RELOCATED onto the road
 * (killing the off-road "dart to the dot and back" stubs) and the snapped
 * geometry is returned as a pre-seed for the route's geom cache — so the
 * committed route renders the exact measured shape, its length equals the
 * measured total, and no per-gap re-snap (which can drop legs to short straight
 * lines on a busy public router) fires.
 *
 * Falls back to the raw geometric seed with NO pre-seed (live snapping, as
 * before) whenever the legs don't line up — empty geometry, or a vertex count
 * that resample/dedupe changed — so a bad measurement can never strand the user.
 */
export function buildPlannedRoute(
  seed: LatLng[],
  legs: readonly SnappedGeom[],
  opts: { unit: Unit; mode: TravelMode; closed: boolean; maxWaypoints?: number },
): { core: RouteCore; geom: GeomCache | null } {
  const onRoad = onRoadVertices(legs, opts.closed)
  const usable = onRoad.length === seed.length // legs === seed gaps, all non-empty
  const core = shapeToRouteCore(usable ? onRoad : seed, {
    unit: opts.unit,
    mode: opts.mode,
    maxWaypoints: opts.maxWaypoints,
  })
  // Only seed if the committed gaps line up 1:1 with the measured legs (resample
  // or a coincident-vertex dedupe can shift this — then we let it snap live).
  if (!usable || core.modes.length !== legs.length) return { core, geom: null }
  const geom: GeomCache = new Map()
  for (let i = 0; i < core.modes.length; i += 1) {
    const a = core.points[i]
    const b = core.points[i + 1]
    const leg = legs[i]
    geom.set(segSig(a, b, core.modes[i]), {
      coords: leg.coords,
      distance: leg.distance,
      duration: leg.duration,
    })
  }
  return { core, geom }
}
