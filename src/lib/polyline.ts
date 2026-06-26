/**
 * Google "Encoded Polyline Algorithm Format" (precision 5).
 * Compact, lossless-enough encoding of a coordinate list for share URLs.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

import type { LatLng } from './types'

function encodeSigned(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63))
    v >>>= 5
  }
  out.push(String.fromCharCode(v + 63))
}

export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision
  const out: string[] = []
  let prevLat = 0
  let prevLng = 0
  for (const p of points) {
    const lat = Math.round(p.lat * factor)
    const lng = Math.round(p.lng * factor)
    encodeSigned(lat - prevLat, out)
    encodeSigned(lng - prevLng, out)
    prevLat = lat
    prevLng = lng
  }
  return out.join('')
}

export function decodePolyline(str: string, precision = 5): LatLng[] {
  const factor = 10 ** precision
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const len = str.length

  // Read one varint (lat or lng delta). Throws on a truncated or out-of-range
  // sequence so callers (e.g. decodeRoute) can treat a corrupt `?r=` as invalid
  // rather than silently producing junk coordinates.
  const readDelta = (): number => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= len) throw new Error('decodePolyline: truncated input')
      byte = str.charCodeAt(index) - 63
      if (byte < 0 || byte > 0x3f) throw new Error('decodePolyline: invalid character')
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < len) {
    lat += readDelta()
    lng += readDelta()
    points.push({ lat: lat / factor, lng: lng / factor })
  }
  return points
}
