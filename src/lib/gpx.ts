/** Build a GPX 1.1 document from route geometry (with optional elevation). */

import type { LatLng } from './types'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface GpxOptions {
  name?: string
  coords: LatLng[]
  /** Optional elevation in metres, index-aligned with `coords`. */
  elevations?: Array<number | null>
}

export function buildGpx({ name = 'Route', coords, elevations }: GpxOptions): string {
  const trkpts = coords
    .map((c, i) => {
      const ele = elevations?.[i]
      const eleTag =
        typeof ele === 'number' && Number.isFinite(ele)
          ? `<ele>${ele.toFixed(1)}</ele>`
          : ''
      return `      <trkpt lat="${c.lat.toFixed(6)}" lon="${c.lng.toFixed(6)}">${eleTag}</trkpt>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runningmap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

/** Trigger a browser download of GPX text. No-op outside the browser. */
export function downloadGpx(filename: string, gpx: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.gpx') ? filename : `${filename}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
