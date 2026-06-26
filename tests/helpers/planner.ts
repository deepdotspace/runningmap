import type { Page } from '@playwright/test'

/**
 * Stub the planner's external map services so e2e runs are deterministic,
 * offline, and never cost anything:
 *   - the MapLibre style → a minimal blank style (loads instantly, no tiles)
 *   - Valhalla routing → echoes the requested endpoints as a straight leg
 *   - Open-Meteo elevation → a synthetic hill sized to the request
 * Manual-mode geometry needs none of these. Call before `page.goto`.
 */

const MINIMAL_STYLE = {
  version: 8,
  name: 'test',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6ee' } }],
}

/** Precision-6 polyline encoder (Valhalla shape format). */
function encode6(pairs: Array<[number, number]>): string {
  const out: string[] = []
  let prevLat = 0
  let prevLng = 0
  const push = (delta: number) => {
    let x = delta < 0 ? ~(delta << 1) : delta << 1
    while (x >= 0x20) {
      out.push(String.fromCharCode((0x20 | (x & 0x1f)) + 63))
      x >>>= 5
    }
    out.push(String.fromCharCode(x + 63))
  }
  for (const [la, ln] of pairs) {
    const lat = Math.round(la * 1e6)
    const lng = Math.round(ln * 1e6)
    push(lat - prevLat)
    push(lng - prevLng)
    prevLat = lat
    prevLng = lng
  }
  return out.join('')
}

function lengthKm(pairs: Array<[number, number]>): number {
  const R = 6371008.8
  const toR = (d: number) => (d * Math.PI) / 180
  let m = 0
  for (let i = 1; i < pairs.length; i += 1) {
    const [la1, ln1] = pairs[i - 1]
    const [la2, ln2] = pairs[i]
    const h =
      Math.sin(toR(la2 - la1) / 2) ** 2 +
      Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(toR(ln2 - ln1) / 2) ** 2
    m += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
  }
  return m / 1000
}

export async function stubMapServices(page: Page): Promise<void> {
  await page.route(/openfreemap\.org\/styles\//, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(MINIMAL_STYLE) }),
  )

  // Valhalla `/route` — return a straight leg between the requested locations.
  await page.route(/openstreetmap\.de\/route$/, (route) => {
    let pairs: Array<[number, number]> = [
      [0, 0],
      [0, 0],
    ]
    try {
      const body = JSON.parse(route.request().postData() || '{}')
      if (Array.isArray(body.locations)) {
        pairs = body.locations.map((l: { lat: number; lon: number }) => [l.lat, l.lon])
      }
    } catch {
      /* keep default */
    }
    const length = lengthKm(pairs) || 1
    // Synthetic walking time (~5 km/h) so the estimated-time readout has data,
    // mirroring Valhalla's `summary.time` (seconds).
    const time = (length * 1000) / 1.39
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trip: {
          status: 0,
          summary: { length, time },
          legs: [{ shape: encode6(pairs), summary: { length, time } }],
        },
      }),
    })
  })

  // Nominatim reverse-geocode (used at save time for the route's place label).
  await page.route(/nominatim\.openstreetmap\.org\/reverse/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        display_name: 'Test Park, Testville, Test State',
        address: { city: 'Testville', state: 'Test State' },
      }),
    }),
  )

  await page.route(/\/v1\/elevation/, (route) => {
    const url = new URL(route.request().url())
    const n = (url.searchParams.get('latitude') ?? '').split(',').filter(Boolean).length || 2
    const elevation = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 3) * 25 + i * 0.5)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elevation }) })
  })
}

/**
 * Stub the free OSM place-search geocoder (Photon) so search is deterministic
 * and makes no real network call. Photon returns a GeoJSON FeatureCollection.
 */
export async function stubGeocoding(page: Page): Promise<void> {
  await page.route(/photon\.komoot\.io\/api/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-100.2, 40.1] },
            properties: { name: 'Testville', country: 'US' },
          },
        ],
      }),
    }),
  )
}

export async function waitForMap(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="planner"][data-map-ready="true"]', { timeout: 20_000 })
}

export function markerCount(page: Page): Promise<number> {
  return page.locator('.rm-marker').count()
}
