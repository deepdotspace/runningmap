import { describe, expect, it } from 'vitest'
import { THUMB_H, THUMB_W, projectToBox } from './RouteThumbnail'
import type { LatLng } from '../lib/types'

describe('RouteThumbnail projection', () => {
  it('returns nothing for empty or degenerate (single-point) routes', () => {
    expect(projectToBox([])).toEqual([])
    expect(projectToBox([{ lat: 1, lng: 1 }])).toEqual([])
    expect(projectToBox([{ lat: 1, lng: 1 }, { lat: 1, lng: 1 }])).toEqual([])
  })

  it('maps every point inside the padded view box with finite numbers', () => {
    const coords: LatLng[] = [
      { lat: 37.0, lng: -122.0 },
      { lat: 37.05, lng: -121.95 },
      { lat: 37.02, lng: -121.9 },
      { lat: 37.08, lng: -121.97 },
    ]
    const pts = projectToBox(coords)
    expect(pts).toHaveLength(coords.length)
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(THUMB_W)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(THUMB_H)
    }
  })

  it('preserves shape aspect ratio (a wide route stays wide)', () => {
    // A route much wider (lng) than tall (lat) should span more X than Y.
    const wide: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0.01, lng: 2 },
    ]
    const pts = projectToBox(wide)
    const spanX = Math.abs(pts[1].x - pts[0].x)
    const spanY = Math.abs(pts[1].y - pts[0].y)
    expect(spanX).toBeGreaterThan(spanY)
  })

  it('flips latitude so north is up (higher lat → smaller y)', () => {
    const pts = projectToBox([
      { lat: 0, lng: 0 }, // south
      { lat: 1, lng: 0.0001 }, // north
    ])
    expect(pts[1].y).toBeLessThan(pts[0].y)
  })
})
