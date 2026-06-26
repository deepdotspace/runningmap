/**
 * Plan a route whose ACTUAL road-snapped length is close to the target.
 *
 * A geometric seed (circle / out-and-back) snaps longer or shorter than its
 * straight-line size depending on the local street grid — a single fixed fudge
 * factor (the old `ROAD_FACTOR`) routinely missed by 30%+ (a 12 mi target could
 * snap to 16 mi). So instead we MEASURE the snapped length and rescale the seed
 * until it lands within tolerance. Snapped length is ~affine in seed size, so a
 * secant step off the two latest samples converges in a couple of rounds. One
 * routing request per iteration (the whole trip in a single `planMeasure`), and
 * we return the closest seed found — with its snapped legs — so the caller can
 * place the route on roads without a second snap pass.
 */

import { generatePlanWaypoints, type PlanType } from '../lib/route-plan'
import type { LatLng } from '../lib/types'
import { routingService } from './routing'
import type { RouteLeg, SnapMode } from './types'

export interface PlannedRoute {
  /** Ordered seed waypoints (feed to `buildPlannedRoute` with the legs below). */
  waypoints: LatLng[]
  /** Measured snapped length in metres, or 0 if it couldn't be measured. */
  meters: number
  /** Snapped geometry of each gap of the returned seed (empty if unmeasured). */
  legs: RouteLeg[]
}

/** Accept a seed once its snapped length is within ±5% of the target. */
const TOLERANCE = 0.05
/** Hard cap on measure→rescale rounds (each is one routing request). */
const MAX_ITERATIONS = 6
/** Clamp a single rescale step so a wild measurement can't make the seed run away. */
const MIN_STEP = 0.25
const MAX_STEP = 4

export interface PlanRouteArgs {
  center: LatLng
  targetMeters: number
  type: PlanType
  bearingDeg: number
  /** Travel mode the route will be snapped/committed with — measured the same. */
  mode: SnapMode
  signal?: AbortSignal
}

export async function planRoute(args: PlanRouteArgs): Promise<PlannedRoute> {
  const { center, targetMeters, type, bearingDeg, mode, signal } = args
  if (!(targetMeters > 0)) return { waypoints: [], meters: 0, legs: [] }

  // `feed` is the target fed to the seed generator; we scale it (not the real
  // target) each round to grow/shrink the geometry toward the measured goal.
  let feed = targetMeters
  // Previous (feed, meters) sample, for the secant step. -1 = none yet.
  let prevFeed = -1
  let prevMeters = -1
  let best: PlannedRoute | null = null

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const waypoints = generatePlanWaypoints(center, feed, { type, bearingDeg })
    if (waypoints.length < 2) break

    let meters: number
    let legs: RouteLeg[]
    try {
      const measured = await routingService.planMeasure(mode, waypoints, signal)
      meters = measured.meters
      legs = measured.legs
    } catch {
      // Measuring failed (network/abort) — fall back to the best seed so far,
      // or this unmeasured seed so the user still gets a route.
      return best ?? { waypoints, meters: 0, legs: [] }
    }
    if (!(meters > 0)) return best ?? { waypoints, meters: 0, legs: [] }

    const candidate: PlannedRoute = { waypoints, meters, legs }
    if (!best || Math.abs(meters - targetMeters) < Math.abs(best.meters - targetMeters)) {
      best = candidate
    }
    if (Math.abs(meters - targetMeters) / targetMeters <= TOLERANCE) return candidate

    // Next feed: secant interpolation across the two latest samples (snapped
    // length is ~affine in feed, so this hits the target faster than a plain
    // ratio and corrects for the road network's roughly size-independent
    // offset). Fall back to the ratio for the first round / a flat slope.
    let nextFeed: number
    if (prevFeed > 0 && Math.abs(meters - prevMeters) > 1) {
      nextFeed = feed + ((targetMeters - meters) * (feed - prevFeed)) / (meters - prevMeters)
    } else {
      nextFeed = feed * (targetMeters / meters)
    }
    const stepped = Math.min(MAX_STEP, Math.max(MIN_STEP, nextFeed / feed))
    prevFeed = feed
    prevMeters = meters
    feed *= stepped
  }
  return best ?? { waypoints: [], meters: 0, legs: [] }
}
