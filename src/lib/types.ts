/**
 * Core route types — shared across the pure libs, services, and UI.
 *
 * A route is modelled as ordered `points` (the user's anchors) plus a parallel
 * `modes` array, one entry per *gap* between consecutive points. Snapped
 * geometry is derived/cached separately (see `useRoute`), never stored here, so
 * the model stays small and serialisable (URL share + undo/redo history).
 */

export type TravelMode = 'foot' | 'bike' | 'car' | 'manual'
export type Unit = 'mi' | 'km'

export interface LatLng {
  lat: number
  lng: number
}

export interface RoutePoint {
  id: string
  lat: number
  lng: number
}

/** A snapped (or straight, for manual) path between two consecutive points. */
export interface Segment {
  mode: TravelMode
  /** Polyline from point[i] to point[i+1], inclusive of both endpoints. */
  coords: LatLng[]
  /** Length of `coords` in metres. */
  distance: number
  /** Estimated travel time in seconds (from the router, or a mode-speed estimate). */
  duration: number
  /** True when this is a straight-line placeholder awaiting an async snap. */
  pending: boolean
  /** True when the last snap attempt failed (falls back to straight line). */
  error?: boolean
}

/** The minimal, serialisable route state. Everything else derives from this. */
export interface RouteCore {
  points: RoutePoint[]
  /** One mode per gap — length is always `max(0, points.length - 1)`. */
  modes: TravelMode[]
  /** Mode applied to newly-created segments. */
  defaultMode: TravelMode
  unit: Unit
}

export const TRAVEL_MODES: TravelMode[] = ['foot', 'bike', 'car', 'manual']

export const MODE_CHARS: Record<TravelMode, string> = {
  foot: 'f',
  bike: 'b',
  car: 'c',
  manual: 'm',
}

export const CHAR_MODES: Record<string, TravelMode> = {
  f: 'foot',
  b: 'bike',
  c: 'car',
  m: 'manual',
}

let _counter = 0

/** Stable unique id for a route point. */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  _counter += 1
  return `p${_counter.toString(36)}-${_counter}`
}
