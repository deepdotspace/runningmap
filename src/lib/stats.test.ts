import { describe, expect, it } from 'vitest'
import {
  currentStreak,
  dailyBuckets,
  filterSince,
  parseLocalDate,
  records,
  startOfMonth,
  startOfWeek,
  thisMonth,
  thisWeek,
  toYmd,
  totals,
  weeklyBuckets,
  type RunLike,
} from './stats'

const run = (date: string, distanceMeters: number, durationSeconds: number): RunLike => ({
  date,
  distanceMeters,
  durationSeconds,
})

describe('stats date helpers', () => {
  it('parses YYYY-MM-DD as local midnight (not UTC)', () => {
    const d = parseLocalDate('2026-06-23')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5) // June
    expect(d.getDate()).toBe(23)
    expect(d.getHours()).toBe(0)
  })

  it('rejects malformed dates', () => {
    expect(parseLocalDate('2026-6-3')).toBeNull()
    expect(parseLocalDate('nope')).toBeNull()
  })

  it('round-trips toYmd', () => {
    expect(toYmd(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('weeks start on Monday', () => {
    // 2026-06-23 is a Tuesday → Monday is 2026-06-22.
    expect(toYmd(startOfWeek(new Date(2026, 5, 23)))).toBe('2026-06-22')
    // Sunday 2026-06-21 belongs to the *previous* Monday 2026-06-15.
    expect(toYmd(startOfWeek(new Date(2026, 5, 21)))).toBe('2026-06-15')
    // Monday maps to itself.
    expect(toYmd(startOfWeek(new Date(2026, 5, 22)))).toBe('2026-06-22')
  })

  it('startOfMonth is the 1st', () => {
    expect(toYmd(startOfMonth(new Date(2026, 5, 23)))).toBe('2026-06-01')
  })

  it('handles week boundaries across a DST transition', () => {
    // US spring-forward 2026 is Sun 8 Mar. A run that day belongs to the week
    // starting Mon 2 Mar; the next Monday (9 Mar) opens a new week. Local-Date
    // arithmetic must not drift a day around the clock change.
    expect(toYmd(startOfWeek(new Date(2026, 2, 8)))).toBe('2026-03-02') // Sun
    expect(toYmd(startOfWeek(new Date(2026, 2, 9)))).toBe('2026-03-09') // Mon
    const runs = [run('2026-03-08', 4000, 1200), run('2026-03-09', 6000, 1800)]
    const buckets = weeklyBuckets(runs, 2, new Date(2026, 2, 9))
    expect(buckets[0].distanceMeters).toBe(4000) // week of 2 Mar
    expect(buckets[1].distanceMeters).toBe(6000) // week of 9 Mar
  })
})

describe('stats aggregation', () => {
  const now = new Date(2026, 5, 23) // Tue 23 Jun 2026; week starts Mon 22 Jun

  it('totals distance, duration, count', () => {
    const t = totals([run('2026-06-22', 1000, 300), run('2026-06-23', 2000, 600)])
    expect(t).toEqual({ count: 2, distanceMeters: 3000, durationSeconds: 900 })
  })

  it('buckets this week vs earlier (Mon boundary, local)', () => {
    const runs = [
      run('2026-06-22', 5000, 1500), // Mon — this week
      run('2026-06-23', 3000, 900), // Tue — this week
      run('2026-06-21', 4000, 1200), // Sun — last week
    ]
    const wk = thisWeek(runs, now)
    expect(wk).toHaveLength(2)
    expect(totals(wk).distanceMeters).toBe(8000)
  })

  it('buckets this month, excluding prior months', () => {
    const runs = [run('2026-06-01', 1000, 300), run('2026-05-31', 9000, 1800)]
    expect(thisMonth(runs, now)).toHaveLength(1)
  })

  it('filterSince is inclusive of the boundary day', () => {
    const runs = [run('2026-06-22', 1000, 300)]
    expect(filterSince(runs, startOfWeek(now))).toHaveLength(1)
  })

  it('finds longest, fastest, and best-week records', () => {
    const runs = [
      run('2026-06-22', 5000, 1800), // 0.36 s/m
      run('2026-06-23', 1000, 300), // 0.30 s/m — fastest
      run('2026-06-15', 8000, 4000), // longest distance; prior week
    ]
    const r = records(runs)
    expect(r.longest?.distanceMeters).toBe(8000)
    expect(r.fastest?.distanceMeters).toBe(1000)
    // Best week = Mon 22 Jun week (5000) vs Mon 15 Jun week (8000) → 8000.
    expect(r.bestWeekMeters).toBe(8000)
  })

  it('ignores degenerate runs when picking fastest pace', () => {
    const runs = [run('2026-06-23', 0, 300), run('2026-06-23', 1000, 0)]
    expect(records(runs).fastest).toBeNull()
  })

  it('produces an even weekly axis with empty weeks kept', () => {
    const runs = [run('2026-06-22', 5000, 1500), run('2026-06-08', 3000, 900)]
    const buckets = weeklyBuckets(runs, 4, now)
    expect(buckets).toHaveLength(4)
    // oldest first, current week last
    expect(buckets[3].weekStart).toBe('2026-06-22')
    expect(buckets[3].distanceMeters).toBe(5000)
    // 2026-06-08 is a Monday two weeks back → index 1
    expect(buckets[1].distanceMeters).toBe(3000)
    // the empty week in between stays at 0
    expect(buckets[2].distanceMeters).toBe(0)
  })
})

describe('dailyBuckets', () => {
  const now = new Date(2026, 5, 23) // Tue 23 Jun 2026

  it('produces one bucket per day, oldest first, ending today', () => {
    const buckets = dailyBuckets([], 7, now)
    expect(buckets).toHaveLength(7)
    expect(buckets[0].date).toBe('2026-06-17')
    expect(buckets[6].date).toBe('2026-06-23')
  })

  it('sums distance into the matching day and keeps empty days at 0', () => {
    const runs = [
      run('2026-06-23', 5000, 1500), // today
      run('2026-06-23', 1000, 300), // today again → summed
      run('2026-06-21', 3000, 900), // two days ago
      run('2026-06-10', 9000, 2700), // outside the window → dropped
    ]
    const buckets = dailyBuckets(runs, 7, now)
    expect(buckets[6].distanceMeters).toBe(6000)
    expect(buckets[6].runCount).toBe(2)
    expect(buckets[4].distanceMeters).toBe(3000)
    expect(buckets[0].distanceMeters).toBe(0)
  })
})

describe('currentStreak', () => {
  const now = new Date(2026, 5, 23) // Tue 23 Jun 2026

  it('counts consecutive days ending today', () => {
    const runs = [run('2026-06-23', 1000, 300), run('2026-06-22', 1000, 300), run('2026-06-21', 1000, 300)]
    expect(currentStreak(runs, now)).toBe(3)
  })

  it('stays alive when today has no run yet (counts back from yesterday)', () => {
    const runs = [run('2026-06-22', 1000, 300), run('2026-06-21', 1000, 300)]
    expect(currentStreak(runs, now)).toBe(2)
  })

  it('breaks on a gap and ignores duplicate-day runs', () => {
    const runs = [
      run('2026-06-23', 1000, 300),
      run('2026-06-23', 2000, 600), // same day, shouldn't double-count
      run('2026-06-21', 1000, 300), // gap on the 22nd
    ]
    expect(currentStreak(runs, now)).toBe(1)
  })

  it('is 0 when the most recent run is older than yesterday', () => {
    expect(currentStreak([run('2026-06-20', 1000, 300)], now)).toBe(0)
    expect(currentStreak([], now)).toBe(0)
  })
})
