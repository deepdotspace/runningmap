import { describe, expect, it } from 'vitest'
import { generatePlanWaypoints, ROAD_FACTOR } from './route-plan'
import { haversine, pathDistance } from './geo'
import { resampleWaypoints } from './shape-route'
import type { LatLng } from './types'

const START: LatLng = { lat: 40.7128, lng: -74.006 }

const finite = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng)

describe('generatePlanWaypoints — loop', () => {
  it('closes the loop: first ≈ last ≈ start', () => {
    const pts = generatePlanWaypoints(START, 5000, { type: 'loop', bearingDeg: 0 })
    const first = pts[0]
    const last = pts[pts.length - 1]
    // First vertex rides on the ring back at start (sphere round-trip → sub-metre
    // float drift, so precision 5 ≈ 1 m, not bit-exact).
    expect(first.lat).toBeCloseTo(START.lat, 5)
    expect(first.lng).toBeCloseTo(START.lng, 5)
    // The closing copy must be BIT-identical to the first so dedupe closes it.
    expect(last.lat).toBe(first.lat)
    expect(last.lng).toBe(first.lng)
  })

  it('emits points + 1 vertices (closing copy) with finite coords', () => {
    const pts = generatePlanWaypoints(START, 5000, { type: 'loop', bearingDeg: 30, points: 10 })
    expect(pts).toHaveLength(11)
    expect(pts.every(finite)).toBe(true)
  })

  it('clamps points to a floor of 6', () => {
    const pts = generatePlanWaypoints(START, 5000, { type: 'loop', points: 3 })
    expect(pts).toHaveLength(7) // 6 vertices + closing copy
  })

  it('rotates with bearing but always starts at start', () => {
    const a = generatePlanWaypoints(START, 5000, { type: 'loop', bearingDeg: 0 })
    const b = generatePlanWaypoints(START, 5000, { type: 'loop', bearingDeg: 90 })
    // Both start at start (sub-metre float drift from the sphere round-trip).
    expect(a[0].lat).toBeCloseTo(START.lat, 5)
    expect(a[0].lng).toBeCloseTo(START.lng, 5)
    expect(b[0].lat).toBeCloseTo(START.lat, 5)
    expect(b[0].lng).toBeCloseTo(START.lng, 5)
    // The far side (opposite vertex) differs because the loop is rotated.
    const mid = Math.floor((a.length - 1) / 2)
    expect(haversine(a[mid], b[mid])).toBeGreaterThan(100)
  })

  it('seed perimeter matches the inscribed-polygon formula 2·n·r·sin(π/n)', () => {
    const points = 10
    const target = 5000
    const pts = generatePlanWaypoints(START, target, { type: 'loop', bearingDeg: 0, points })
    const r = (target * ROAD_FACTOR) / (2 * Math.PI)
    const expected = 2 * points * r * Math.sin(Math.PI / points)
    // Perimeter of the closed ring (includes closing copy → full loop).
    expect(pathDistance(pts)).toBeCloseTo(expected, -1)
    // And it is meaningfully under the circle circumference (target·ROAD_FACTOR).
    expect(pathDistance(pts)).toBeLessThan(target * ROAD_FACTOR)
  })
})

describe('generatePlanWaypoints — out-and-back', () => {
  it('farthest point is ≈ target/2 · ROAD_FACTOR from start, and survives resampling', () => {
    const target = 5000
    const pts = generatePlanWaypoints(START, target, { type: 'out-and-back', bearingDeg: 45 })
    const farthest = pts.reduce((m, p) => Math.max(m, haversine(START, p)), 0)
    expect(farthest).toBeCloseTo((target / 2) * ROAD_FACTOR, -1)

    // The turnaround must survive even-by-index downsampling at maxWaypoints=24.
    const resampled = resampleWaypoints(pts, 24)
    const farthestAfter = resampled.reduce((m, p) => Math.max(m, haversine(START, p)), 0)
    expect(farthestAfter).toBeCloseTo(farthest, 6)
  })

  it('returns to start and the back half mirrors the out half', () => {
    const pts = generatePlanWaypoints(START, 4000, { type: 'out-and-back', bearingDeg: 0 })
    // Even count (out + reversed-out without the shared turnaround), ends at start.
    expect(pts[0]).toEqual(START)
    const last = pts[pts.length - 1]
    expect(last.lat).toBeCloseTo(START.lat, 9)
    expect(last.lng).toBeCloseTo(START.lng, 9)
    // The path is a palindrome about its midpoint (a genuine retrace).
    for (let i = 0; i < pts.length; i += 1) {
      const mirror = pts[pts.length - 1 - i]
      expect(pts[i].lat).toBeCloseTo(mirror.lat, 9)
      expect(pts[i].lng).toBeCloseTo(mirror.lng, 9)
    }
  })
})

describe('generatePlanWaypoints — edge cases', () => {
  it('returns [] for a non-positive target', () => {
    expect(generatePlanWaypoints(START, 0, { type: 'loop' })).toEqual([])
    expect(generatePlanWaypoints(START, -100, { type: 'out-and-back' })).toEqual([])
  })

  it('stays finite for very small and very large targets', () => {
    for (const target of [50, 200_000]) {
      for (const type of ['loop', 'out-and-back'] as const) {
        const pts = generatePlanWaypoints(START, target, { type })
        expect(pts.length).toBeGreaterThanOrEqual(2)
        expect(pts.every(finite)).toBe(true)
        expect(pts.every((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)).toBe(true)
      }
    }
  })
})
