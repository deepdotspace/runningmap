import { describe, expect, it } from 'vitest'
import { buildPlannedRoute, resampleWaypoints, shapeToRouteCore } from './shape-route'
import { deriveSegments, segSig, type SnappedGeom, totalDistance } from './route-model'
import type { LatLng } from './types'

const pts = (n: number): LatLng[] =>
  Array.from({ length: n }, (_, i) => ({ lat: i, lng: i * 2 }))

describe('resampleWaypoints', () => {
  it('returns the input unchanged when within budget', () => {
    const p = pts(5)
    expect(resampleWaypoints(p, 10)).toBe(p)
    expect(resampleWaypoints(p, 5)).toBe(p)
  })

  it('caps to maxN while preserving the first and last point', () => {
    const p = pts(100)
    const out = resampleWaypoints(p, 10)
    expect(out.length).toBe(10)
    expect(out[0]).toEqual(p[0])
    expect(out[out.length - 1]).toEqual(p[99])
  })
})

describe('shapeToRouteCore', () => {
  it('builds one mode per gap with the chosen mode + unit', () => {
    const core = shapeToRouteCore(pts(5), { unit: 'km', mode: 'foot' })
    expect(core.points.length).toBe(5)
    expect(core.modes.length).toBe(4)
    expect(core.modes.every((m) => m === 'foot')).toBe(true)
    expect(core.defaultMode).toBe('foot')
    expect(core.unit).toBe('km')
    // Each point gets a unique id.
    expect(new Set(core.points.map((p) => p.id)).size).toBe(5)
  })

  it('respects the waypoint cap', () => {
    const core = shapeToRouteCore(pts(80), { unit: 'mi', mode: 'foot', maxWaypoints: 20 })
    expect(core.points.length).toBe(20)
    expect(core.modes.length).toBe(19)
  })

  it('produces no gaps for a single point', () => {
    const core = shapeToRouteCore(pts(1), { unit: 'mi', mode: 'foot' })
    expect(core.points.length).toBe(1)
    expect(core.modes.length).toBe(0)
  })

  it('drops consecutive duplicate points (no zero-length gaps)', () => {
    const dup: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 }, // duplicate of previous
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 2 }, // duplicate of previous
    ]
    const core = shapeToRouteCore(dup, { unit: 'mi', mode: 'foot' })
    expect(core.points.length).toBe(3)
    expect(core.modes.length).toBe(2)
  })
})

describe('buildPlannedRoute', () => {
  // On-road snapped vertices the legs meet at.
  const Q0 = { lat: 10.0, lng: 20.0 }
  const Q1 = { lat: 10.1, lng: 20.1 }
  const Q2 = { lat: 10.2, lng: 20.05 }
  // Closing leg ends a hair off Q0 (separate Valhalla leg ≈ same snapped point).
  const Q0b = { lat: 10.0000004, lng: 20.0000004 }
  const leg = (coords: LatLng[], distance: number): SnappedGeom => ({ coords, distance })
  // A 3-gap loop: leg i ends where leg i+1 starts; last leg returns toward Q0.
  const loopLegs: SnappedGeom[] = [
    leg([Q0, { lat: 10.05, lng: 20.05 }, Q1], 1000),
    leg([Q1, { lat: 10.15, lng: 20.08 }, Q2], 1200),
    leg([Q2, { lat: 10.1, lng: 20.0 }, Q0b], 1100),
  ]
  // Geometric seed has the same vertex count as on-road (legs + 1), closed.
  const seed: LatLng[] = [
    { lat: 9, lng: 19 },
    { lat: 9.1, lng: 19.1 },
    { lat: 9.2, lng: 19.05 },
    { lat: 9, lng: 19 },
  ]

  it('relocates vertices onto the legs and seeds geom keyed by segSig', () => {
    const { core, geom } = buildPlannedRoute(seed, loopLegs, { unit: 'mi', mode: 'foot', closed: true })
    // Vertices are the on-road leg boundaries, not the geometric seed.
    expect(core.points[0]).toMatchObject({ lat: Q0.lat, lng: Q0.lng })
    expect(core.points[1]).toMatchObject({ lat: Q1.lat, lng: Q1.lng })
    expect(core.points[2]).toMatchObject({ lat: Q2.lat, lng: Q2.lng })
    // Loop closes bit-identically (closing copy forced to the first, not Q0b).
    expect(core.points[3].lat).toBe(core.points[0].lat)
    expect(core.points[3].lng).toBe(core.points[0].lng)
    // One seeded entry per gap, keyed by the committed vertices, carrying the leg.
    expect(geom).not.toBeNull()
    expect(geom?.size).toBe(3)
    for (let i = 0; i < core.modes.length; i += 1) {
      const sig = segSig(core.points[i], core.points[i + 1], core.modes[i])
      expect(geom?.get(sig)).toEqual({
        coords: loopLegs[i].coords,
        distance: loopLegs[i].distance,
        duration: undefined,
      })
    }
  })

  it('seeds geometry so the route renders at the measured length with no re-snap', () => {
    const { core, geom } = buildPlannedRoute(seed, loopLegs, { unit: 'mi', mode: 'foot', closed: true })
    // Overlaying the seed on the core yields the measured total and zero pending
    // gaps — i.e. the committed route needs no live snapping and its length is
    // exactly the sum of the measured legs (1000 + 1200 + 1100).
    const segs = deriveSegments(core, geom!)
    expect(segs.every((s) => s.pending === false)).toBe(true)
    expect(totalDistance(segs)).toBe(3300)
  })

  it('relocates an out-and-back (open) without forcing the last vertex onto the first', () => {
    const A = { lat: 30.0, lng: 40.0 }
    const B = { lat: 30.1, lng: 40.1 }
    const Cend = { lat: 30.05, lng: 40.2 }
    const obLegs: SnappedGeom[] = [
      leg([A, { lat: 30.05, lng: 40.05 }, B], 800),
      leg([B, { lat: 30.08, lng: 40.15 }, Cend], 900),
    ]
    const obSeed: LatLng[] = [
      { lat: 29, lng: 39 },
      { lat: 29.1, lng: 39.1 },
      { lat: 29.05, lng: 39.2 },
    ]
    const { core, geom } = buildPlannedRoute(obSeed, obLegs, { unit: 'mi', mode: 'foot', closed: false })
    expect(geom?.size).toBe(2)
    // Open route: the last vertex is the final leg's end, NOT the first vertex.
    expect(core.points[2]).toMatchObject({ lat: Cend.lat, lng: Cend.lng })
    expect(core.points[2].lat).not.toBe(core.points[0].lat)
  })

  it('falls back to the raw seed with no geom when legs are missing', () => {
    const { core, geom } = buildPlannedRoute(seed, [], { unit: 'mi', mode: 'foot', closed: true })
    expect(geom).toBeNull()
    expect(core.points[0]).toMatchObject({ lat: seed[0].lat, lng: seed[0].lng })
  })

  it('falls back when the leg count does not cover the seed gaps', () => {
    const { geom } = buildPlannedRoute(seed, loopLegs.slice(0, 2), { unit: 'mi', mode: 'foot', closed: true })
    expect(geom).toBeNull()
  })

  it('falls back when any leg lacks geometry', () => {
    const broken = [loopLegs[0], leg([], 0), loopLegs[2]]
    const { geom } = buildPlannedRoute(seed, broken, { unit: 'mi', mode: 'foot', closed: true })
    expect(geom).toBeNull()
  })
})
