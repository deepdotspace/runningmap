/**
 * /create — the route planner. Full-bleed MapLibre map under floating-glass
 * panels: travel-mode pill, place search, selected-point controls, the distance
 * + actions bar, and a collapsible elevation profile. Route state lives in the
 * URL (`?r=`) so every route is shareable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useMutations } from 'deepspace'
import { RouteMap, type RouteMapHandle } from '../components/map/RouteMap'
import { SearchBox } from '../components/planner/SearchBox'
import { DiscoverPanel } from '../components/planner/DiscoverPanel'
import { ShapePanel, type ShapeDrawMeta } from '../components/planner/ShapePanel'
import { RoutePlannerPanel, type PlanMeta } from '../components/planner/RoutePlannerPanel'
import { SelectedPointPanel } from '../components/planner/SelectedPointPanel'
import { BottomBar } from '../components/planner/BottomBar'
import { ElevationProfile } from '../components/planner/ElevationProfile'
import { PlannerHint } from '../components/planner/PlannerHint'
import { useToast, ConfirmModal } from '../components/ui'
import { useRoute } from '../hooks/useRoute'
import { useElevation } from '../hooks/useElevation'
import { decodeRoute, encodeRoute } from '../lib/share'
import { M_PER_DEG } from '../lib/geo'
import { encodePolyline } from '../lib/polyline'
import { dominantMode, type GeomCache } from '../lib/route-model'
import { reverseGeocode } from '../services/geocoding'
import type { TravelMode } from '../lib/types'
import { buildGpx, downloadGpx } from '../lib/gpx'
import { distanceIn, formatDistance } from '../lib/units'
import type { LatLng, RouteCore } from '../lib/types'
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from '../services/config'
import type { ElevationPoint } from '../hooks/useElevation'

interface RouteRecord {
  name: string
  encoded: string
  distanceMeters: number
  durationSeconds: number
  unit: string
  /** Encoded polyline of the *snapped* path — drives the route-shape thumbnail. */
  shape: string
  /** Primary travel mode (foot/bike/car/manual). */
  mode: TravelMode
  /** Human place label for where the route starts (best-effort, may be empty). */
  place: string
}

/** Linearly interpolate per-coordinate elevation from a sampled profile. */
function interpolateElevations(
  coords: LatLng[],
  profile: ElevationPoint[],
): Array<number | null> | undefined {
  if (profile.length < 2) return undefined
  // Cumulative distance per coord.
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]
    const b = coords[i]
    const dx = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
    const dy = b.lat - a.lat
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy) * M_PER_DEG)
  }
  let j = 0
  return coords.map((_, i) => {
    const d = cum[i]
    while (j < profile.length - 2 && profile[j + 1].dist < d) j += 1
    const p0 = profile[j]
    const p1 = profile[j + 1]
    const span = p1.dist - p0.dist
    const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (d - p0.dist) / span))
    return p0.ele + (p1.ele - p0.ele) * t
  })
}

// Below this zoom the map is showing a region/continent, not a runnable area, so
// "Plan a route" stays disabled (the default view sits at DEFAULT_ZOOM ≈ 3.4).
const MIN_PLAN_ZOOM = 10

export default function CreatePage() {
  const { isSignedIn } = useAuth()
  const { toast, success, error } = useToast()
  const { create } = useMutations<RouteRecord>('routes')

  // Decode any shared route from the URL exactly once.
  const initialCore = useMemo(() => {
    if (typeof window === 'undefined') return undefined
    const r = new URLSearchParams(window.location.search).get('r')
    return r ? (decodeRoute(r) ?? undefined) : undefined
  }, [])

  const route = useRoute(initialCore)
  const mapRef = useRef<RouteMapHandle>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  // Start collapsed — the elevation chart should only appear when the user opens
  // it from the bottom bar, not pop up on its own as soon as a route exists.
  const [elevationOpen, setElevationOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  // Current map zoom, tracked so "Plan a route" only generates once the user has
  // navigated to a local area — generating at the zoomed-out default view would
  // drop a route on the US-centroid fallback centre, far from anywhere useful.
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM)
  // A shape waiting on confirmation because it would replace the current route.
  const [pendingShape, setPendingShape] = useState<{ core: RouteCore; meta: ShapeDrawMeta } | null>(
    null,
  )
  // A planned route waiting on confirmation because it would replace the current one.
  const [pendingPlan, setPendingPlan] = useState<{
    core: RouteCore
    meta: PlanMeta
    geom?: GeomCache
  } | null>(null)

  const points = route.core.points
  const hasRoute = points.length >= 2
  const encoded = useMemo(
    () => (points.length ? encodeRoute(route.core) : ''),
    [route.core, points.length],
  )

  // Keep the shareable URL in sync. Debounced because route.core mutates on
  // every drag frame (~60fps) — calling replaceState per frame trips the
  // browser's "more than 100 times per 10 seconds" throttle. A single trailing
  // write after edits settle is all the share URL needs.
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href)
      if (encoded) url.searchParams.set('r', encoded)
      else url.searchParams.delete('r')
      // Skip no-op writes (e.g. the mount-time pass re-stamping the same ?r=).
      if (url.toString() !== window.location.href) {
        window.history.replaceState(null, '', url.toString())
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [encoded])

  // Drop a stale selection when points shrink.
  useEffect(() => {
    if (selectedIndex != null && selectedIndex >= points.length) setSelectedIndex(null)
  }, [points.length, selectedIndex])

  const elevation = useElevation(route.coords, true)

  // Fit a freshly-loaded shared route into view once the map is ready.
  const fitInitial = useCallback(() => {
    if (initialCore && route.coords.length >= 2) mapRef.current?.fitToRoute(route.coords)
  }, [initialCore, route.coords])

  // Load a generated shape as the working route. Shapes are always the exact
  // outline (manual segments), so the committed points ARE the rendered geometry
  // — we fit to them directly. A toast states how it was made (built-in vs
  // traced-from-icon) so the source is never ambiguous.
  const applyShape = useCallback(
    (core: RouteCore, meta: ShapeDrawMeta) => {
      // commitCore (not loadCore) so drawing a shape is an undoable history step.
      route.commitCore(core)
      setSelectedIndex(null)
      requestAnimationFrame(() => {
        mapRef.current?.fitToRoute(core.points.map((p) => ({ lat: p.lat, lng: p.lng })))
      })
      const how = meta.source === 'icon' ? 'Traced from an icon (free)' : 'Built-in shape'
      success(`Drew “${meta.word}”`, `${how} · exact outline`)
    },
    [route, success],
  )

  // Drawing replaces the current route — confirm first so we never silently wipe
  // the user's in-progress work.
  const handleShapeDraw = useCallback(
    (core: RouteCore, meta: ShapeDrawMeta) => {
      if (points.length > 0) setPendingShape({ core, meta })
      else applyShape(core, meta)
    },
    [points.length, applyShape],
  )

  // Load a generated plan as the working route. Reuses the same commit + fit
  // body as applyShape (the duplication is a few lines and keeps the typed
  // shape state untouched). Snapped geometry is async, so we fit the raw seed.
  const applyPlan = useCallback(
    (core: RouteCore, meta: PlanMeta, geom?: GeomCache) => {
      route.commitCore(core, geom)
      setSelectedIndex(null)
      requestAnimationFrame(() => {
        mapRef.current?.fitToRoute(core.points.map((p) => ({ lat: p.lat, lng: p.lng })))
      })
      const kind = meta.type === 'loop' ? 'loop' : 'out-and-back'
      // Show the measured snapped length when we have it (the route was fitted to
      // the target), else the target with a "~". The bottom bar shows live total.
      const shown =
        meta.meters > 0
          ? `${distanceIn(meta.meters, core.unit).toFixed(1)} ${core.unit}`
          : `~${distanceIn(meta.targetMeters, core.unit).toFixed(1)} ${core.unit}`
      success(`Planned a ${shown} ${kind}`, 'Fitted to roads · edit any point')
    },
    [route, success],
  )

  // Generating a plan replaces the current route — confirm first.
  const handlePlanGenerate = useCallback(
    (core: RouteCore, meta: PlanMeta, geom?: GeomCache) => {
      if (points.length > 0) setPendingPlan({ core, meta, geom })
      else applyPlan(core, meta, geom)
    },
    [points.length, applyPlan],
  )

  const handleDeleteRequest = useCallback(() => {
    if (selectedIndex != null) {
      route.deletePointAt(selectedIndex)
      setSelectedIndex(null)
    } else if (points.length > 0) {
      route.deletePointAt(points.length - 1)
    }
  }, [route, selectedIndex, points.length])

  const handleExport = useCallback(() => {
    if (route.coords.length < 2) return
    const eles = interpolateElevations(route.coords, elevation.profile)
    const gpx = buildGpx({ name: 'runningmap route', coords: route.coords, elevations: eles })
    downloadGpx(`route-${Date.now()}.gpx`, gpx)
    toast({ type: 'success', title: 'GPX exported', description: `${route.coords.length} track points` })
  }, [route.coords, elevation.profile, toast])

  const handleShare = useCallback(async () => {
    // Derive the link from `encoded` directly, mirroring the URL-sync effect, so
    // a share is always current even inside the effect's debounce window (e.g.
    // sharing right after Clear must not copy the stale ?r= still in the bar).
    const url = new URL(window.location.href)
    if (encoded) url.searchParams.set('r', encoded)
    else url.searchParams.delete('r')
    try {
      await navigator.clipboard.writeText(url.toString())
      success('Link copied', 'Shareable route URL is on your clipboard')
    } catch {
      toast({ type: 'info', title: 'Share link', description: url.toString() })
    }
  }, [encoded, success, toast])

  const handleSave = useCallback(async () => {
    if (!hasRoute) return
    setSaving(true)
    try {
      // Best-effort place label for the start; never let it block/fail the save.
      const start = route.coords[0] ?? route.core.points[0]
      const place = start ? (await reverseGeocode(start.lat, start.lng).catch(() => null)) ?? '' : ''
      await create({
        name: `Route · ${formatDistance(route.totalMeters, route.core.unit)}`,
        encoded,
        distanceMeters: Math.round(route.totalMeters),
        durationSeconds: Math.round(route.totalSeconds),
        unit: route.core.unit,
        // Store the full snapped geometry so My Routes can sketch the real shape.
        shape: encodePolyline(route.coords),
        mode: dominantMode(route.core),
        place,
      })
      success('Route saved', 'Find it under My Routes')
    } catch {
      error('Could not save', 'Please try again')
    } finally {
      setSaving(false)
    }
  }, [
    hasRoute,
    create,
    encoded,
    route.coords,
    route.core,
    route.totalMeters,
    route.totalSeconds,
    success,
    error,
  ])

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-testid="planner"
      data-map-ready={mapReady ? 'true' : 'false'}
    >
      <RouteMap
        ref={mapRef}
        styleUrl={MAP_STYLE_URL}
        points={points}
        segments={route.segments}
        selectedIndex={selectedIndex}
        onReady={() => {
          setMapReady(true)
          fitInitial()
        }}
        onMoveEnd={setMapZoom}
        onMapClick={(at) => {
          route.addPointAt(at)
          setSelectedIndex(null)
        }}
        onSelectPoint={setSelectedIndex}
        onDeletePoint={(i) => {
          route.deletePointAt(i)
          setSelectedIndex(null)
        }}
        onDeleteRequest={handleDeleteRequest}
        onPointDragStart={route.beginPointDrag}
        onPointDrag={route.dragPoint}
        onPointDragEnd={route.endPointDrag}
        onInsert={route.beginInsert}
      />

      {/* First-run guidance over an empty map */}
      {points.length === 0 && <PlannerHint />}

      {/* Top-right: place search, tucked under the profile pill. Sits in the
          right corner alongside the account menu, clear of the left-edge tools. */}
      <div className="pointer-events-none absolute right-3 top-[4.5rem] z-10 flex flex-col items-end gap-2">
        <SearchBox
          onPick={(r) => {
            // Drop a waypoint at the exact searched spot and fly there — the
            // dropped pin + recentre make it unmistakable without auto-selecting
            // it (auto-select would pop the point panel over the centre of the map).
            route.addPointAt({ lat: r.lat, lng: r.lng })
            mapRef.current?.flyTo(r.lat, r.lng, 16)
          }}
          getCenter={() => mapRef.current?.getCenter() ?? DEFAULT_CENTER}
        />
      </div>

      {/* Top-left: tools that aren't search — discover parks + draw a shape.
          Sits directly under the title block (same top as the right-edge search
          row) so the two corners line up and there's no gap as the viewport
          narrows. The nav's mobile menu (z-50) overlays these when opened. */}
      <div className="pointer-events-none absolute left-3 top-[4.5rem] z-10 flex flex-col items-start gap-2">
        <DiscoverPanel
          getCenter={() => mapRef.current?.getCenter() ?? DEFAULT_CENTER}
          onFlyTo={(lat, lng, zoom) => mapRef.current?.flyTo(lat, lng, zoom)}
          onPickPlace={(lat, lng) => {
            // Drop a waypoint at the park and fly there — but don't auto-select
            // it, so picking a park no longer pops the point panel mid-map.
            route.addPointAt({ lat, lng })
            mapRef.current?.flyTo(lat, lng, 16)
          }}
          unit={route.core.unit}
        />
        <ShapePanel
          getCenter={() => mapRef.current?.getCenter() ?? DEFAULT_CENTER}
          onDraw={handleShapeDraw}
          unit={route.core.unit}
        />
        <RoutePlannerPanel
          getCenter={() => mapRef.current?.getCenter() ?? DEFAULT_CENTER}
          onGenerate={handlePlanGenerate}
          unit={route.core.unit}
          mode={route.core.defaultMode}
          // Only let the user generate once they've zoomed/panned to a real area
          // (search, geolocation, or manual nav all lift the zoom well past this).
          ready={mapZoom >= MIN_PLAN_ZOOM}
        />
      </div>

      {/* Selected point controls — only shown when the user deliberately taps a
          point (searching/picking a place no longer auto-selects). Pinned to the
          top, not the centre of the map. */}
      {selectedIndex != null && selectedIndex < points.length && (
        <div className="pointer-events-none absolute left-1/2 top-[4.5rem] z-20 flex -translate-x-1/2 justify-center px-3">
          <SelectedPointPanel
            index={selectedIndex}
            total={points.length}
            incomingMode={selectedIndex > 0 ? route.core.modes[selectedIndex - 1] : null}
            onChangeIncomingMode={(mode) => route.setSegMode(selectedIndex - 1, mode)}
            onDelete={() => {
              route.deletePointAt(selectedIndex)
              setSelectedIndex(null)
            }}
            onClose={() => setSelectedIndex(null)}
          />
        </div>
      )}

      {/* Bottom-center: elevation + actions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2 px-3">
        {elevationOpen && hasRoute && (
          <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-card/85 p-3 shadow-xl backdrop-blur-md">
            <ElevationProfile
              profile={elevation.profile}
              status={elevation.status}
              gain={elevation.gain}
              loss={elevation.loss}
              unit={route.core.unit}
            />
          </div>
        )}
        <BottomBar
          totalMeters={route.totalMeters}
          totalSeconds={route.totalSeconds}
          unit={route.core.unit}
          onToggleUnit={() => route.setUnit(route.core.unit === 'mi' ? 'km' : 'mi')}
          mode={route.core.defaultMode}
          // The bottom-bar mode pill is the route's primary travel mode, so it
          // re-modes every existing leg (and the default for new ones) — not just
          // future legs. This is what makes a route you switch to "Drive" save as
          // Drive (dominantMode) instead of staying Walk.
          onModeChange={route.applyModeToAll}
          pointCount={points.length}
          snapping={route.snapping}
          canUndo={route.canUndo}
          canRedo={route.canRedo}
          onUndo={route.undo}
          onRedo={route.redo}
          onClear={() => {
            route.clear()
            setSelectedIndex(null)
          }}
          onReverse={route.reverseRoute}
          onReturnToStart={route.loopToStart}
          onOutBack={route.outBack}
          onExportGpx={handleExport}
          onShare={handleShare}
          onSave={isSignedIn ? handleSave : null}
          saving={saving}
          elevationOpen={elevationOpen}
          onToggleElevation={() => setElevationOpen((v) => !v)}
        />
      </div>

      {/* Drawing a shape replaces the working route — confirm first. */}
      <ConfirmModal
        open={pendingShape != null}
        onClose={() => setPendingShape(null)}
        onConfirm={() => {
          if (pendingShape) applyShape(pendingShape.core, pendingShape.meta)
          setPendingShape(null)
        }}
        title="Replace current route?"
        description="Drawing this shape will clear the route you have now. This can be undone."
        confirmText="Replace"
        variant="default"
      />

      {/* Generating a plan replaces the working route — confirm first. */}
      <ConfirmModal
        open={pendingPlan != null}
        onClose={() => setPendingPlan(null)}
        onConfirm={() => {
          if (pendingPlan) applyPlan(pendingPlan.core, pendingPlan.meta, pendingPlan.geom)
          setPendingPlan(null)
        }}
        title="Replace current route?"
        description="Generating this route will clear the route you have now. This can be undone."
        confirmText="Replace"
        variant="default"
      />
    </div>
  )
}
