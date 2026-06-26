/**
 * Place search via free, no-key OpenStreetMap geocoders called with a plain
 * browser `fetch` (NOT the owner-billed SDK integration) — so search needs no
 * sign-in and costs nothing.
 *
 * Primary: Photon (`photon.komoot.io`) — purpose-built for type-ahead, returns
 * address/POI-level results. Fallback: Nominatim `/search` (the same service we
 * already use for reverse geocoding), best-effort.
 *
 * Note: browsers forbid setting `User-Agent`/`Referer` from `fetch`, so we don't
 * try — both services are CORS-enabled and accept anonymous browser requests.
 * Callers debounce (400 ms) and pass an `AbortSignal`, which we wire into fetch.
 */

import type { LatLng } from '../lib/types'
import type { GeocodingService, GeoResult } from './types'

const PHOTON_URL = 'https://photon.komoot.io/api/'
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    name?: string
    housenumber?: string
    street?: string
    city?: string
    state?: string
    country?: string
    postcode?: string
  }
}

function photonLabel(p: NonNullable<PhotonFeature['properties']>): string {
  const line1 = p.name || [p.housenumber, p.street].filter(Boolean).join(' ')
  return [line1, p.city, p.state, p.country].filter(Boolean).join(', ')
}

async function searchPhoton(
  query: string,
  signal?: AbortSignal,
  near?: LatLng,
): Promise<GeoResult[]> {
  // Photon biases (not restricts) results toward `lat`/`lon` when provided, so a
  // bare "coffee" finds the nearest cafés while "Paris" still reaches France.
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}&zoom=12` : ''
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5${bias}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Photon ${res.status}`)
  const data = (await res.json()) as { features?: PhotonFeature[] }
  return (data.features ?? [])
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f) => {
      const [lng, lat] = f.geometry!.coordinates as [number, number]
      return { label: photonLabel(f.properties ?? {}) || 'Unnamed place', lat, lng }
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

async function searchNominatim(
  query: string,
  signal?: AbortSignal,
  near?: LatLng,
): Promise<GeoResult[]> {
  // Nominatim has no point-bias param; an un-`bounded` viewbox around `near`
  // nudges ranking toward nearby hits without excluding far-away matches.
  let viewbox = ''
  if (near) {
    const d = 0.6 // ~60 km half-window
    viewbox =
      `&viewbox=${near.lng - d},${near.lat - d},${near.lng + d},${near.lat + d}&bounded=0`
  }
  const url =
    `${NOMINATIM_SEARCH_URL}?format=jsonv2&limit=5&addressdetails=0` +
    `${viewbox}&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const data = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>
  return data
    .filter((e) => e.lat != null && e.lon != null)
    .map((e) => ({
      label: e.display_name?.split(',').slice(0, 3).join(',').trim() || 'Unnamed place',
      lat: Number(e.lat),
      lng: Number(e.lon),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

export class OsmGeocoder implements GeocodingService {
  async search(query: string, signal?: AbortSignal, near?: LatLng): Promise<GeoResult[]> {
    const q = query.trim()
    if (!q) return []
    try {
      return await searchPhoton(q, signal, near)
    } catch (err) {
      // A user-initiated abort (debounce/unmount) must not trigger the fallback.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      return searchNominatim(q, signal, near)
    }
  }
}

export const geocodingService: GeocodingService = new OsmGeocoder()

/**
 * Reverse-geocode a coordinate to a short place label (e.g. "Brooklyn, NY")
 * via OpenStreetMap Nominatim — free, no key, CORS-enabled. Best-effort: returns
 * null on any failure so callers can fall back to raw coordinates. Used sparingly
 * (once per route save), well within Nominatim's usage policy.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  timeoutMs = 5000,
): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return null
    const data = (await res.json()) as {
      display_name?: string
      address?: Record<string, string>
    }
    const a = data.address ?? {}
    const locality = a.city || a.town || a.village || a.hamlet || a.suburb || a.county
    const region = a.state || a.region || a.country
    const label = [locality, region].filter(Boolean).join(', ')
    if (label) return label
    return data.display_name?.split(',').slice(0, 2).join(',').trim() || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
