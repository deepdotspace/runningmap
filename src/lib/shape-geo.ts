/**
 * Place a unit-space shape onto the map as real coordinates.
 *
 * The shape's points (x/y ∈ [0,1], y-up) are re-centred to [-0.5, 0.5], rotated,
 * scaled so the longest side spans `sizeMeters`, then projected to lat/lng around
 * `center` using the local equirectangular approximation (the shared `M_PER_DEG`
 * scale from `./geo`). Accurate to a few metres over the kilometre-scale boxes a
 * route shape occupies.
 */

import { M_PER_DEG } from './geo'
import type { LatLng } from './types'
import type { NormalizedShape } from './shapes'

/**
 * Project `shape` to an ordered list of coordinates centred on `center`.
 * `rotationDeg` is a standard math rotation in the unit plane — positive values
 * turn the shape counter-clockwise (x east, y north). Closed shapes repeat the
 * first point at the end so the route forms a loop.
 */
export function placeShape(
  shape: NormalizedShape,
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
): LatLng[] {
  const src = shape.closed && shape.points.length > 0
    ? [...shape.points, shape.points[0]]
    : shape.points
  if (src.length === 0) return []

  // Bounding box of the (unrepeated) points → centre + longest span.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of shape.points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const ox = (minX + maxX) / 2
  const oy = (minY + maxY) / 2

  const theta = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  // Guard the cosine so a shape near the poles can't divide by ~0.
  const cosLat = Math.max(1e-6, Math.cos((center.lat * Math.PI) / 180))

  return src.map((p) => {
    const nx = (p.x - ox) / span // → [-0.5, 0.5] across the longest side
    const ny = (p.y - oy) / span
    const rx = nx * cos - ny * sin
    const ry = nx * sin + ny * cos
    const dxM = rx * sizeMeters
    const dyM = ry * sizeMeters
    // Normalise the projected longitude back into [-180, 180] so a shape placed
    // near the ±180° line doesn't emit out-of-range coordinates.
    const lng = ((center.lng + dxM / (M_PER_DEG * cosLat) + 540) % 360) - 180
    return {
      lat: center.lat + dyM / M_PER_DEG,
      lng,
    }
  })
}
