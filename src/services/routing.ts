/**
 * Snap-to-roads routing via a public Valhalla instance (FOSSGIS by default).
 *
 * Why Valhalla and not OSRM: the public OSRM demo servers
 * (router.project-osrm.org, routing.openstreetmap.de/routed-*) frequently hang
 * or return nothing, which is what made routing feel slow and "fail a lot".
 * The FOSSGIS Valhalla instance answers in well under a second, is CORS-enabled,
 * needs no key, and supports pedestrian / bicycle / auto.
 *
 * Every request is bounded by a timeout so a slow upstream can never hang the
 * UI — on failure the caller falls back to a straight line.
 */

import { decodePolyline } from '../lib/polyline'
import type { LatLng } from '../lib/types'
import { ROUTING_TIMEOUT_MS, ROUTING_URL } from './config'
import type { MeasuredRoute, RouteLeg, RoutingService, SnapMode } from './types'

/** Our travel modes → Valhalla costing models. */
const COSTING: Record<SnapMode, string> = {
  foot: 'pedestrian',
  bike: 'bicycle',
  car: 'auto',
}

// Below this lat/lng delta (~1 cm) an anchor is treated as coincident with the
// snapped shape endpoint, so we don't add a degenerate zero-length stub vertex.
const COINCIDENT_EPS = 1e-7

function samePoint(p: LatLng, q: LatLng): boolean {
  return Math.abs(p.lat - q.lat) < COINCIDENT_EPS && Math.abs(p.lng - q.lng) < COINCIDENT_EPS
}

/**
 * Bookend a snapped shape with the exact requested anchors. Valhalla's shape
 * starts/ends at the nearest *routable* point to a/b, which can sit several
 * metres off the point the user actually clicked — so the rendered line would
 * stop short of its waypoint dot. Prepending `a` / appending `b` makes the leg
 * meet its dots (a short straight stub when the anchor is off-road, nothing when
 * it's already on one). This is what `RouteLeg.coords` documents ("inclusive of
 * both endpoints"); it's most visible on a closed loop, where the start/finish
 * dot otherwise floats between two converging snapped ends.
 */
function bookend(a: LatLng, shape: LatLng[], b: LatLng): LatLng[] {
  if (shape.length === 0) return [a, b]
  const out = shape.slice()
  if (!samePoint(a, out[0])) out.unshift(a)
  if (!samePoint(b, out[out.length - 1])) out.push(b)
  return out
}

interface ValhallaResponse {
  trip?: {
    status: number
    summary?: { length: number; time?: number }
    legs?: Array<{ shape: string; summary?: { length: number; time?: number } }>
  }
}

export class ValhallaRoutingService implements RoutingService {
  constructor(
    private readonly baseUrl: string = ROUTING_URL,
    private readonly timeoutMs: number = ROUTING_TIMEOUT_MS,
  ) {}

  /** POST a `/route` request for `locations`, bounded by the caller's signal and
   *  a hard timeout so a slow upstream can never hang the UI. Throws on failure. */
  private async fetchTrip(
    locations: LatLng[],
    mode: SnapMode,
    signal?: AbortSignal,
  ): Promise<NonNullable<ValhallaResponse['trip']>> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await fetch(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: locations.map((p) => ({ lat: p.lat, lon: p.lng })),
          costing: COSTING[mode],
          units: 'kilometers',
          directions_type: 'none',
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Valhalla ${res.status}`)
      const trip = ((await res.json()) as ValhallaResponse).trip
      if (!trip || trip.status !== 0) throw new Error('Valhalla: no route')
      return trip
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async snap(mode: SnapMode, a: LatLng, b: LatLng, signal?: AbortSignal): Promise<RouteLeg> {
    const trip = await this.fetchTrip([a, b], mode, signal)
    const leg = trip.legs?.[0]
    if (!leg?.shape) throw new Error('Valhalla: no route')

    // Valhalla encodes shapes with precision 6 (not Google's default 5).
    // Bookend with the exact anchors so the leg meets its waypoint dots (the
    // snapped shape alone stops at the nearest road point — see `bookend`).
    const coords = bookend(a, decodePolyline(leg.shape, 6), b)
    const km = leg.summary?.length ?? trip.summary?.length ?? 0
    // Valhalla reports per-leg/trip time in seconds (mode-appropriate, e.g.
    // pedestrian walking speed) even with directions_type: 'none'.
    const seconds = leg.summary?.time ?? trip.summary?.time
    return { coords, distance: km * 1000, duration: seconds }
  }

  async planMeasure(mode: SnapMode, points: LatLng[], signal?: AbortSignal): Promise<MeasuredRoute> {
    if (points.length < 2) return { meters: 0, legs: [] }
    // The whole ordered route in ONE request. Its leg total equals the sum of the
    // per-pair snaps `useRoute` runs, so this is a faithful, cheap preview of a
    // planned route's length — AND we keep each leg's snapped geometry so the
    // caller can place vertices on roads and seed the route without re-snapping.
    // No `bookend` here: these legs feed on-road vertices, so there's no off-road
    // anchor to stub out to (that's the per-click `snap` case, not this one).
    const trip = await this.fetchTrip(points, mode, signal)
    const legs: RouteLeg[] = (trip.legs ?? []).map((leg) => {
      // A leg without a shape is a malformed response — throw (like `snap`) so
      // `planRoute`'s try/catch falls back rather than decoding `undefined`.
      if (!leg.shape) throw new Error('Valhalla: leg missing shape')
      const km = leg.summary?.length ?? 0
      return {
        coords: decodePolyline(leg.shape, 6),
        distance: km * 1000,
        duration: leg.summary?.time,
      }
    })
    return { meters: (trip.summary?.length ?? 0) * 1000, legs }
  }
}

export const routingService: RoutingService = new ValhallaRoutingService()
