/**
 * Snap bookending — Valhalla returns a shape that begins/ends at the nearest
 * *routable* point, which can sit off the clicked anchor. `snap()` must bookend
 * the shape with the exact anchors so a leg's rendered line meets its waypoint
 * dots (the loop start/finish "dot off the line" bug). See routing.ts `bookend`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodePolyline } from '../lib/polyline'
import type { LatLng } from '../lib/types'
import { ValhallaRoutingService } from './routing'

/** Build a fake Valhalla `/route` response whose leg shape is `snapped`. */
function mockValhalla(snapped: LatLng[], lengthKm = 1.5, timeSec = 900) {
  const trip = {
    status: 0,
    summary: { length: lengthKm, time: timeSec },
    // Valhalla encodes shapes at precision 6.
    legs: [{ shape: encodePolyline(snapped, 6), summary: { length: lengthKm, time: timeSec } }],
  }
  return vi.fn(async () => ({ ok: true, json: async () => ({ trip }) }) as unknown as Response)
}

/** Build a fake Valhalla `/route` response with multiple legs. */
function mockTrip(legs: { shape: LatLng[]; km: number }[], totalKm: number) {
  const trip = {
    status: 0,
    summary: { length: totalKm, time: 0 },
    legs: legs.map((l) => ({ shape: encodePolyline(l.shape, 6), summary: { length: l.km, time: 60 } })),
  }
  return vi.fn(async () => ({ ok: true, json: async () => ({ trip }) }) as unknown as Response)
}

const svc = new ValhallaRoutingService()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ValhallaRoutingService.snap bookending', () => {
  it('prepends/appends the exact anchors when the snapped ends are off the clicked points', async () => {
    // Anchors the user clicked (off-road); snapped shape ends sit ~tens of m away.
    const a: LatLng = { lat: 40.0, lng: -74.0 }
    const b: LatLng = { lat: 40.011, lng: -74.009 }
    const snapStart: LatLng = { lat: 40.0005, lng: -74.0003 }
    const snapMid: LatLng = { lat: 40.006, lng: -74.005 }
    const snapEnd: LatLng = { lat: 40.0104, lng: -74.0094 }

    vi.stubGlobal('fetch', mockValhalla([snapStart, snapMid, snapEnd]))

    const leg = await svc.snap('foot', a, b)

    // First coord is the clicked anchor, not the snapped road point.
    expect(leg.coords[0].lat).toBeCloseTo(a.lat, 6)
    expect(leg.coords[0].lng).toBeCloseTo(a.lng, 6)
    // Last coord is the clicked anchor too.
    expect(leg.coords.at(-1)!.lat).toBeCloseTo(b.lat, 6)
    expect(leg.coords.at(-1)!.lng).toBeCloseTo(b.lng, 6)
    // The snapped road geometry is preserved in between.
    expect(leg.coords).toHaveLength(5)
    expect(leg.coords[1].lat).toBeCloseTo(snapStart.lat, 6)
    expect(leg.coords[3].lat).toBeCloseTo(snapEnd.lat, 6)
    // Distance still comes from Valhalla (the stub is display-only).
    expect(leg.distance).toBeCloseTo(1500, 6)
  })

  it('does not add a duplicate vertex when an anchor is already on the road', async () => {
    // Here the clicked anchors coincide with the snapped shape endpoints.
    const a: LatLng = { lat: 40.0, lng: -74.0 }
    const b: LatLng = { lat: 40.01, lng: -74.01 }
    const mid: LatLng = { lat: 40.005, lng: -74.005 }

    vi.stubGlobal('fetch', mockValhalla([a, mid, b]))

    const leg = await svc.snap('foot', a, b)

    // No bookend stubs added — same length as the snapped shape.
    expect(leg.coords).toHaveLength(3)
    expect(leg.coords[0].lat).toBeCloseTo(a.lat, 6)
    expect(leg.coords.at(-1)!.lng).toBeCloseTo(b.lng, 6)
  })
})

describe('ValhallaRoutingService.planMeasure', () => {
  it('returns the trip total plus each leg’s decoded shape (no bookend)', async () => {
    const p0: LatLng = { lat: 40.0, lng: -74.0 }
    const p1: LatLng = { lat: 40.01, lng: -74.01 }
    const p2: LatLng = { lat: 40.02, lng: -74.0 }
    const legA = [p0, { lat: 40.005, lng: -74.005 }, p1]
    const legB = [p1, { lat: 40.015, lng: -74.005 }, p2]

    vi.stubGlobal('fetch', mockTrip([{ shape: legA, km: 1.0 }, { shape: legB, km: 1.2 }], 2.2))

    const res = await svc.planMeasure('foot', [p0, p1, p2])

    expect(res.meters).toBeCloseTo(2200, 6)
    expect(res.legs).toHaveLength(2)
    expect(res.legs[0].distance).toBeCloseTo(1000, 6)
    expect(res.legs[1].distance).toBeCloseTo(1200, 6)
    // Raw snapped shape — first/last coords are the road points, not re-anchored.
    expect(res.legs[0].coords).toHaveLength(3)
    expect(res.legs[0].coords[0].lat).toBeCloseTo(p0.lat, 5)
    expect(res.legs[1].coords.at(-1)!.lat).toBeCloseTo(p2.lat, 5)
  })

  it('returns empty for fewer than two points without fetching', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const res = await svc.planMeasure('foot', [{ lat: 1, lng: 2 }])
    expect(res).toEqual({ meters: 0, legs: [] })
    expect(spy).not.toHaveBeenCalled()
  })
})
