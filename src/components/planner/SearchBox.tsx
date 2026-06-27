/**
 * Place search (top bar). Uses a free, no-key OSM geocoder via plain `fetch`,
 * so it works for everyone — no sign-in required. Results are *biased toward the
 * current map view* (via `getCenter`), so "coffee" or "McDonald's" surfaces the
 * nearest hits first while a named city still resolves anywhere. Picking a
 * result flies the map there.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Search, X } from 'lucide-react'
import { geocodingService } from '../../services/geocoding'
import type { LatLng } from '../../lib/types'
import type { GeoResult } from '../../services/types'

interface SearchBoxProps {
  onPick: (result: GeoResult) => void
  /** Current map centre — searches are biased toward it (nearby-first). */
  getCenter?: () => LatLng
}

export function SearchBox({ onPick, getCenter }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Hold the latest `getCenter` so the search effect can read the live map
  // centre without re-subscribing on every render.
  const getCenterRef = useRef(getCenter)
  getCenterRef.current = getCenter

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setStatus('loading')
      const near = getCenterRef.current?.()
      geocodingService
        .search(q, controller.signal, near)
        .then((res) => {
          setResults(res)
          setStatus('idle')
          setOpen(true)
        })
        .catch((err) => {
          // Ignore aborts from debounce/unmount; only surface real failures.
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus('error')
        })
    }, 400)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div ref={boxRef} className="pointer-events-auto relative w-full sm:w-72 sm:max-w-[80vw]">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 shadow-lg backdrop-blur-md focus-within:border-primary">
        {status === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <input
          data-testid="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search places, addresses, restaurants…"
          aria-label="Search for a place"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setResults([])
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (results.length > 0 || status === 'error') && (
        <ul
          data-testid="search-results"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        >
          {status === 'error' && (
            <li className="px-3 py-2 text-sm text-warning">Search failed. Try again.</li>
          )}
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(r)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm leading-snug text-foreground transition-colors hover:bg-secondary"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
