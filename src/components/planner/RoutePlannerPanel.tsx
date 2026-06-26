/**
 * Plan-a-route panel — auto-generate a loop or out-and-back of a target
 * distance near the map centre. Seeds pure geometry (see `lib/route-plan`),
 * builds a road-snapped `RouteCore` (a real run SHOULD follow streets), and
 * hands it to the planner to confirm + fit + edit.
 *
 * Approximate by design: the geometric seed is sized shorter than the target so
 * road-snapping inflates it back up. The panel shows the target; the bottom bar
 * shows the actual snapped length; Shuffle re-seeds a different street pattern.
 *
 * This panel only produces a `RouteCore` (generation is synchronous + local —
 * no fetch here, snapping happens downstream in `useRoute`), so there are no
 * loading/error/empty states.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Route, Shuffle, X } from 'lucide-react'
import type { PlanType } from '../../lib/route-plan'
import type { GeomCache } from '../../lib/route-model'
import { buildPlannedRoute } from '../../lib/shape-route'
import { convertRangeValue, distanceIn, metersFrom } from '../../lib/units'
import { planRoute } from '../../services/route-plan'
import type { SnapMode } from '../../services/types'
import type { LatLng, RouteCore, TravelMode, Unit } from '../../lib/types'

/** How a planned route was produced — surfaced to the user after generating. */
export interface PlanMeta {
  type: PlanType
  /** Target distance in metres (what the user asked for). */
  targetMeters: number
  /** Measured snapped length in metres, or 0 if it couldn't be measured. */
  meters: number
}

interface RoutePlannerPanelProps {
  /** Current map centre — the route is planned around it. */
  getCenter: () => LatLng
  /** Hand the built route + how it was planned to the planner (it confirms + loads).
   *  `geom` pre-seeds the route's snapped geometry so it isn't re-snapped. */
  onGenerate: (core: RouteCore, meta: PlanMeta, geom?: GeomCache) => void
  unit: Unit
  /** Current travel mode — the generated route is snapped + labelled with it. */
  mode: TravelMode
  /** False until the map is zoomed to a real area — generating before then would
   *  plan a route around the zoomed-out default centre, far from anywhere useful. */
  ready: boolean
}

// Distance range, in each unit (rounded to whole, friendly bounds).
const RANGE = { km: { min: 1, max: 30, step: 0.5, def: 5 }, mi: { min: 1, max: 20, step: 0.5, def: 3 } } as const
// One snap call per gap; loop seed has ~10 vertices + retraces, so 24 is plenty.
const MAX_WAYPOINTS = 24

export function RoutePlannerPanel({ getCenter, onGenerate, unit, mode, ready }: RoutePlannerPanelProps) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<PlanType>('loop')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const range = RANGE[unit]
  const [dist, setDist] = useState<number>(range.def)

  const abortRef = useRef<AbortController | null>(null)
  // Abort any in-flight measuring on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Keep the target a fixed real distance when the unit toggles (km↔mi): convert
  // the value instead of silently reinterpreting "5.0 km" as "5.0 mi". Clamp to
  // the new unit's range and snap to its step.
  const prevUnit = useRef(unit)
  useEffect(() => {
    if (prevUnit.current === unit) return
    const from = prevUnit.current
    setDist((d) => convertRangeValue(d, from, unit, RANGE[unit]))
    prevUnit.current = unit
  }, [unit])

  const targetMeters = metersFrom(dist, unit)

  const generate = () => {
    if (!ready || busy) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setErrorMsg('')
    // Plain app code: Math.random for bearing variety is fine here.
    const bearingDeg = Math.random() * 360
    // A planned route is meant to follow streets, so a 'manual' selection (no
    // snapping) would defeat the feature — fall back to walking for the snap
    // while still honouring foot/bike/car. We measure with this SAME mode so the
    // converged size matches what gets committed.
    const planMode: SnapMode = mode === 'manual' ? 'foot' : mode
    // Measure the snapped length and rescale the seed until it actually matches
    // the target (one routing request per round) — not a fixed fudge factor.
    planRoute({ center: getCenter(), targetMeters, type, bearingDeg, mode: planMode, signal: ctrl.signal })
      .then((plan) => {
        if (ctrl.signal.aborted) return
        setBusy(false)
        if (plan.waypoints.length < 2) {
          setErrorMsg('Couldn’t plan a route here — try another spot or distance.')
          return
        }
        // Relocate vertices onto the snapped roads and pre-seed their geometry
        // (so the route renders at its measured length and never re-snaps to a
        // shorter straight-line fallback). Falls back to the raw seed + live
        // snapping when the legs don't line up — see buildPlannedRoute.
        const { core, geom } = buildPlannedRoute(plan.waypoints, plan.legs, {
          unit,
          mode: planMode,
          closed: type === 'loop',
          maxWaypoints: MAX_WAYPOINTS,
        })
        onGenerate(core, { type, targetMeters, meters: plan.meters }, geom ?? undefined)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setBusy(false)
        setErrorMsg('Couldn’t plan a route — please try again.')
      })
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="plan-toggle"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-sm text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-card"
      >
        <Route className="h-4 w-4 text-primary" aria-hidden />
        Plan a route
      </button>
    )
  }

  const label = type === 'loop' ? 'loop' : 'out-and-back'

  return (
    <div
      data-testid="plan-panel"
      className="pointer-events-auto w-72 max-w-[80vw] rounded-2xl border border-border bg-card/90 p-3 shadow-xl backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Route className="h-4 w-4 text-primary" aria-hidden />
          Plan a route
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Distance (native range — no Slider primitive in the UI kit) */}
      <label className="mb-2 block text-xs text-muted-foreground">
        <span className="mb-1 flex items-center justify-between">
          <span>Distance</span>
          <span className="text-foreground">
            {dist.toFixed(1)} {unit}
          </span>
        </span>
        <input
          data-testid="plan-distance"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={dist}
          onChange={(e) => setDist(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label={`Target distance in ${unit}`}
        />
      </label>

      {/* Type: loop vs out-and-back */}
      <div className="mb-2">
        <span className="mb-1 block text-xs text-muted-foreground">Type</span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="plan-loop"
            aria-pressed={type === 'loop'}
            onClick={() => setType('loop')}
            className={
              type === 'loop'
                ? 'flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground'
                : 'flex-1 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/70'
            }
          >
            Loop
          </button>
          <button
            type="button"
            data-testid="plan-outback"
            aria-pressed={type === 'out-and-back'}
            onClick={() => setType('out-and-back')}
            className={
              type === 'out-and-back'
                ? 'flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground'
                : 'flex-1 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/70'
            }
          >
            Out &amp; back
          </button>
        </div>
      </div>

      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        {ready
          ? `~${distanceIn(targetMeters, unit).toFixed(1)} ${unit} ${label} near the map centre — fitted to roads at about your target distance, then drag any point to refine.`
          : 'Use the search box or zoom in to your area first, then generate a route there.'}
      </p>

      {errorMsg && (
        <p data-testid="plan-error" className="mb-2 text-[11px] leading-snug text-destructive">
          {errorMsg}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="plan-generate"
          onClick={generate}
          disabled={!ready || busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {busy ? 'Fitting to roads…' : 'Generate'}
        </button>
        <button
          type="button"
          data-testid="plan-shuffle"
          onClick={generate}
          disabled={!ready || busy}
          title={ready ? 'Shuffle direction' : 'Zoom in to your area first'}
          aria-label="Shuffle direction"
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Shuffle className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
