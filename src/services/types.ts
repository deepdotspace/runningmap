/** Service interfaces — every external dependency is reachable only through one
 * of these, so implementations can be swapped or mocked in tests. */

import type { LatLng, TravelMode } from '../lib/types'

export type SnapMode = Exclude<TravelMode, 'manual'>

export interface RouteLeg {
  /** Snapped path from a to b, inclusive of both endpoints. */
  coords: LatLng[]
  /** Length in metres (as reported by the router). */
  distance: number
  /** Estimated travel time in seconds for this leg, when the router reports it. */
  duration?: number
}

/** A measured multi-point route: total length plus each consecutive leg's snap. */
export interface MeasuredRoute {
  /** Total snapped length in metres (the trip summary). */
  meters: number
  /** One snapped leg per consecutive input pair (`points.length - 1` of them). */
  legs: RouteLeg[]
}

export interface RoutingService {
  /** Snap a straight a→b request onto the road/path network for `mode`. */
  snap(mode: SnapMode, a: LatLng, b: LatLng, signal?: AbortSignal): Promise<RouteLeg>
  /**
   * Snap an ordered multi-point route in ONE request, returning the total length
   * AND each consecutive leg's snapped geometry. The total equals the sum of the
   * per-pair {@link snap} legs, so it both previews a planned route's length and
   * yields the road geometry to seed it with (vertices on roads, no re-snap).
   */
  planMeasure(mode: SnapMode, points: LatLng[], signal?: AbortSignal): Promise<MeasuredRoute>
}

export interface ElevationService {
  /** Elevation in metres for each point, index-aligned with the input. */
  lookup(points: LatLng[], signal?: AbortSignal): Promise<number[]>
}

export interface GeoResult {
  label: string
  lat: number
  lng: number
}

export interface GeocodingService {
  /**
   * Free-text place search. When `near` is supplied, results are *biased*
   * toward that point (e.g. "McDonald's" returns the closest ones first)
   * without restricting the search — typing a specific city still works
   * worldwide.
   */
  search(query: string, signal?: AbortSignal, near?: LatLng): Promise<GeoResult[]>
}

export interface Place {
  /** Stable id (OSM type+id) for React keys. */
  id: string
  name: string
  lat: number
  lng: number
}

export interface PlacesService {
  /** POIs of interest (v1: parks) within `radiusMeters` of `center`. */
  nearby(center: LatLng, radiusMeters: number, signal?: AbortSignal): Promise<Place[]>
}
