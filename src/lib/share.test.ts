import { describe, expect, it } from 'vitest'
import { decodeRoute, encodeRoute } from './share'
import { emptyCore } from './route-model'
import type { RouteCore } from './types'

function core(): RouteCore {
  return {
    points: [
      { id: 'a', lat: 37.7749, lng: -122.4194 },
      { id: 'b', lat: 37.78, lng: -122.41 },
      { id: 'c', lat: 37.79, lng: -122.4 },
    ],
    modes: ['foot', 'bike'],
    defaultMode: 'car',
    unit: 'km',
  }
}

describe('share encoding', () => {
  it('round-trips points, modes, unit and default mode', () => {
    const decoded = decodeRoute(encodeRoute(core()))
    expect(decoded).not.toBeNull()
    const c = decoded as RouteCore
    expect(c.unit).toBe('km')
    expect(c.defaultMode).toBe('car')
    expect(c.modes).toEqual(['foot', 'bike'])
    expect(c.points).toHaveLength(3)
    c.points.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(core().points[i].lat, 4)
      expect(p.lng).toBeCloseTo(core().points[i].lng, 4)
    })
  })

  it('encodes an empty route', () => {
    const decoded = decodeRoute(encodeRoute(emptyCore('foot', 'mi')))
    expect(decoded?.points).toEqual([])
    expect(decoded?.modes).toEqual([])
    expect(decoded?.unit).toBe('mi')
  })

  it('handles a single point (no segments)', () => {
    const single: RouteCore = {
      points: [{ id: 'x', lat: 10, lng: 20 }],
      modes: [],
      defaultMode: 'foot',
      unit: 'mi',
    }
    const decoded = decodeRoute(encodeRoute(single))
    expect(decoded?.points).toHaveLength(1)
    expect(decoded?.modes).toEqual([])
  })

  it('rejects garbage', () => {
    expect(decodeRoute('')).toBeNull()
    expect(decodeRoute('no-delimiter-here')).toBeNull()
  })
})
