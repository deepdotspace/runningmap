/** Geometry helpers — great-circle distance, bounds, and along-path sampling. */

import type { LatLng } from './types'

/** Mean Earth radius in metres (IUGG). */
const EARTH_RADIUS_M = 6371008.8

/**
 * Metres per degree of latitude (mean). Also used as a local equirectangular
 * scale for small-area lng projection (good to a few metres over km-scale boxes).
 */
export const M_PER_DEG = 111320

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI

/** Great-circle distance between two coordinates, in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total length of a polyline, in metres. */
export function pathDistance(coords: LatLng[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) {
    total += haversine(coords[i - 1], coords[i])
  }
  return total
}

/**
 * [west, south, east, north] bounding box, or null for an empty list.
 *
 * Longitude is antimeridian-aware: a route straddling the ±180° line would, with
 * a naive min/max, produce a box spanning almost the whole globe. When the naive
 * span exceeds 180° we also try framing the longitudes unwrapped into [0, 360)
 * and keep whichever framing is narrower — so the box hugs the route. MapLibre's
 * `fitBounds` accepts an east value > 180 (an unwrapped longitude).
 */
export function bounds(coords: LatLng[]): [number, number, number, number] | null {
  if (coords.length === 0) return null
  let s = coords[0].lat
  let n = coords[0].lat
  let w = coords[0].lng
  let e = coords[0].lng
  for (const c of coords) {
    if (c.lat < s) s = c.lat
    if (c.lat > n) n = c.lat
    if (c.lng < w) w = c.lng
    if (c.lng > e) e = c.lng
  }
  if (e - w > 180) {
    let w2 = Infinity
    let e2 = -Infinity
    for (const c of coords) {
      const lng = c.lng < 0 ? c.lng + 360 : c.lng
      if (lng < w2) w2 = lng
      if (lng > e2) e2 = lng
    }
    if (e2 - w2 < e - w) {
      w = w2
      e = e2
    }
  }
  return [w, s, e, n]
}

/**
 * Point reached by travelling `distanceMeters` from `origin` along a compass
 * `bearingDeg` (0 = north, 90 = east), on the sphere. Inverse of `haversine`.
 */
export function destination(
  origin: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): LatLng {
  const ang = distanceMeters / EARTH_RADIUS_M
  const brng = toRad(bearingDeg)
  const lat1 = toRad(origin.lat)
  const lng1 = toRad(origin.lng)
  const sinLat2 =
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng)
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)))
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * sinLat2,
    )
  // Normalise longitude back into [-180, 180].
  const lng = ((toDeg(lng2) + 540) % 360) - 180
  return { lat: toDeg(lat2), lng }
}

/**
 * A closed ring of `steps + 1` points approximating a circle of `radiusMeters`
 * around `center` (first point repeated as last). Used to render a true metric
 * accuracy circle — a MapLibre `circle` layer is sized in *pixels*, so a metre
 * radius can only be drawn as a polygon.
 */
export function circleRing(center: LatLng, radiusMeters: number, steps = 64): LatLng[] {
  const ring: LatLng[] = []
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(center, (360 * i) / steps, radiusMeters))
  }
  return ring
}

export interface SampledPoint extends LatLng {
  /** Cumulative distance from the start of the path, in metres. */
  dist: number
}

/**
 * Resample a polyline into at most `n` points spaced evenly *by distance*,
 * preserving the first and last vertices. Used to query elevation along the
 * route without exceeding the elevation API's per-request point budget.
 */
export function sampleAlong(coords: LatLng[], n: number): SampledPoint[] {
  if (coords.length === 0) return []
  if (coords.length === 1) return [{ ...coords[0], dist: 0 }]

  // Cumulative distance at each vertex.
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i += 1) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  }
  const total = cum[cum.length - 1]
  if (total === 0 || n <= 1) return [{ ...coords[0], dist: 0 }]

  // Resample to `n` points spaced evenly by distance — interpolating between
  // vertices when the path has fewer than `n` of them, downsampling otherwise.
  const count = Math.max(2, n)
  const out: SampledPoint[] = []
  let seg = 1
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1)
    while (seg < coords.length - 1 && cum[seg] < target) seg += 1
    const a = coords[seg - 1]
    const b = coords[seg]
    const segLen = cum[seg] - cum[seg - 1]
    const t = segLen === 0 ? 0 : (target - cum[seg - 1]) / segLen
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
      dist: target,
    })
  }
  return out
}
