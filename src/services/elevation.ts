/**
 * Elevation lookups via free, no-key public APIs — with automatic fallback.
 *
 * Previously this hit a single provider (Open-Meteo). That endpoint enforces a
 * shared per-IP *daily* request cap, so once it returned HTTP 429
 * ("Daily API request limit exceeded") the elevation profile broke entirely.
 * We now try a chain of independent free providers in order and use the first
 * that returns a complete result, so one provider being rate-limited or down no
 * longer kills elevation. Each provider speaks a different request/response
 * shape; the adapters normalise them to a metres-per-input-point array.
 *
 * The first provider's base URL stays overridable via `VITE_ELEVATION_URL` so a
 * deployment can point at a keyed/self-hosted Open-Meteo without code changes.
 */

import type { LatLng } from '../lib/types'
import { ELEVATION_TIMEOUT_MS, ELEVATION_URL } from './config'
import type { ElevationService } from './types'

/** A single elevation backend: name (for diagnostics) + a normalising lookup. */
interface Provider {
  name: string
  lookup(points: LatLng[], signal?: AbortSignal): Promise<number[]>
}

/**
 * Fetch JSON bounded by the caller's signal AND a hard per-request timeout, so a
 * provider that accepts the connection but never responds throws (→ the fallback
 * chain advances) rather than hanging the elevation profile forever. Mirrors the
 * timeout pattern in `routing.ts` / `places.ts`.
 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), ELEVATION_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** `lat,lng|lat,lng|…` — the locations format shared by OpenTopoData/Open-Elevation. */
function pipeLocations(points: LatLng[]): string {
  return points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')
}

interface OpenMeteoResponse {
  elevation?: Array<number | null>
}

interface ResultsResponse {
  results?: Array<{ elevation: number | null }>
}

/** A present, usable elevation reading: not null, and an actual finite number. */
function isPresent(e: number | null | undefined): e is number {
  return e != null && Number.isFinite(e)
}

/**
 * Normalise an OpenTopoData/Open-Elevation `results` array to metres per point.
 * A `null` (or non-finite) value means "no data here" (point outside the
 * dataset's coverage). Coercing those to 0 would draw a fake sea-level cliff AND
 * pass the completeness check, so a mostly-missing response is thrown (→ fall
 * through to the next provider); isolated gaps carry the last known elevation
 * instead of dropping to 0.
 */
function metresFromResults(
  name: string,
  results: Array<{ elevation: number | null }>,
): number[] {
  const present = results.filter((r) => isPresent(r.elevation))
  if (present.length < results.length * 0.75) {
    throw new Error(`${name}: only ${present.length}/${results.length} points have data`)
  }
  let last = present[0]?.elevation ?? 0
  return results.map((r) => {
    if (isPresent(r.elevation)) last = r.elevation
    return last
  })
}

// Open-Meteo — fast, parallel latitude/longitude arrays, up to 100 points.
function openMeteo(baseUrl: string): Provider {
  return {
    name: 'open-meteo',
    async lookup(points, signal) {
      const lats = points.map((p) => p.lat.toFixed(6)).join(',')
      const lngs = points.map((p) => p.lng.toFixed(6)).join(',')
      const data = (await fetchJson(
        `${baseUrl}/v1/elevation?latitude=${lats}&longitude=${lngs}`,
        signal,
      )) as OpenMeteoResponse
      if (!Array.isArray(data.elevation)) throw new Error('open-meteo: no elevation array')
      // Route through the same normalisation as the other providers so null /
      // non-finite entries are carried/rejected, never rendered as fake 0 m.
      return metresFromResults('open-meteo', data.elevation.map((elevation) => ({ elevation })))
    },
  }
}

// OpenTopoData (mapzen dataset — global coverage); `results[].elevation`.
function openTopoData(): Provider {
  return {
    name: 'opentopodata',
    async lookup(points, signal) {
      const data = (await fetchJson(
        `https://api.opentopodata.org/v1/mapzen?locations=${pipeLocations(points)}`,
        signal,
      )) as ResultsResponse
      if (!Array.isArray(data.results)) throw new Error('opentopodata: no results array')
      return metresFromResults('opentopodata', data.results)
    },
  }
}

// Open-Elevation — community SRTM mirror; `results[].elevation`.
function openElevation(): Provider {
  return {
    name: 'open-elevation',
    async lookup(points, signal) {
      const data = (await fetchJson(
        `https://api.open-elevation.com/api/v1/lookup?locations=${pipeLocations(points)}`,
        signal,
      )) as ResultsResponse
      if (!Array.isArray(data.results)) throw new Error('open-elevation: no results array')
      return metresFromResults('open-elevation', data.results)
    },
  }
}

export class FallbackElevationService implements ElevationService {
  private readonly providers: Provider[]

  constructor(baseUrl: string = ELEVATION_URL) {
    this.providers = [openMeteo(baseUrl), openTopoData(), openElevation()]
  }

  async lookup(points: LatLng[], signal?: AbortSignal): Promise<number[]> {
    if (points.length === 0) return []

    let lastError: unknown
    for (const provider of this.providers) {
      try {
        const eles = await provider.lookup(points, signal)
        // A short/misaligned response is treated as a failure so we fall through
        // rather than render a profile that doesn't line up with the route.
        if (eles.length >= points.length) return eles.slice(0, points.length)
        lastError = new Error(`${provider.name}: ${eles.length}/${points.length} points`)
      } catch (error) {
        // A caller abort (route changed / unmounted) must stop the whole chain —
        // don't burn the fallbacks retrying work nobody is waiting for.
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    throw lastError ?? new Error('All elevation providers failed')
  }
}

export const elevationService: ElevationService = new FallbackElevationService()
