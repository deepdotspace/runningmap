/**
 * useElevation — debounced elevation profile for the current route geometry.
 * Samples the polyline down to the API's point budget, then queries Open-Meteo.
 */

import { useEffect, useState } from 'react'
import { sampleAlong } from '../lib/geo'
import type { LatLng } from '../lib/types'
import { ELEVATION_SAMPLE_COUNT } from '../services/config'
import { elevationService } from '../services/elevation'

export interface ElevationPoint {
  /** Cumulative distance from start, in metres. */
  dist: number
  /** Elevation in metres. */
  ele: number
}

export type ElevationStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UseElevationResult {
  profile: ElevationPoint[]
  status: ElevationStatus
  gain: number
  loss: number
}

/**
 * Cheap order-sensitive hash of the geometry (lat/lng rounded to ~1 m). Stable by
 * value across renders, so it can drive the fetch effect: it changes on ANY change
 * to the actual coordinates — including a reshape that keeps total distance the
 * same — which a rounded-distance signature would miss. Integer math only, so it's
 * negligible even for long routes.
 */
function geometrySignature(coords: LatLng[]): number {
  let h = coords.length
  for (const c of coords) {
    h = (Math.imul(h, 31) + Math.round(c.lat * 1e5)) | 0
    h = (Math.imul(h, 31) + Math.round(c.lng * 1e5)) | 0
  }
  return h
}

/**
 * Bounded module-level cache of computed profiles, keyed by geometry signature.
 * Returning to a previously-fetched geometry (undo/redo, revisiting a route)
 * then reuses the result instead of re-hitting providers that have daily caps.
 */
const MAX_ELEVATION_CACHE = 32
const elevationCache = new Map<number, ElevationPoint[]>()

function gainLoss(profile: ElevationPoint[]): { gain: number; loss: number } {
  let gain = 0
  let loss = 0
  for (let i = 1; i < profile.length; i += 1) {
    const d = profile[i].ele - profile[i - 1].ele
    if (d > 0) gain += d
    else loss -= d
  }
  return { gain, loss }
}

/**
 * @param coords  full snapped route geometry
 * @param enabled  skip network when false
 */
export function useElevation(coords: LatLng[], enabled = true): UseElevationResult {
  const signature = geometrySignature(coords)
  const [profile, setProfile] = useState<ElevationPoint[]>([])
  const [status, setStatus] = useState<ElevationStatus>('idle')

  useEffect(() => {
    if (!enabled || coords.length < 2) {
      setProfile([])
      setStatus('idle')
      return
    }
    // Serve a previously-computed profile for this exact geometry without a fetch.
    const cached = elevationCache.get(signature)
    if (cached) {
      setProfile(cached)
      setStatus('ready')
      return
    }
    const samples = sampleAlong(coords, ELEVATION_SAMPLE_COUNT)
    const controller = new AbortController()
    let active = true

    const timer = setTimeout(() => {
      setStatus('loading')
      elevationService
        .lookup(
          samples.map((s) => ({ lat: s.lat, lng: s.lng })),
          controller.signal,
        )
        .then((eles) => {
          if (!active) return
          const next = samples.map((s, i) => ({ dist: s.dist, ele: eles[i] ?? 0 }))
          if (elevationCache.size >= MAX_ELEVATION_CACHE) {
            const oldest = elevationCache.keys().next().value
            if (oldest !== undefined) elevationCache.delete(oldest)
          }
          elevationCache.set(signature, next)
          setProfile(next)
          setStatus('ready')
        })
        .catch(() => {
          if (!active || controller.signal.aborted) return
          setStatus('error')
        })
    }, 500)

    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
    // `signature` captures geometry changes cheaply; coords identity alone is
    // unstable across renders.
  }, [signature, enabled])

  return { profile, status, ...gainLoss(profile) }
}
