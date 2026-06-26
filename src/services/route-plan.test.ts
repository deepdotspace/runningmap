import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pathDistance } from '../lib/geo'
import type { LatLng } from '../lib/types'

// Mock the routing singleton: simulate road-snapping as the seed's straight-line
// perimeter run through a snap model, so we can assert the corrector converges
// the SNAPPED length to the target — with no network.
const planMeasure = vi.fn()
vi.mock('./routing', () => ({
  routingService: { planMeasure: (...args: unknown[]) => planMeasure(...args) },
}))

const { planRoute } = await import('./route-plan')

const CENTER: LatLng = { lat: 40.0, lng: -105.0 }

// A fake measured route: a chosen total plus one trivial leg per consecutive
// pair (coords only — planRoute just passes legs through; geometry is exercised
// by the buildPlannedRoute tests).
function measured(points: LatLng[], meters: number) {
  const legs = points.slice(1).map((b, i) => ({ coords: [points[i], b], distance: 0 }))
  return { meters, legs }
}

beforeEach(() => {
  planMeasure.mockReset()
})

describe('planRoute', () => {
  it('rescales an AFFINE+quantized snapper (len + c) to within tolerance', async () => {
    // Snapped length has a large size-INDEPENDENT offset c and is quantized to
    // 50 m. At feed == target the snapped length is well outside tolerance, so
    // the FIRST seed never qualifies — convergence must run the measure→rescale
    // loop (secant step) to land. If the loop were removed, this would fail.
    planMeasure.mockImplementation((_mode, points: LatLng[]) => {
      const raw = pathDistance(points) + 8_000
      return Promise.resolve(measured(points, Math.round(raw / 50) * 50))
    })
    const target = 20_000
    const plan = await planRoute({ center: CENTER, targetMeters: target, type: 'loop', bearingDeg: 0, mode: 'foot' })
    expect(plan.waypoints.length).toBeGreaterThan(2)
    expect(plan.legs.length).toBeGreaterThan(2)
    expect(Math.abs(plan.meters - target) / target).toBeLessThanOrEqual(0.05)
    // It took at least a second measurement (the first seed was out of tolerance)
    // and still converged efficiently — not the full iteration budget.
    expect(planMeasure.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(planMeasure.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('measures with the route’s actual travel mode (not a hardcoded foot)', async () => {
    planMeasure.mockImplementation((_mode, points: LatLng[]) =>
      Promise.resolve(measured(points, pathDistance(points) * 1.2)),
    )
    await planRoute({ center: CENTER, targetMeters: 10_000, type: 'loop', bearingDeg: 0, mode: 'bike' })
    expect(planMeasure).toHaveBeenCalled()
    for (const call of planMeasure.mock.calls) expect(call[0]).toBe('bike')
  })

  it('works for out-and-back too', async () => {
    planMeasure.mockImplementation((_mode, points: LatLng[]) =>
      Promise.resolve(measured(points, pathDistance(points) * 1.2)),
    )
    const target = 16_000
    const plan = await planRoute({ center: CENTER, targetMeters: target, type: 'out-and-back', bearingDeg: 90, mode: 'foot' })
    expect(Math.abs(plan.meters - target) / target).toBeLessThanOrEqual(0.05)
  })

  it('returns the closest seed found when it cannot hit tolerance', async () => {
    // Pathological: always reports a fixed length regardless of seed size, so
    // rescaling never helps — we should still get the (single) best attempt back.
    planMeasure.mockImplementation((_mode, points: LatLng[]) => Promise.resolve(measured(points, 9_999)))
    const plan = await planRoute({ center: CENTER, targetMeters: 20_000, type: 'loop', bearingDeg: 0, mode: 'foot' })
    expect(plan.meters).toBe(9_999)
    expect(plan.waypoints.length).toBeGreaterThan(2)
  })

  it('falls back to an unmeasured seed if measuring fails', async () => {
    planMeasure.mockRejectedValue(new Error('network'))
    const plan = await planRoute({ center: CENTER, targetMeters: 5_000, type: 'loop', bearingDeg: 0, mode: 'foot' })
    expect(plan.meters).toBe(0)
    expect(plan.waypoints.length).toBeGreaterThan(2)
    expect(plan.legs).toEqual([])
  })

  it('returns empty for a non-positive target without calling the router', async () => {
    const plan = await planRoute({ center: CENTER, targetMeters: 0, type: 'loop', bearingDeg: 0, mode: 'foot' })
    expect(plan).toEqual({ waypoints: [], meters: 0, legs: [] })
    expect(planMeasure).not.toHaveBeenCalled()
  })
})
