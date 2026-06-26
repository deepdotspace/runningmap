/**
 * Browser geolocation with sane defaults for a map "locate me".
 *
 * Why a hook (not a one-off `getCurrentPosition`): a single fix is the *worst*
 * fix — GPS accuracy improves over the first few seconds as it locks on. So
 * `watch()` keeps refining and reports each better fix, then stops once the
 * reading is good enough (or a time budget elapses). It also adds a coarse
 * fallback (`enableHighAccuracy: false`) when a precise fix never arrives, so
 * the user lands *somewhere* instead of getting nothing, and a clear error
 * message instead of silence. The watch is always torn down — on stop, on
 * timeout, on a second call, and on unmount.
 *
 * Explicit `{ getOnce, watch, stop }` API (no auto-watch on mount) so callers
 * that only need a single fast fix (e.g. "search near me") don't pay for a
 * refining watch, and pages that aren't maps never start one.
 */

import { useCallback, useEffect, useRef } from 'react'

export interface GeoFix {
  lat: number
  lng: number
  /** Reported 1-sigma horizontal accuracy, in metres. */
  accuracy: number
}

export interface WatchHandlers {
  /** Called for each (increasingly accurate) fix. */
  onFix: (fix: GeoFix) => void
  /** Called once when refining stops (good fix reached or time budget spent). */
  onDone?: () => void
  /** Called when no fix could be obtained at all. */
  onError?: (reason: GeoError) => void
}

export type GeoError = 'unsupported' | 'denied' | 'unavailable' | 'timeout'

/** Stop refining once the fix is at least this accurate (metres). */
const GOOD_ACCURACY_M = 30
/** Hard cap on how long to keep refining a watch. */
const REFINE_BUDGET_MS = 15_000
/** Per-fix timeout handed to the geolocation API. */
const FIX_TIMEOUT_MS = 12_000

function toReason(err: GeolocationPositionError): GeoError {
  if (err.code === err.PERMISSION_DENIED) return 'denied'
  if (err.code === err.TIMEOUT) return 'timeout'
  return 'unavailable'
}

function toFix(pos: GeolocationPosition): GeoFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  }
}

export function useGeolocation() {
  const watchIdRef = useRef<number | null>(null)
  const budgetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (budgetTimerRef.current != null) {
      clearTimeout(budgetTimerRef.current)
      budgetTimerRef.current = null
    }
  }, [])

  const watch = useCallback(
    (handlers: WatchHandlers) => {
      if (!('geolocation' in navigator)) {
        handlers.onError?.('unsupported')
        return
      }
      // A second tap restarts cleanly rather than running two watches.
      stop()

      let gotAnyFix = false
      let triedCoarseFallback = false

      const finish = () => {
        stop()
        handlers.onDone?.()
      }

      const onPos = (pos: GeolocationPosition) => {
        gotAnyFix = true
        const fix = toFix(pos)
        handlers.onFix(fix)
        if (fix.accuracy <= GOOD_ACCURACY_M) finish()
      }

      const onErr = (err: GeolocationPositionError) => {
        // If a precise fix timed out before we got *anything*, fall back once to
        // a fast coarse fix so the user still lands near their location.
        if (!gotAnyFix && !triedCoarseFallback && err.code === err.TIMEOUT) {
          triedCoarseFallback = true
          stop()
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              handlers.onFix(toFix(pos))
              handlers.onDone?.()
            },
            (e2) => handlers.onError?.(toReason(e2)),
            { enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60_000 },
          )
          return
        }
        if (!gotAnyFix) {
          stop()
          handlers.onError?.(toReason(err))
        }
        // If we already have a fix, ignore later watch errors — keep the best one.
      }

      watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        timeout: FIX_TIMEOUT_MS,
        maximumAge: 0,
      })
      // Always stop refining after the budget, even if accuracy never improves.
      budgetTimerRef.current = setTimeout(finish, REFINE_BUDGET_MS)
    },
    [stop],
  )

  const getOnce = useCallback((handlers: WatchHandlers) => {
    if (!('geolocation' in navigator)) {
      handlers.onError?.('unsupported')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handlers.onFix(toFix(pos))
        handlers.onDone?.()
      },
      (err) => handlers.onError?.(toReason(err)),
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 30_000 },
    )
  }, [])

  // Never leave a watch running after the consumer unmounts.
  useEffect(() => stop, [stop])

  return { watch, getOnce, stop }
}
