/** Distance/elevation unit conversion + display formatting. */

import type { Unit } from './types'

const METERS_PER_MILE = 1609.344
const FEET_PER_METER = 3.280839895

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE
}

export function metersToKm(m: number): number {
  return m / 1000
}

export function metersToFeet(m: number): number {
  return m * FEET_PER_METER
}

/** Numeric distance in the chosen unit (mi or km). */
export function distanceIn(meters: number, unit: Unit): number {
  return unit === 'mi' ? metersToMiles(meters) : metersToKm(meters)
}

/** Inverse of {@link distanceIn}: a value entered in `unit` → metres. */
export function metersFrom(value: number, unit: Unit): number {
  return unit === 'mi' ? value * METERS_PER_MILE : value * 1000
}

/**
 * Re-express a slider value when its unit toggles: preserve the real DISTANCE
 * (not the number), then snap to `step` and clamp into the target unit's range.
 * e.g. 5.0 km → ~3.0 mi. Used so a km↔mi switch doesn't silently reinterpret
 * "5.0 km" as "5.0 mi".
 */
export function convertRangeValue(
  value: number,
  from: Unit,
  to: Unit,
  range: { min: number; max: number; step: number },
): number {
  const converted = distanceIn(metersFrom(value, from), to)
  const snapped = Math.round(converted / range.step) * range.step
  return Math.min(range.max, Math.max(range.min, snapped))
}

/** e.g. "3.41 mi" / "5.49 km". Two decimals; trims to a clean short string. */
export function formatDistance(meters: number, unit: Unit): string {
  const value = distanceIn(meters, unit)
  const decimals = value >= 100 ? 1 : 2
  return `${value.toFixed(decimals)} ${unit}`
}

/** Distance value only (no unit suffix), for big readouts. */
export function formatDistanceValue(meters: number, unit: Unit): string {
  const value = distanceIn(meters, unit)
  return value.toFixed(value >= 100 ? 1 : 2)
}

/** Elevation paired with the distance unit: feet for miles, metres for km. */
export function elevationUnit(unit: Unit): 'ft' | 'm' {
  return unit === 'mi' ? 'ft' : 'm'
}

export function elevationIn(meters: number, unit: Unit): number {
  return unit === 'mi' ? metersToFeet(meters) : meters
}

/** e.g. "120 ft" / "37 m". */
export function formatElevation(meters: number, unit: Unit): string {
  const value = elevationIn(meters, unit)
  return `${Math.round(value)} ${elevationUnit(unit)}`
}

export function otherUnit(unit: Unit): Unit {
  return unit === 'mi' ? 'km' : 'mi'
}

/** Placeholder for a metric that can't be computed (zero/degenerate input). */
export const NO_VALUE = '—'

/** Seconds → "M:SS" (minutes may exceed 59; rounds seconds, carrying 60 → +1m). */
export function formatMmSs(seconds: number): string {
  let minutes = Math.floor(seconds / 60)
  let secs = Math.round(seconds % 60)
  if (secs === 60) {
    minutes += 1
    secs = 0
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Running pace as a bare "M:SS" per unit (no suffix) for big stat readouts where
 * the unit is rendered separately. {@link NO_VALUE} when distance/time degenerate.
 */
export function formatPaceValue(meters: number, seconds: number, unit: Unit): string {
  if (!(meters > 0) || !(seconds > 0) || !Number.isFinite(meters) || !Number.isFinite(seconds)) {
    return NO_VALUE
  }
  return formatMmSs(seconds / distanceIn(meters, unit))
}

/**
 * Running pace — time per unit distance, e.g. "8:30 /mi" or "5:17 /km".
 * Returns {@link NO_VALUE} for non-positive distance or time so a mis-entered
 * run never renders "Infinity:NaN".
 */
export function formatPace(meters: number, seconds: number, unit: Unit): string {
  const value = formatPaceValue(meters, seconds, unit)
  return value === NO_VALUE ? NO_VALUE : `${value} /${unit}`
}

/** Elapsed time as a clock — "H:MM:SS" past an hour, else "M:SS", or NO_VALUE. */
export function formatClock(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return NO_VALUE
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Speed — distance per hour, e.g. "7.1 mph" / "11.4 km/h". {@link NO_VALUE} when degenerate. */
export function formatSpeed(meters: number, seconds: number, unit: Unit): string {
  if (!(meters > 0) || !(seconds > 0) || !Number.isFinite(meters) || !Number.isFinite(seconds)) {
    return NO_VALUE
  }
  const perHour = distanceIn(meters, unit) / (seconds / 3600)
  return `${perHour.toFixed(1)} ${unit === 'mi' ? 'mph' : 'km/h'}`
}

/** Saved-at timestamp → "Jun 19, 2026, 2:30 PM" (locale-aware, graceful). */
export function formatSavedAt(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Human travel time, Google-Maps style: "45 sec", "12 min", "1 hr 5 min".
 * Rounds to whole minutes once past a minute.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min'
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} hr`
  return `${hours} hr ${minutes} min`
}
