/**
 * Plan-a-route seed geometry — generate ordered waypoints for a loop or an
 * out-and-back of a target distance, around a start point. Pure (no DOM, no
 * network): callers feed the result to `shapeToRouteCore` (mode `foot`) and the
 * existing `useRoute` snapping resolves each leg on real streets.
 *
 * Approximate by design: road-snapping inflates length (streets are longer than
 * a straight chord), so the geometric seed is sized a bit SHORTER than the
 * target via {@link ROAD_FACTOR}. The panel shows the target, the bottom bar
 * shows the actual snapped length, and the user can adjust or shuffle.
 */

import { destination } from './geo'
import type { LatLng } from './types'

export type PlanType = 'loop' | 'out-and-back'

/** Geometric seed is sized SHORTER than target; road-snapping inflates it back
 *  up. Empirical, documented as approximate. */
export const ROAD_FACTOR = 0.85

/** Smallest sensible loop vertex count — fewer reads as a polygon, not a loop. */
const MIN_POINTS = 6

/** Intermediate anchors along an out-and-back leg so snapping has a path to follow. */
const OUT_BACK_ANCHORS = 2

export interface PlanOptions {
  type: PlanType
  /** Compass bearing of the loop's far side / out-leg, for variety. Default 0 (north). */
  bearingDeg?: number
  /** Loop vertex count (more = rounder seed → snaps closer to a circle). Default 10. */
  points?: number
}

/**
 * Ordered seed waypoints for a planned route, starting (and for a loop, ending)
 * at `start`. Returns `[]` for a non-positive target.
 */
export function generatePlanWaypoints(
  start: LatLng,
  targetMeters: number,
  opts: PlanOptions,
): LatLng[] {
  if (!(targetMeters > 0)) return []
  const bearingDeg = opts.bearingDeg ?? 0
  return opts.type === 'loop'
    ? loopWaypoints(start, targetMeters, bearingDeg, opts.points ?? 10)
    : outAndBackWaypoints(start, targetMeters, bearingDeg)
}

/**
 * A regular polygon ring that passes through `start`. The loop's centre sits
 * `r` away along `bearingDeg`, so `start` lies on the ring at angle
 * `bearingDeg + 180` from that centre (NOT angle 0). We therefore traverse the
 * ring starting at `bearingDeg + 180`: the first vertex IS `start`, and we
 * append the IDENTICAL computed first vertex as the closing vertex so
 * `shapeToRouteCore`'s dedupe sees an exact lat/lng match and the loop closes
 * with no hairline gap (a second `destination()` call could differ by a float
 * epsilon).
 */
function loopWaypoints(start: LatLng, targetMeters: number, bearingDeg: number, points: number): LatLng[] {
  const n = Math.max(MIN_POINTS, Math.round(points))
  const r = (targetMeters * ROAD_FACTOR) / (2 * Math.PI)
  const center = destination(start, bearingDeg, r)
  const ring: LatLng[] = []
  for (let i = 0; i < n; i += 1) {
    ring.push(destination(center, bearingDeg + 180 + (360 * i) / n, r))
  }
  // Close the loop by reusing the exact first vertex (start) as the last one.
  ring.push(ring[0])
  return ring
}

/**
 * Out to `dest` (`targetMeters/2 · ROAD_FACTOR` along `bearingDeg`) via a couple
 * of evenly-spaced anchors, then back the same way to `start` — a genuine
 * retrace. `shapeToRouteCore` dedupes the consecutive duplicate at the
 * turnaround. The seed is kept short (few anchors) so `resampleWaypoints`
 * (even-by-index, before dedupe) can't drop the `dest` turnaround.
 */
function outAndBackWaypoints(start: LatLng, targetMeters: number, bearingDeg: number): LatLng[] {
  const half = (targetMeters / 2) * ROAD_FACTOR
  const out: LatLng[] = [start]
  // Evenly-spaced anchors from start toward dest, ending at dest itself.
  for (let i = 1; i <= OUT_BACK_ANCHORS + 1; i += 1) {
    out.push(destination(start, bearingDeg, (half * i) / (OUT_BACK_ANCHORS + 1)))
  }
  // Retrace: append the out-leg reversed (the shared turnaround dedupes away).
  const back = out.slice(0, -1).reverse()
  return [...out, ...back]
}
