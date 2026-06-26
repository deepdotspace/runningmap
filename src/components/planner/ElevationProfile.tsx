/** Elevation profile — a self-contained SVG area chart (no charting dep). */

import { useMemo } from 'react'
import type { Unit } from '../../lib/types'
import { distanceIn, elevationIn, elevationUnit } from '../../lib/units'
import type { ElevationPoint, ElevationStatus } from '../../hooks/useElevation'

const VW = 1000
const VH = 130
const PAD_TOP = 12
const PAD_BOTTOM = 18

interface ElevationProfileProps {
  profile: ElevationPoint[]
  status: ElevationStatus
  gain: number
  loss: number
  unit: Unit
}

export function ElevationProfile({ profile, status, gain, loss, unit }: ElevationProfileProps) {
  const chart = useMemo(() => {
    if (profile.length < 2) return null
    const maxDist = profile[profile.length - 1].dist || 1
    const eles = profile.map((p) => p.ele)
    let lo = Math.min(...eles)
    let hi = Math.max(...eles)
    if (hi - lo < 1) {
      hi += 1
      lo -= 1
    }
    const x = (d: number) => (d / maxDist) * VW
    const y = (e: number) => PAD_TOP + (1 - (e - lo) / (hi - lo)) * (VH - PAD_TOP - PAD_BOTTOM)

    const line = profile.map((p) => `${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ')
    const area =
      `0,${VH - PAD_BOTTOM} ` + line + ` ${VW},${VH - PAD_BOTTOM}`
    return { line, area, lo, hi }
  }, [profile])

  return (
    <div data-testid="elevation-profile" className="select-none">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">Elevation</span>
        <span className="flex items-center gap-3 text-muted-foreground">
          {status === 'loading' && <span>Loading…</span>}
          {status === 'error' && <span className="text-warning">Unavailable</span>}
          {status === 'ready' && chart && (
            <>
              <span data-testid="elevation-gain" className="text-foreground">
                ↑ {Math.round(elevationIn(gain, unit))} {elevationUnit(unit)}
              </span>
              <span data-testid="elevation-loss">
                ↓ {Math.round(elevationIn(loss, unit))} {elevationUnit(unit)}
              </span>
            </>
          )}
        </span>
      </div>

      {chart ? (
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="none"
          className="h-24 w-full"
          role="img"
          aria-label={`Elevation profile, ${Math.round(elevationIn(gain, unit))} ${elevationUnit(unit)} of climbing`}
        >
          <defs>
            <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <polygon points={chart.area} fill="url(#elev-fill)" />
          <polyline
            points={chart.line}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
          {status === 'loading' ? 'Reading elevation…' : 'Add at least two points to see elevation.'}
        </div>
      )}
    </div>
  )
}
