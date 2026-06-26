/**
 * RouteMap — MapLibre GL canvas with the full route-editing interaction set:
 * click to add, drag a vertex to move, drag a segment to insert, shift-click to
 * delete; plus the on-map control stack (zoom, globe projection, locate,
 * fullscreen) and keyboard support (arrows pan, Space adds at centre, Del
 * removes). All map mechanics live here so the rest of the app stays declarative.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Marker as MlMarker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Globe, Loader2, LocateFixed, LocateOff, Maximize, Minimize, Minus, Plus, Trash2 } from 'lucide-react'
import type { LatLng, RoutePoint, Segment } from '../../lib/types'
import { bounds, circleRing } from '../../lib/geo'
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../services/config'
import { useGeolocation, type GeoFix } from '../../hooks/useGeolocation'
import { useToast } from '../ui'
import { cn } from '../ui/utils'
import './route-map.css'

const ROUTE_SOURCE = 'route'
const ROUTE_CASING = 'route-casing'
const ROUTE_LINE = 'route-line'
const ROUTE_HIT = 'route-hit'
// Translucent metric circle showing the geolocation fix's uncertainty. Drawn as
// a polygon (a MapLibre `circle` layer is sized in pixels, not metres).
const USER_ACC_SOURCE = 'user-accuracy'
const USER_ACC_FILL = 'user-accuracy-fill'
const USER_ACC_LINE = 'user-accuracy-line'

// Press within this many screen pixels of an existing vertex counts as "grab the
// vertex", never "insert on the line". Slightly larger than the marker's own hit
// box so a near-miss on the dot can't accidentally drop a new point on top of it.
const VERTEX_GRAB_PX = 16
// Pointer travel (px) before a marker press is treated as a drag rather than a
// click. Keeps a slightly shaky click on the dot as a select, not a nudge.
const DRAG_THRESHOLD_PX = 3

// Line colours — Apple Maps palette: system red route with a white casing,
// a lighter red while the snap is pending, and system orange on error.
const COLOR_OK = '#ff3b30' // systemRed
const COLOR_PENDING = '#ff7a73' // light systemRed
const COLOR_ERROR = '#ff9500' // systemOrange
const COLOR_CASING = '#ffffff'

export interface RouteMapHandle {
  flyTo(lat: number, lng: number, zoom?: number): void
  fitToRoute(coords: LatLng[]): void
  getCenter(): LatLng
}

interface RouteMapProps {
  styleUrl: string
  points: RoutePoint[]
  segments: Segment[]
  selectedIndex: number | null
  onMapClick: (at: LatLng) => void
  onSelectPoint: (index: number | null) => void
  onDeletePoint: (index: number) => void
  onDeleteRequest: () => void
  onPointDragStart: () => void
  onPointDrag: (index: number, at: LatLng) => void
  onPointDragEnd: (index: number, at: LatLng) => void
  onInsert: (segIndex: number, at: LatLng) => number
  onReady?: () => void
  /** Fires after the view settles (pan/zoom/flyTo/fit), with the current zoom. */
  onMoveEnd?: (zoom: number) => void
}

function routeFeatureCollection(segments: Segment[]) {
  return {
    type: 'FeatureCollection' as const,
    features: segments.map((seg, i) => ({
      type: 'Feature' as const,
      properties: {
        segIndex: i,
        state: seg.error ? 'error' : seg.pending ? 'pending' : 'ok',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: seg.coords.map((c) => [c.lng, c.lat]),
      },
    })),
  }
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

/** A filled circle polygon (in metres) for the geolocation accuracy halo. */
function accuracyFeature(fix: GeoFix) {
  const ring = circleRing({ lat: fix.lat, lng: fix.lng }, Math.max(fix.accuracy, 1))
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring.map((p) => [p.lng, p.lat])],
        },
      },
    ],
  }
}

export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(
  props,
  ref,
) {
  const {
    styleUrl,
    points,
    segments,
    selectedIndex,
    onMapClick,
    onSelectPoint,
    onDeletePoint,
    onDeleteRequest,
    onPointDragStart,
    onPointDrag,
    onPointDragEnd,
    onInsert,
  } = props

  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<Map<string, { marker: MlMarker; el: HTMLDivElement }>>(new Map())
  const userLocRef = useRef<MlMarker | null>(null)
  // Detaches the in-flight insert-drag listeners (window mouseup + map mousemove).
  // Held so unmount mid-drag can remove them — see the segment drag-to-insert.
  const insertTeardownRef = useRef<(() => void) | null>(null)
  // Latest geolocation fix, kept so the accuracy circle can be re-applied after
  // a style swap (which wipes layer data) — see addRouteLayers.
  const userFixRef = useRef<GeoFix | null>(null)
  const [ready, setReady] = useState(false)
  const [projection, setProjection] = useState<'mercator' | 'globe'>('mercator')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [locating, setLocating] = useState(false)
  // Whether a "you are here" dot + accuracy halo is currently shown, so we can
  // offer a one-tap dismiss for it.
  const [hasFix, setHasFix] = useState(false)
  // Drag-to-delete: a drop zone appears while a waypoint is being dragged; if the
  // point is released over it, that single point is removed (no full clear).
  const [draggingPoint, setDraggingPoint] = useState(false)
  const [overTrash, setOverTrash] = useState(false)
  const overTrashRef = useRef(false)
  const trashRef = useRef<HTMLDivElement>(null)
  const { watch: watchLocation, stop: stopLocation } = useGeolocation()
  const { error: toastError } = useToast()

  // Latest values for use inside imperative map event handlers.
  const pointsRef = useRef(points)
  pointsRef.current = points
  const draggingId = useRef<string | null>(null)
  const markerMoved = useRef(false)
  const suppressClick = useRef(false)
  const cbRef = useRef(props)
  cbRef.current = props

  const indexOfId = useCallback(
    (id: string) => pointsRef.current.findIndex((p) => p.id === id),
    [],
  )

  // ── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })
    mapRef.current = map

    const addRouteLayers = () => {
      if (map.getSource(ROUTE_SOURCE)) return
      // Accuracy halo first so the route line draws above it. Re-seed with the
      // current fix so it survives a runtime style swap (globe toggle).
      map.addSource(USER_ACC_SOURCE, {
        type: 'geojson',
        data: userFixRef.current ? accuracyFeature(userFixRef.current) : EMPTY_FC,
      })
      map.addLayer({
        id: USER_ACC_FILL,
        type: 'fill',
        source: USER_ACC_SOURCE,
        paint: { 'fill-color': COLOR_OK, 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: USER_ACC_LINE,
        type: 'line',
        source: USER_ACC_SOURCE,
        paint: { 'line-color': COLOR_OK, 'line-width': 1.5, 'line-opacity': 0.5 },
      })
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: routeFeatureCollection([]),
      })
      map.addLayer({
        id: ROUTE_CASING,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLOR_CASING, 'line-width': 7, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: ROUTE_LINE,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 4,
          'line-color': [
            'match',
            ['get', 'state'],
            'pending',
            COLOR_PENDING,
            'error',
            COLOR_ERROR,
            COLOR_OK,
          ],
        },
      })
      // Invisible wide line to make segment grabbing forgiving.
      map.addLayer({
        id: ROUTE_HIT,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 20, 'line-opacity': 0 },
      })
    }

    map.on('load', () => {
      addRouteLayers()
      map.resize()
      setReady(true)
      cbRef.current.onReady?.()
    })
    // Re-add layers if the style is swapped at runtime.
    map.on('styledata', addRouteLayers)

    // Report the zoom whenever the view settles, so features that only make
    // sense once the user has navigated to a local area (e.g. "Plan a route")
    // can gate on it rather than acting on the zoomed-out default view.
    map.on('moveend', () => cbRef.current.onMoveEnd?.(map.getZoom()))

    // Click empty map → add a point.
    map.on('click', (e) => {
      if (suppressClick.current) {
        suppressClick.current = false
        return
      }
      cbRef.current.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    // Segment drag-to-insert.
    map.on('mouseenter', ROUTE_HIT, () => {
      map.getCanvas().style.cursor = 'copy'
    })
    map.on('mouseleave', ROUTE_HIT, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('mousedown', ROUTE_HIT, (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      const segIndex = Number(feature.properties?.segIndex ?? -1)
      if (segIndex < 0) return
      // If the press is on/near an existing vertex, this is a vertex grab that
      // leaked onto the canvas — let the marker handle it (or do nothing) rather
      // than inserting a brand-new point right on top of the vertex.
      for (const p of pointsRef.current) {
        const px = map.project([p.lng, p.lat])
        const dx = px.x - e.point.x
        const dy = px.y - e.point.y
        if (dx * dx + dy * dy <= VERTEX_GRAB_PX * VERTEX_GRAB_PX) return
      }
      e.preventDefault() // stop the map from panning
      const at = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      const newIndex = cbRef.current.onInsert(segIndex, at)
      // Insert can be rejected (e.g. max waypoints). Bail BEFORE arming
      // suppressClick, or the flag stays stuck and swallows the next real click.
      if (newIndex < 0) return
      suppressClick.current = true

      // Track the last on-canvas position so the release commits where the point
      // actually is, even if the pointer leaves the canvas before letting go.
      let lastAt = at
      const move = (ev: MapMouseEvent) => {
        lastAt = { lat: ev.lngLat.lat, lng: ev.lngLat.lng }
        cbRef.current.onPointDrag(newIndex, lastAt)
      }
      const teardown = () => {
        map.off('mousemove', move)
        window.removeEventListener('mouseup', finish)
        insertTeardownRef.current = null
      }
      // End the insert-drag on a WINDOW mouseup, not map.on('mouseup'): MapLibre
      // map events only fire for releases over the canvas, so letting go over one
      // of the planner's overlay panels (or off the map) misses a map-scoped
      // mouseup — leaving the drag (and the deferred road-snap of the two new
      // legs) stuck pending, so the new point's legs never snap. A window
      // listener always fires. (This is also why we track teardown in a ref: the
      // window/map listeners must be removed if we unmount mid-drag, since
      // map.remove() only disposes map-scoped ones.)
      const finish = () => {
        teardown()
        cbRef.current.onPointDragEnd(newIndex, lastAt)
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }
      insertTeardownRef.current = teardown
      map.on('mousemove', move)
      window.addEventListener('mouseup', finish)
    })

    const resizeObs = new ResizeObserver(() => map.resize())
    if (containerRef.current) resizeObs.observe(containerRef.current)

    return () => {
      // Detach any in-flight insert-drag listeners; map.remove() below only
      // disposes map-scoped ones, not the window mouseup.
      insertTeardownRef.current?.()
      resizeObs.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      userLocRef.current = null
      setReady(false)
    }
    // Map init runs once; `styleUrl` is read only here (it's a module constant,
    // not a reactive prop). If it ever becomes dynamic, add a `map.setStyle` effect.
  }, [])

  // ── Keyboard: Space adds at centre, Del removes ──────────────────────────
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        const map = mapRef.current
        if (!map) return
        const c = map.getCenter()
        cbRef.current.onMapClick({ lat: c.lat, lng: c.lng })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        cbRef.current.onDeleteRequest()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  // ── Projection (globe) toggle ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    try {
      map.setProjection({ type: projection })
    } catch {
      // Older MapLibre without globe support — stay on mercator.
    }
  }, [projection, ready])

  // ── Fullscreen sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current)
      mapRef.current?.resize()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ── Markers sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const store = markersRef.current
    const liveIds = new Set(points.map((p) => p.id))

    // Remove stale markers.
    for (const [id, entry] of store) {
      if (!liveIds.has(id)) {
        entry.marker.remove()
        store.delete(id)
      }
    }

    points.forEach((p, index) => {
      const role =
        index === 0 ? 'start' : index === points.length - 1 && points.length > 1 ? 'end' : 'mid'
      const className =
        `rm-marker rm-marker--${role}` + (index === selectedIndex ? ' rm-marker--selected' : '')

      let entry = store.get(p.id)
      if (!entry) {
        const el = document.createElement('div')
        // Inner dot holds all visuals/hover; the outer el is what MapLibre
        // transforms, so it must stay transition-free (see route-map.css).
        const dot = document.createElement('div')
        dot.className = 'rm-marker__dot'
        el.appendChild(dot)
        const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true })
        marker.setLngLat([p.lng, p.lat]).addTo(map)

        // Pixel position where the press began; used to ignore sub-threshold
        // jitter so a click that wiggles a pixel still selects the point.
        let downPx: { x: number; y: number } | null = null

        // Is the dragged dot currently hovering the delete drop zone? Compared in
        // viewport coords (project gives container-relative px; offset by the
        // container's rect). The zone is pointer-events-none so it never steals
        // the drag — detection is purely geometric.
        const isOverTrash = () => {
          const el = trashRef.current
          if (!el) return false
          const r = el.getBoundingClientRect()
          const c = map.getContainer().getBoundingClientRect()
          const sp = map.project(marker.getLngLat())
          const x = c.left + sp.x
          const y = c.top + sp.y
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        }
        const setOver = (over: boolean) => {
          if (over !== overTrashRef.current) {
            overTrashRef.current = over
            setOverTrash(over)
          }
        }

        marker.on('dragstart', () => {
          draggingId.current = p.id
          markerMoved.current = false
          const ll = marker.getLngLat()
          downPx = map.project([ll.lng, ll.lat])
        })
        marker.on('drag', () => {
          const ll = marker.getLngLat()
          if (!markerMoved.current) {
            const px = map.project([ll.lng, ll.lat])
            const dx = px.x - (downPx?.x ?? px.x)
            const dy = px.y - (downPx?.y ?? px.y)
            if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
            // First real movement: take the history snapshot, begin the drag, and
            // reveal the delete drop zone.
            markerMoved.current = true
            cbRef.current.onPointDragStart()
            setDraggingPoint(true)
          }
          setOver(isOverTrash())
          const idx = indexOfId(p.id)
          if (idx >= 0) cbRef.current.onPointDrag(idx, { lat: ll.lat, lng: ll.lng })
        })
        marker.on('dragend', () => {
          const idx = indexOfId(p.id)
          const droppedOnTrash = markerMoved.current && overTrashRef.current
          if (droppedOnTrash && idx >= 0) {
            // Released over the trash → delete just this point.
            cbRef.current.onDeletePoint(idx)
          } else if (markerMoved.current) {
            const ll = marker.getLngLat()
            if (idx >= 0) cbRef.current.onPointDragEnd(idx, { lat: ll.lat, lng: ll.lng })
          } else if (idx >= 0) {
            // Sub-threshold "drag" — MapLibre nudged the marker element a couple
            // pixels; snap it back to the real point so the click reads as a select.
            const cur = pointsRef.current[idx]
            if (cur) marker.setLngLat([cur.lng, cur.lat])
          }
          draggingId.current = null
          setDraggingPoint(false)
          setOver(false)
        })
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (markerMoved.current) {
            markerMoved.current = false
            return
          }
          const idx = indexOfId(p.id)
          if (idx < 0) return
          if (ev.shiftKey) cbRef.current.onDeletePoint(idx)
          else cbRef.current.onSelectPoint(idx)
        })
        entry = { marker, el }
        store.set(p.id, entry)
      }

      entry.el.className = className
      entry.el.setAttribute('role', 'button')
      entry.el.setAttribute('tabindex', '-1')
      entry.el.setAttribute(
        'aria-label',
        `${role === 'start' ? 'Start' : role === 'end' ? 'Finish' : 'Waypoint'} ${index + 1}`,
      )
      // Don't fight an in-progress user drag.
      if (draggingId.current !== p.id) entry.marker.setLngLat([p.lng, p.lat])
    })
  }, [points, selectedIndex, ready, indexOfId])

  // ── Route line sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    source?.setData(routeFeatureCollection(segments))
  }, [segments, ready])

  // ── Imperative handle ────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      flyTo(lat, lng, zoom) {
        mapRef.current?.flyTo({ center: [lng, lat], zoom: zoom ?? 14, duration: 900 })
      },
      fitToRoute(coords) {
        const b = bounds(coords)
        if (!b || !mapRef.current) return
        mapRef.current.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: 80, maxZoom: 15, duration: 700 },
        )
      },
      getCenter() {
        const c = mapRef.current?.getCenter()
        return c ? { lat: c.lat, lng: c.lng } : DEFAULT_CENTER
      },
    }),
    [],
  )

  // Paint (or refresh) the "you are here" dot + accuracy circle at a fix.
  const renderUserFix = useCallback((fix: GeoFix) => {
    const map = mapRef.current
    if (!map) return
    if (!userLocRef.current) {
      const el = document.createElement('div')
      el.className = 'rm-user-location'
      userLocRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
    }
    userLocRef.current.setLngLat([fix.lng, fix.lat]).addTo(map)
    const src = map.getSource(USER_ACC_SOURCE) as GeoJSONSource | undefined
    src?.setData(accuracyFeature(fix))
    setHasFix(true)
  }, [])

  // Dismiss the "you are here" dot + accuracy halo. Also stops any in-flight
  // refining watch so a late fix can't re-draw what the user just cleared.
  const clearUserFix = useCallback(() => {
    stopLocation()
    setLocating(false)
    userFixRef.current = null
    userLocRef.current?.remove()
    userLocRef.current = null
    const map = mapRef.current
    const src = map?.getSource(USER_ACC_SOURCE) as GeoJSONSource | undefined
    src?.setData(EMPTY_FC)
    setHasFix(false)
  }, [stopLocation])

  const locate = useCallback(() => {
    if (locating) return
    setLocating(true)
    let framed = false
    watchLocation({
      // Each callback is a *better* fix; refresh the dot/circle every time and
      // frame the view once (on the first fix) so refinements don't yank the map.
      onFix: (fix) => {
        userFixRef.current = fix
        renderUserFix(fix)
        const map = mapRef.current
        if (map && !framed) {
          framed = true
          const b = bounds(circleRing({ lat: fix.lat, lng: fix.lng }, Math.max(fix.accuracy, 1)))
          if (b) {
            map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
              padding: 64,
              maxZoom: 16,
              duration: 600,
            })
          }
        }
      },
      onDone: () => setLocating(false),
      onError: (reason) => {
        setLocating(false)
        toastError(
          reason === 'denied'
            ? 'Location permission denied — enable it to use “My location”.'
            : reason === 'unsupported'
              ? 'Location isn’t available on this device.'
              : 'Couldn’t get your location. Try again.',
        )
      },
    })
  }, [locating, watchLocation, renderUserFix, toastError])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void wrapperRef.current?.requestFullscreen?.()
    }
  }, [])

  return (
    <div ref={wrapperRef} className="rm-wrapper absolute inset-0">
      {/* MapLibre forces position:relative on its container, which clobbers
          `inset-0`; use explicit full width/height so it fills the wrapper. */}
      <div ref={containerRef} className="h-full w-full" />
      <div className="rm-crosshair" aria-hidden />

      {/* Drag-to-delete drop zone — appears only while a waypoint is dragged.
          pointer-events-none so it can't interrupt the marker drag; overlap is
          detected geometrically (see the marker drag handler). */}
      {draggingPoint && (
        <div
          ref={trashRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-6 left-6 z-40 flex items-center gap-2 rounded-full border px-4 py-2.5 shadow-xl backdrop-blur-md transition-all duration-150',
            overTrash
              ? 'scale-110 border-destructive bg-destructive text-destructive-foreground'
              : 'border-border bg-card/90 text-muted-foreground',
          )}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="text-sm font-medium">
            {overTrash ? 'Release to delete' : 'Drag here to delete'}
          </span>
        </div>
      )}

      {/* On-map control stack (floating glass) — sits in the right column below
          the profile pill and the place-search box (both top-right; see
          create.tsx) so nothing overlaps. */}
      <div className="absolute right-3 top-32 z-10 flex flex-col gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-lg backdrop-blur-md">
          <CtrlButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <Plus className="h-4 w-4" />
          </CtrlButton>
          <div className="h-px bg-border" />
          <CtrlButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <Minus className="h-4 w-4" />
          </CtrlButton>
        </div>
        <CtrlButton
          label={projection === 'globe' ? 'Flat map' : 'Globe view'}
          active={projection === 'globe'}
          standalone
          onClick={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
        >
          <Globe className="h-4 w-4" />
        </CtrlButton>
        {hasFix ? (
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-lg backdrop-blur-md">
            <CtrlButton label="Recenter on me" active={locating} onClick={locate}>
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LocateFixed className="h-4 w-4" />
              )}
            </CtrlButton>
            <div className="h-px bg-border" />
            <CtrlButton label="Clear my location" onClick={clearUserFix}>
              <LocateOff className="h-4 w-4" />
            </CtrlButton>
          </div>
        ) : (
          <CtrlButton
            label={locating ? 'Locating…' : 'My location'}
            standalone
            active={locating}
            onClick={locate}
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LocateFixed className="h-4 w-4" />
            )}
          </CtrlButton>
        )}
        <CtrlButton label="Fullscreen" standalone onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </CtrlButton>
      </div>
    </div>
  )
})

function CtrlButton({
  label,
  onClick,
  children,
  active,
  standalone,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  standalone?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        'flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:bg-secondary ' +
        (standalone
          ? 'rounded-xl border border-border bg-card/80 shadow-lg backdrop-blur-md '
          : '') +
        (active ? 'bg-primary text-primary-foreground hover:bg-primary' : '')
      }
    >
      {children}
    </button>
  )
}
