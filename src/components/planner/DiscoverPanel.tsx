/**
 * Discover parks near a point — free OSM Overpass POIs (v1: parks only).
 * List-only: clicking a result flies the map there (no persistent marker layer).
 * Searches around the current map centre, or the user's location on request.
 *
 * Overpass is demo-grade, so empty/error/timeout are first-class states here,
 * not afterthoughts.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Trees, X } from 'lucide-react'
import { placesService } from '../../services/places'
import { haversine } from '../../lib/geo'
import { formatDistance } from '../../lib/units'
import { useGeolocation } from '../../hooks/useGeolocation'
import type { LatLng, Unit } from '../../lib/types'
import type { Place } from '../../services/types'

const RADII_KM = [1, 3, 5] as const

interface DiscoverPanelProps {
  getCenter: () => LatLng
  onFlyTo: (lat: number, lng: number, zoom?: number) => void
  /** Picking a result drops a route waypoint at that place (and flies there). */
  onPickPlace: (lat: number, lng: number) => void
  unit: Unit
}

type Status = 'idle' | 'loading' | 'error' | 'done'

interface Ranked extends Place {
  meters: number
}

export function DiscoverPanel({ getCenter, onFlyTo, onPickPlace, unit }: DiscoverPanelProps) {
  const [open, setOpen] = useState(false)
  const [radiusKm, setRadiusKm] = useState<number>(3)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('Couldn’t reach the map service. Try a smaller radius.')
  const [results, setResults] = useState<Ranked[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const { getOnce } = useGeolocation()

  // Cancel any in-flight query on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  const runSearch = (center: LatLng) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    placesService
      .nearby(center, radiusKm * 1000, ctrl.signal)
      .then((places) => {
        if (ctrl.signal.aborted) return
        const ranked = places
          .map((p) => ({ ...p, meters: haversine(center, { lat: p.lat, lng: p.lng }) }))
          .sort((a, b) => a.meters - b.meters)
        setResults(ranked)
        setStatus('done')
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setErrorMsg('Couldn’t reach the map service. Try a smaller radius.')
        setStatus('error')
      })
  }

  const searchHere = () => runSearch(getCenter())

  const searchNearMe = () => {
    setStatus('loading')
    getOnce({
      onFix: (fix) => {
        onFlyTo(fix.lat, fix.lng, 14)
        runSearch({ lat: fix.lat, lng: fix.lng })
      },
      onError: (reason) => {
        setErrorMsg(
          reason === 'denied'
            ? 'Location permission denied — try “Search this area” instead.'
            : 'Couldn’t get your location. Try “Search this area”.',
        )
        setStatus('error')
      },
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="discover-toggle"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-sm text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-card"
      >
        <Trees className="h-4 w-4 text-primary" aria-hidden />
        Parks nearby
      </button>
    )
  }

  return (
    <div
      data-testid="discover-panel"
      className="pointer-events-auto w-72 max-w-[80vw] rounded-2xl border border-border bg-card/90 p-3 shadow-xl backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Trees className="h-4 w-4 text-primary" aria-hidden />
          Parks nearby
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Radius selector */}
      <div className="mb-2 flex items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">Radius</span>
        {RADII_KM.map((km) => (
          <button
            key={km}
            type="button"
            aria-pressed={radiusKm === km}
            onClick={() => setRadiusKm(km)}
            className={
              radiusKm === km
                ? 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground'
                : 'rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/70'
            }
          >
            {km} km
          </button>
        ))}
      </div>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="discover-here"
          onClick={searchHere}
          className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Search this area
        </button>
        <button
          type="button"
          onClick={searchNearMe}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
        >
          Near me
        </button>
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…
        </div>
      )}
      {status === 'error' && (
        <p className="py-3 text-center text-sm text-warning">{errorMsg}</p>
      )}
      {status === 'done' && results.length === 0 && (
        <p className="py-3 text-center text-sm text-muted-foreground">No parks found here.</p>
      )}

      {results.length > 0 && (
        <ul data-testid="discover-results" className="max-h-64 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPickPlace(p.lat, p.lng)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDistance(p.meters, unit)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
