import { describe, expect, it } from 'vitest'
import {
  convertRangeValue,
  distanceIn,
  elevationUnit,
  formatDistance,
  formatDistanceValue,
  formatDuration,
  formatPace,
  formatSavedAt,
  formatSpeed,
  metersFrom,
  metersToFeet,
  metersToKm,
  metersToMiles,
  NO_VALUE,
  otherUnit,
} from './units'

describe('units', () => {
  it('converts metres', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6)
    expect(metersToKm(1000)).toBe(1)
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 4)
  })

  it('converts a unit value back to metres (round-trips distanceIn)', () => {
    expect(metersFrom(1, 'mi')).toBeCloseTo(1609.344, 3)
    expect(metersFrom(5, 'km')).toBe(5000)
    expect(distanceIn(metersFrom(3.1, 'mi'), 'mi')).toBeCloseTo(3.1, 6)
  })

  it('converts a range value across units, preserving real distance', () => {
    const km = { min: 1, max: 30, step: 0.5 }
    const mi = { min: 1, max: 20, step: 0.5 }
    // 5.0 km ≈ 3.107 mi → snaps to 3.0 mi.
    expect(convertRangeValue(5, 'km', 'mi', mi)).toBe(3)
    // Same unit is a no-op (already on-step, in range).
    expect(convertRangeValue(5, 'km', 'km', km)).toBe(5)
    // Clamps into the target range: 20 mi ≈ 32.19 km → clamped to the 30 km max.
    expect(convertRangeValue(20, 'mi', 'km', km)).toBe(30)
    // Clamps up to the minimum: 1 km ≈ 0.62 mi → clamped to the 1 mi min.
    expect(convertRangeValue(1, 'km', 'mi', mi)).toBe(1)
    // Result is always snapped to the step.
    const v = convertRangeValue(7, 'km', 'mi', mi)
    expect(v / mi.step).toBe(Math.round(v / mi.step))
  })

  it('formats distance with a unit', () => {
    expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi')
    expect(formatDistance(5000, 'km')).toBe('5.00 km')
    expect(formatDistanceValue(1609.344, 'mi')).toBe('1.00')
  })

  it('drops to one decimal for large distances', () => {
    expect(formatDistance(metersToMiles(0) + 1609.344 * 150, 'mi')).toBe('150.0 mi')
  })

  it('formats travel time like Google Maps', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(-5)).toBe('0 min')
    expect(formatDuration(30)).toBe('30 sec')
    expect(formatDuration(90)).toBe('2 min') // rounds to nearest minute
    expect(formatDuration(720)).toBe('12 min')
    expect(formatDuration(3600)).toBe('1 hr')
    expect(formatDuration(3900)).toBe('1 hr 5 min')
  })

  it('formats the saved-at timestamp, tolerating bad input', () => {
    expect(formatSavedAt(undefined)).toBe('')
    expect(formatSavedAt('not-a-date')).toBe('')
    const out = formatSavedAt('2026-06-19T14:30:00.000Z')
    expect(out).toMatch(/2026/)
    expect(out.length).toBeGreaterThan(0)
  })

  it('formats running pace per unit', () => {
    // 1 mile in 8.5 min → 8:30 /mi
    expect(formatPace(1609.344, 510, 'mi')).toBe('8:30 /mi')
    // 1 km in 5 min → 5:00 /km
    expect(formatPace(1000, 300, 'km')).toBe('5:00 /km')
    // rounds seconds and rolls 60 → next minute
    expect(formatPace(1609.344, 599.9, 'mi')).toBe('10:00 /mi')
  })

  it('guards pace/speed against degenerate input', () => {
    expect(formatPace(0, 300, 'mi')).toBe(NO_VALUE)
    expect(formatPace(1000, 0, 'km')).toBe(NO_VALUE)
    expect(formatPace(Number.NaN, 300, 'mi')).toBe(NO_VALUE)
    expect(formatSpeed(0, 300, 'mi')).toBe(NO_VALUE)
    expect(formatSpeed(1000, 0, 'km')).toBe(NO_VALUE)
  })

  it('formats speed per hour', () => {
    // 1 mile in 8.5 min → ~7.1 mph
    expect(formatSpeed(1609.344, 510, 'mi')).toBe('7.1 mph')
    // 1 km in 5 min → 12.0 km/h
    expect(formatSpeed(1000, 300, 'km')).toBe('12.0 km/h')
  })

  it('exposes elevation unit + unit toggle', () => {
    expect(elevationUnit('mi')).toBe('ft')
    expect(elevationUnit('km')).toBe('m')
    expect(otherUnit('mi')).toBe('km')
    expect(otherUnit('km')).toBe('mi')
    expect(distanceIn(1000, 'km')).toBe(1)
  })
})
