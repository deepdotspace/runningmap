/**
 * Nearby-place discovery via the free, no-key OpenStreetMap Overpass API.
 *
 * v1 scope (deliberately small — see FEATURE_PLAN review): **parks only**
 * (`leisure=park`), nodes + ways via `out center`, a hard result cap, and a
 * 12 s timeout with a clean failure. Public Overpass instances are demo-grade
 * and rate-limited, so timeout/empty is an *expected* path the UI must handle —
 * not a rare edge case. Trails (`route=hiking` relations) are deferred to v2.
 */

import type { LatLng } from '../lib/types'
import type { Place, PlacesService } from './types'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const TIMEOUT_MS = 12_000
const MAX_RESULTS = 30

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: { name?: string }
}

function buildQuery(center: LatLng, radiusMeters: number): string {
  const r = Math.round(radiusMeters)
  const at = `${center.lat},${center.lng}`
  return (
    `[out:json][timeout:25];` +
    `(` +
    `node["leisure"="park"](around:${r},${at});` +
    `way["leisure"="park"](around:${r},${at});` +
    `);` +
    `out center ${MAX_RESULTS};`
  )
}

export class OverpassPlacesService implements PlacesService {
  async nearby(center: LatLng, radiusMeters: number, signal?: AbortSignal): Promise<Place[]> {
    // Combine the caller's abort signal with our own timeout.
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildQuery(center, radiusMeters))}`,
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const data = (await res.json()) as { elements?: OverpassElement[] }
      const places: Place[] = []
      for (const el of data.elements ?? []) {
        const lat = el.lat ?? el.center?.lat
        const lon = el.lon ?? el.center?.lon
        if (typeof lat !== 'number' || typeof lon !== 'number') continue
        places.push({
          id: `${el.type}/${el.id}`,
          name: el.tags?.name?.trim() || 'Unnamed park',
          lat,
          lng: lon,
        })
      }
      return places
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

export const placesService: PlacesService = new OverpassPlacesService()
