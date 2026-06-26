/**
 * Compact, URL-safe encoding of a route for the `?r=` share parameter.
 *
 * Format:  <unit><defaultMode><modes…>.<polyline>
 *   - unit:        'i' (mi) | 'k' (km)
 *   - defaultMode: f | b | c | m
 *   - modes:       one char per segment (points.length - 1 of them)
 *   - '.':         delimiter — never appears in the polyline (chars 63-126) or
 *                  the mode/unit alphabet, so the split is unambiguous
 *   - polyline:    Google-encoded anchor points (precision 5)
 *
 * Coordinates are stored to ~1.1 m precision; geometry is re-snapped on load.
 */

import { decodePolyline, encodePolyline } from './polyline'
import { CHAR_MODES, MODE_CHARS, type RouteCore, type TravelMode, type Unit, genId } from './types'

export function encodeRoute(core: RouteCore): string {
  const unitChar = core.unit === 'mi' ? 'i' : 'k'
  const defChar = MODE_CHARS[core.defaultMode]
  const modes = core.modes.map((m) => MODE_CHARS[m]).join('')
  const poly = encodePolyline(core.points)
  return `${unitChar}${defChar}${modes}.${poly}`
}

export function decodeRoute(value: string): RouteCore | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot < 0) return null
  const head = value.slice(0, dot)
  const poly = value.slice(dot + 1)
  if (head.length < 2) return null

  const unit: Unit = head[0] === 'k' ? 'km' : 'mi'
  const defaultMode: TravelMode = CHAR_MODES[head[1]] ?? 'foot'
  const modeChars = head.slice(2)

  let coords: ReturnType<typeof decodePolyline>
  try {
    coords = decodePolyline(poly)
  } catch {
    return null
  }

  const points = coords.map((c) => ({ id: genId(), lat: c.lat, lng: c.lng }))
  // Expect one mode per gap; tolerate a mismatch by padding/truncating.
  const expected = Math.max(0, points.length - 1)
  const modes: TravelMode[] = []
  for (let i = 0; i < expected; i += 1) {
    modes.push(CHAR_MODES[modeChars[i]] ?? defaultMode)
  }
  return { points, modes, defaultMode, unit }
}
