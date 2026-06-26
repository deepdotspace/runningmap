import { describe, expect, it } from 'vitest'
import { bounds, circleRing, destination, haversine, pathDistance, sampleAlong } from './geo'

describe('geo', () => {
  it('measures one degree of longitude at the equator (~111 km)', () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })

  it('returns 0 for identical points', () => {
    expect(haversine({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0)
  })

  it('sums a path', () => {
    const total = pathDistance([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
    ])
    const leg = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(total).toBeCloseTo(leg * 2, 0)
  })

  it('computes bounds', () => {
    expect(
      bounds([
        { lat: 1, lng: -2 },
        { lat: 3, lng: 4 },
      ]),
    ).toEqual([-2, 1, 4, 3])
    expect(bounds([])).toBeNull()
  })

  it('keeps a tight box for routes straddling the antimeridian', () => {
    const box = bounds([
      { lat: 10, lng: 179.9 },
      { lat: 11, lng: -179.9 },
    ])
    expect(box).not.toBeNull()
    const [w, s, e, n] = box!
    // West/east are framed unwrapped (east may exceed 180) so the box spans the
    // ~0.2° gap across the date line, not ~360° the naive way.
    expect(e - w).toBeCloseTo(0.2, 5)
    expect(w).toBeCloseTo(179.9, 5)
    expect(e).toBeCloseTo(180.1, 5)
    expect(s).toBe(10)
    expect(n).toBe(11)
  })

  it('destination travels the requested distance along a bearing', () => {
    const origin = { lat: 40, lng: -74 }
    const north = destination(origin, 0, 1000)
    // Heading due north increases latitude and barely moves longitude.
    expect(north.lat).toBeGreaterThan(origin.lat)
    expect(north.lng).toBeCloseTo(origin.lng, 4)
    expect(haversine(origin, north)).toBeCloseTo(1000, 0)

    const east = destination(origin, 90, 500)
    expect(east.lng).toBeGreaterThan(origin.lng)
    expect(haversine(origin, east)).toBeCloseTo(500, 0)
  })

  it('builds a closed metric circle ring', () => {
    const center = { lat: 51.5, lng: -0.12 }
    const ring = circleRing(center, 250, 32)
    expect(ring).toHaveLength(33) // steps + 1
    // First and last points coincide (closed ring).
    expect(ring[0].lat).toBeCloseTo(ring[ring.length - 1].lat, 9)
    expect(ring[0].lng).toBeCloseTo(ring[ring.length - 1].lng, 9)
    // Every vertex sits ~radius metres from the centre.
    for (const p of ring) expect(haversine(center, p)).toBeCloseTo(250, 0)
  })

  it('samples N points preserving the endpoints', () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ]
    const s = sampleAlong(line, 5)
    expect(s).toHaveLength(5)
    expect(s[0].lat).toBeCloseTo(0)
    expect(s[0].lng).toBeCloseTo(0)
    expect(s[4].lng).toBeCloseTo(1)
    expect(s[0].dist).toBe(0)
    // distances are monotonically increasing
    for (let i = 1; i < s.length; i += 1) expect(s[i].dist).toBeGreaterThan(s[i - 1].dist)
  })
})
