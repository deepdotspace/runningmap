import { describe, expect, it } from 'vitest'
import { buildGpx } from './gpx'

describe('gpx', () => {
  const coords = [
    { lat: 37.7749, lng: -122.4194 },
    { lat: 37.78, lng: -122.41 },
    { lat: 37.79, lng: -122.4 },
  ]

  it('emits valid GPX with one trkpt per coordinate', () => {
    const gpx = buildGpx({ name: 'Test', coords })
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx).toContain('<trkseg>')
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(3)
    expect(gpx).toContain('lat="37.774900"')
    expect(gpx).toContain('lon="-122.419400"')
  })

  it('includes elevation when provided', () => {
    const gpx = buildGpx({ name: 'Elev', coords, elevations: [10, 20.5, null] })
    expect(gpx).toContain('<ele>10.0</ele>')
    expect(gpx).toContain('<ele>20.5</ele>')
    // null elevation → no <ele> for that point
    expect((gpx.match(/<ele>/g) ?? []).length).toBe(2)
  })

  it('escapes XML in the name', () => {
    const gpx = buildGpx({ name: 'A & B <route>', coords })
    expect(gpx).toContain('A &amp; B &lt;route&gt;')
  })
})
