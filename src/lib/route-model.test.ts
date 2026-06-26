import { describe, expect, it } from 'vitest'
import {
  addPoint,
  clearRoute,
  deletePoint,
  deriveSegments,
  dominantMode,
  emptyCore,
  estimateDuration,
  insertPoint,
  movePoint,
  outAndBack,
  returnToStart,
  reverse,
  routeCoords,
  segSig,
  setSegmentMode,
  totalDistance,
  totalDuration,
} from './route-model'
import type { LatLng, RouteCore } from './types'

const A = { lat: 0, lng: 0 }
const B = { lat: 0, lng: 1 }
const C = { lat: 0, lng: 2 }

function abc(): RouteCore {
  let c = emptyCore('foot', 'mi')
  c = addPoint(c, A)
  c = addPoint(c, B)
  c = addPoint(c, C)
  return c
}

describe('route-model', () => {
  it('adds points and creates one mode per gap', () => {
    const c = abc()
    expect(c.points).toHaveLength(3)
    expect(c.modes).toEqual(['foot', 'foot'])
  })

  it('moves a point without changing its id or the modes', () => {
    const before = abc()
    const c = movePoint(before, 1, { lat: 5, lng: 5 })
    expect(c.points[1]).toMatchObject({ lat: 5, lng: 5 })
    expect(c.points[1].id).toBe(before.points[1].id)
    expect(c.modes).toEqual(['foot', 'foot'])
  })

  it('inserts a point splitting a segment, inheriting its mode', () => {
    let c = abc()
    c = setSegmentMode(c, 0, 'bike')
    const { core, index } = insertPoint(c, 0, { lat: 0, lng: 0.5 })
    expect(index).toBe(1)
    expect(core.points).toHaveLength(4)
    expect(core.points[1]).toMatchObject({ lat: 0, lng: 0.5 })
    expect(core.modes).toEqual(['bike', 'bike', 'foot'])
  })

  it('deletes an interior point and merges the two gaps', () => {
    let c = abc()
    c = setSegmentMode(c, 0, 'foot')
    c = setSegmentMode(c, 1, 'bike')
    const out = deletePoint(c, 1)
    expect(out.points).toHaveLength(2)
    expect(out.modes).toEqual(['foot']) // keeps the gap before the removed point
  })

  it('deletes the first point', () => {
    let c = abc()
    c = setSegmentMode(c, 0, 'foot')
    c = setSegmentMode(c, 1, 'bike')
    const out = deletePoint(c, 0)
    expect(out.points).toHaveLength(2)
    expect(out.modes).toEqual(['bike'])
  })

  it('deletes the last point', () => {
    let c = abc()
    c = setSegmentMode(c, 0, 'foot')
    c = setSegmentMode(c, 1, 'bike')
    const out = deletePoint(c, 2)
    expect(out.points).toHaveLength(2)
    expect(out.modes).toEqual(['foot'])
  })

  it('reverses points and modes', () => {
    let c = abc()
    c = setSegmentMode(c, 0, 'foot')
    c = setSegmentMode(c, 1, 'bike')
    const r = reverse(c)
    expect(r.points.map((p) => p.lng)).toEqual([2, 1, 0])
    expect(r.modes).toEqual(['bike', 'foot'])
  })

  it('returns to start by appending the first point', () => {
    const c = returnToStart(abc())
    expect(c.points).toHaveLength(4)
    expect(c.points[3]).toMatchObject({ lat: A.lat, lng: A.lng })
    expect(c.modes).toHaveLength(3)
  })

  it('mirrors the route for out-and-back', () => {
    const c = outAndBack(abc())
    expect(c.points.map((p) => p.lng)).toEqual([0, 1, 2, 1, 0])
    expect(c.modes).toHaveLength(4)
  })

  it('clears points and modes', () => {
    const c = clearRoute(abc())
    expect(c.points).toEqual([])
    expect(c.modes).toEqual([])
  })

  it('derives straight pending segments for snap modes, final for manual', () => {
    const manual = setSegmentMode(setSegmentMode(abc(), 0, 'manual'), 1, 'manual')
    const cache = new Map()
    const segs = deriveSegments(manual, cache)
    expect(segs).toHaveLength(2)
    expect(segs[0].pending).toBe(false)
    expect(segs[0].coords).toHaveLength(2)

    const foot = abc()
    const footSegs = deriveSegments(foot, cache)
    expect(footSegs[0].pending).toBe(true)
  })

  it('uses cached geometry when present', () => {
    const c = abc()
    const cache = new Map<string, { coords: LatLng[]; distance: number; duration?: number }>()
    const snapped = [A, { lat: 0, lng: 0.5 }, B]
    cache.set(segSig(A, B, 'foot'), { coords: snapped, distance: 12345, duration: 678 })
    const segs = deriveSegments(c, cache)
    expect(segs[0].pending).toBe(false)
    expect(segs[0].distance).toBe(12345)
    expect(segs[0].duration).toBe(678) // router-reported time is preferred
    expect(segs[0].coords).toHaveLength(3)
  })

  it('estimates duration from distance and mode speed', () => {
    expect(estimateDuration(1390, 'foot')).toBeCloseTo(1000, 0) // ~5 km/h
    // faster modes take less time for the same distance
    expect(estimateDuration(1000, 'bike')).toBeLessThan(estimateDuration(1000, 'foot'))
    expect(estimateDuration(1000, 'car')).toBeLessThan(estimateDuration(1000, 'bike'))
  })

  it('falls back to an estimate when the cache has no duration', () => {
    const c = abc()
    const cache = new Map<string, { coords: LatLng[]; distance: number }>()
    cache.set(segSig(A, B, 'foot'), { coords: [A, B], distance: 1390 })
    const segs = deriveSegments(c, cache)
    expect(segs[0].duration).toBeCloseTo(estimateDuration(1390, 'foot'), 5)
  })

  it('picks the dominant travel mode', () => {
    expect(dominantMode(emptyCore('bike'))).toBe('bike') // empty → defaultMode
    let c = abc() // foot, foot
    expect(dominantMode(c)).toBe('foot')
    c = setSegmentMode(c, 0, 'bike') // bike, foot → tie broken toward first seen
    expect(['bike', 'foot']).toContain(dominantMode(c))
    c = setSegmentMode(c, 1, 'bike') // bike, bike
    expect(dominantMode(c)).toBe('bike')
  })

  it('sums segment durations for the whole route', () => {
    const segs = deriveSegments(abc(), new Map())
    const sum = segs.reduce((s, seg) => s + seg.duration, 0)
    expect(totalDuration(segs)).toBeCloseTo(sum, 6)
    expect(totalDuration(segs)).toBeGreaterThan(0)
  })

  it('flattens route coords without duplicating shared endpoints', () => {
    const segs = deriveSegments(abc(), new Map())
    const coords = routeCoords(segs)
    // A,B,C across two straight segments → 3 unique points, not 4.
    expect(coords).toHaveLength(3)
    expect(totalDistance(segs)).toBeGreaterThan(0)
  })
})
