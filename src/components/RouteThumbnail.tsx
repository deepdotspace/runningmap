/**
 * RouteThumbnail — a tiny Strava-style sketch of a route's shape as inline SVG.
 *
 * Takes a list of lat/lng coordinates, projects them (equirectangular with a
 * cos-latitude correction so the aspect ratio looks right), fits them into the
 * view box preserving shape, and draws the path with start/finish dots. No map
 * tiles, no network — it renders purely from the stored geometry.
 */

import type { LatLng } from '../lib/types'

interface RouteThumbnailProps {
  coords: LatLng[]
  className?: string
}

// View-box dimensions; the path is fit inside with this much padding.
export const THUMB_W = 200
export const THUMB_H = 120
const W = THUMB_W
const H = THUMB_H
const PAD = 14

export function RouteThumbnail({ coords, className }: RouteThumbnailProps) {
  const projected = projectToBox(coords)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Route shape preview"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={W} height={H} className="fill-secondary/40" />
      {projected.length >= 2 ? (
        <>
          <polyline
            points={projected.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ff3b30"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={projected[0].x} cy={projected[0].y} r={4} fill="#34c759" stroke="#fff" strokeWidth={1.5} />
          <circle
            cx={projected[projected.length - 1].x}
            cy={projected[projected.length - 1].y}
            r={4}
            fill="#ff3b30"
            stroke="#fff"
            strokeWidth={1.5}
          />
        </>
      ) : (
        <circle cx={W / 2} cy={H / 2} r={4} className="fill-muted-foreground" />
      )}
    </svg>
  )
}

/** Project lat/lng to centered, shape-preserving view-box pixels. */
export function projectToBox(coords: LatLng[]): Array<{ x: number; y: number }> {
  if (coords.length === 0) return []
  const meanLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length
  const k = Math.cos((meanLat * Math.PI) / 180)
  // Equirectangular: x grows with lng (scaled by cos lat), y grows with lat.
  const raw = coords.map((c) => ({ x: c.lng * k, y: c.lat }))

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of raw) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  if (spanX === 0 && spanY === 0) return [] // degenerate → caller draws a dot

  const boxW = W - PAD * 2
  const boxH = H - PAD * 2
  const scale = Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity)
  // Centre the scaled shape inside the box.
  const drawnW = spanX * scale
  const drawnH = spanY * scale
  const offX = PAD + (boxW - drawnW) / 2
  const offY = PAD + (boxH - drawnH) / 2

  return raw.map((p) => ({
    x: offX + (p.x - minX) * scale,
    // Flip Y: latitude increases upward, SVG y increases downward.
    y: offY + (maxY - p.y) * scale,
  }))
}
