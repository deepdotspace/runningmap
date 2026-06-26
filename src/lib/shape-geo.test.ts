import { describe, expect, it } from 'vitest'
import { placeShape } from './shape-geo'
import { haversine, bounds } from './geo'
import type { NormalizedShape } from './shapes'

const center = { lat: 40, lng: -100 }

// A unit square covering the full [0,1] box on both axes.
const squareShape: NormalizedShape = {
  name: 'sq',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  closed: true,
}

describe('placeShape', () => {
  it('closes the loop by repeating the first point', () => {
    const pts = placeShape(squareShape, center, 1000, 0)
    expect(pts.length).toBe(squareShape.points.length + 1)
    expect(pts[0].lat).toBeCloseTo(pts[pts.length - 1].lat, 9)
    expect(pts[0].lng).toBeCloseTo(pts[pts.length - 1].lng, 9)
  })

  it('centres the shape on the given point', () => {
    const pts = placeShape(squareShape, center, 1000, 0)
    const box = bounds(pts)!
    const midLng = (box[0] + box[2]) / 2
    const midLat = (box[1] + box[3]) / 2
    expect(midLng).toBeCloseTo(center.lng, 6)
    expect(midLat).toBeCloseTo(center.lat, 6)
  })

  it('scales the longest side to sizeMeters', () => {
    const size = 1000
    const pts = placeShape(squareShape, center, size, 0)
    // East edge: (0,0)→(1,0) are the first two points; their separation is the
    // full width = sizeMeters.
    const eastEdge = haversine(pts[0], pts[1])
    expect(eastEdge).toBeGreaterThan(size * 0.95)
    expect(eastEdge).toBeLessThan(size * 1.05)
  })

  it('rotating 180° mirrors points through the centre', () => {
    const a = placeShape(squareShape, center, 1000, 0)
    const b = placeShape(squareShape, center, 1000, 180)
    // Each rotated point is reflected across the centre relative to the original.
    a.forEach((p, i) => {
      expect(b[i].lat - center.lat).toBeCloseTo(-(p.lat - center.lat), 9)
      expect(b[i].lng - center.lng).toBeCloseTo(-(p.lng - center.lng), 9)
    })
  })

  it('returns an empty array for an empty shape', () => {
    expect(placeShape({ name: 'e', points: [], closed: true }, center, 1000, 0)).toEqual([])
  })
})
