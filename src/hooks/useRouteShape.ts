/**
 * useRouteShape — resolves the *detailed* geometry of a saved route for preview.
 *
 * Saved records store a compact core (anchor points) plus, for newer saves, an
 * encoded snapped `shape`. We render the richest geometry we can:
 *   1. a stored shape that's clearly detailed (more points than anchors) → use it
 *   2. an all-manual route → the anchors already ARE the shape
 *   3. otherwise (old saves, or saves made before snapping finished) → re-snap
 *      from the core via the routing service so crooked paths show their curves.
 *
 * The anchors render instantly as a placeholder; the snapped path replaces them
 * when it arrives.
 */

import { useEffect, useMemo, useState } from 'react'
import { createLimiter } from '../lib/limiter'
import { decodePolyline } from '../lib/polyline'
import { decodeRoute } from '../lib/share'
import type { LatLng, RouteCore } from '../lib/types'
import { routingService } from '../services/routing'

// Saved-route previews mount one card per route/run. Without a SHARED throttle,
// every un-shaped card would fire its own snap chain at the public routing server
// at once (which rate-limits bursts). One module-level limiter caps total
// in-flight snap requests across all mounted cards — mirroring useRoute's cap.
const SHARED_SNAP_LIMIT = 5
const snapLimiter = createLimiter(SHARED_SNAP_LIMIT)

// Cache resolved geometry by encoded route so multiple cards linking the same
// (un-shaped) route snap once. Bounded to keep memory in check.
const MAX_SNAP_CACHE = 64
const snapCache = new Map<string, LatLng[]>()

function flatten(out: LatLng[], pts: LatLng[]): void {
  for (let i = 0; i < pts.length; i += 1) {
    if (i === 0 && out.length > 0) {
      const last = out[out.length - 1]
      if (last.lat === pts[0].lat && last.lng === pts[0].lng) continue
    }
    out.push(pts[i])
  }
}

/** Snap every non-manual gap of a core and return the flattened path. */
async function snapCore(core: RouteCore, signal: AbortSignal): Promise<LatLng[]> {
  const out: LatLng[] = []
  for (let i = 0; i < core.modes.length; i += 1) {
    const a = core.points[i]
    const b = core.points[i + 1]
    const mode = core.modes[i]
    if (mode === 'manual') {
      flatten(out, [a, b])
      continue
    }
    try {
      const leg = await snapLimiter.run(() => routingService.snap(mode, a, b, signal))
      flatten(out, leg.coords)
    } catch {
      flatten(out, [a, b]) // straight fallback keeps the route continuous
    }
  }
  return out
}

export function useRouteShape(encoded: string, shape?: string): LatLng[] {
  const core = useMemo(() => decodeRoute(encoded), [encoded])
  const anchors = useMemo<LatLng[]>(
    () => core?.points.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [],
    [core],
  )
  const stored = useMemo<LatLng[] | null>(() => {
    if (!shape) return null
    try {
      return decodePolyline(shape)
    } catch {
      return null
    }
  }, [shape])

  const hasSnapMode = core?.modes.some((m) => m !== 'manual') ?? false
  // A stored shape counts as detailed if it has more points than anchors, or if
  // the route is all-manual (where anchors are the true shape anyway).
  const storedDetailed = !!stored && (stored.length > anchors.length || !hasSnapMode)

  const [coords, setCoords] = useState<LatLng[]>(() => (storedDetailed ? (stored as LatLng[]) : anchors))

  useEffect(() => {
    if (storedDetailed) {
      setCoords(stored as LatLng[])
      return
    }
    // Manual-only route: anchors are already the full shape.
    if (!hasSnapMode || !core || core.points.length < 2) {
      setCoords(anchors)
      return
    }
    // Reuse a previously-snapped result for this exact route (e.g. several
    // activity cards linking the same route) instead of re-snapping.
    const cached = snapCache.get(encoded)
    if (cached) {
      setCoords(cached)
      return
    }
    setCoords(anchors) // instant placeholder while we re-snap
    const ctrl = new AbortController()
    snapCore(core, ctrl.signal)
      .then((c) => {
        if (ctrl.signal.aborted || c.length < 2) return
        if (snapCache.size >= MAX_SNAP_CACHE) {
          const oldest = snapCache.keys().next().value
          if (oldest !== undefined) snapCache.delete(oldest)
        }
        snapCache.set(encoded, c)
        setCoords(c)
      })
      .catch(() => {
        /* keep anchors */
      })
    return () => ctrl.abort()
  }, [encoded, shape, anchors, core, hasSnapMode, stored, storedDetailed])

  return coords
}
