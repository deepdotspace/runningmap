import { describe, expect, it } from 'vitest'
import { decodePolyline, encodePolyline } from './polyline'

describe('polyline', () => {
  // Google's canonical example.
  const points = [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

  it('encodes the canonical example', () => {
    expect(encodePolyline(points)).toBe(encoded)
  })

  it('decodes the canonical example', () => {
    const decoded = decodePolyline(encoded)
    expect(decoded).toHaveLength(3)
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i].lat, 5)
      expect(p.lng).toBeCloseTo(points[i].lng, 5)
    })
  })

  it('round-trips arbitrary coordinates', () => {
    const pts = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 48.8566, lng: 2.3522 },
      { lat: -33.8688, lng: 151.2093 },
    ]
    const out = decodePolyline(encodePolyline(pts))
    out.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i].lat, 5)
      expect(p.lng).toBeCloseTo(pts[i].lng, 5)
    })
  })

  it('handles an empty list', () => {
    expect(encodePolyline([])).toBe('')
    expect(decodePolyline('')).toEqual([])
  })
})
