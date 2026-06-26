/**
 * Aggregation for the run log / stats dashboard.
 *
 * Two correctness rules baked in here:
 *  1. **Local time.** A run's `date` is a bare `YYYY-MM-DD` calendar date. We
 *     parse it as *local* midnight (never `new Date('YYYY-MM-DD')`, which JS
 *     treats as UTC and shifts evening runs into the wrong day/week). Weeks start
 *     **Monday** (the running-app norm).
 *  2. **Totals, not averages-of-averages.** "Average pace" is total time over
 *     total distance — so the UI computes it by calling `formatPace(totals.
 *     distanceMeters, totals.durationSeconds, unit)`, which weights long runs
 *     correctly. We never average per-run paces.
 *
 * All distances/times stay in SI base units; formatting happens in the UI.
 */

export interface RunLike {
  distanceMeters: number
  durationSeconds: number
  /** Local calendar date, 'YYYY-MM-DD'. */
  date: string
}

export interface RunTotals {
  count: number
  distanceMeters: number
  durationSeconds: number
}

const pad = (n: number) => n.toString().padStart(2, '0')

/** Parse 'YYYY-MM-DD' as local midnight. Returns null on malformed input. */
export function parseLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Local 'YYYY-MM-DD' for a date (default: now). */
export function toYmd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' → "Jun 20, 2026" (local), echoing malformed input unchanged. */
export function formatYmdPretty(ymd: string): string {
  const d = parseLocalDate(ymd)
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ymd
}

/** Local midnight of the Monday on or before `d`. */
export function startOfWeek(d: Date): Date {
  const daysSinceMonday = (d.getDay() + 6) % 7 // getDay: 0=Sun..6=Sat
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday)
}

/** Local midnight of the first day of `d`'s month. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function totals(runs: RunLike[]): RunTotals {
  let distanceMeters = 0
  let durationSeconds = 0
  for (const r of runs) {
    distanceMeters += r.distanceMeters || 0
    durationSeconds += r.durationSeconds || 0
  }
  return { count: runs.length, distanceMeters, durationSeconds }
}

/** Runs whose local date is on or after `since` (a local-midnight boundary). */
export function filterSince(runs: RunLike[], since: Date): RunLike[] {
  const cutoff = since.getTime()
  return runs.filter((r) => {
    const d = parseLocalDate(r.date)
    return d != null && d.getTime() >= cutoff
  })
}

export function thisWeek(runs: RunLike[], now: Date = new Date()): RunLike[] {
  return filterSince(runs, startOfWeek(now))
}

export function thisMonth(runs: RunLike[], now: Date = new Date()): RunLike[] {
  return filterSince(runs, startOfMonth(now))
}

export interface RunRecords {
  /** Longest single run by distance. */
  longest: RunLike | null
  /** Run with the best (smallest) seconds-per-metre, among non-degenerate runs. */
  fastest: RunLike | null
  /** Most distance accumulated in any single Monday-start week. */
  bestWeekMeters: number
}

export function records(runs: RunLike[]): RunRecords {
  let longest: RunLike | null = null
  let fastest: RunLike | null = null
  let fastestPace = Infinity
  const weekMeters = new Map<number, number>()

  for (const r of runs) {
    if (!longest || r.distanceMeters > longest.distanceMeters) longest = r

    if (r.distanceMeters > 0 && r.durationSeconds > 0) {
      const pace = r.durationSeconds / r.distanceMeters
      if (pace < fastestPace) {
        fastestPace = pace
        fastest = r
      }
    }

    const d = parseLocalDate(r.date)
    if (d) {
      const key = startOfWeek(d).getTime()
      weekMeters.set(key, (weekMeters.get(key) ?? 0) + (r.distanceMeters || 0))
    }
  }

  let bestWeekMeters = 0
  for (const m of weekMeters.values()) if (m > bestWeekMeters) bestWeekMeters = m

  return { longest, fastest, bestWeekMeters }
}

export interface WeekBucket {
  /** Monday of the week, as local 'YYYY-MM-DD'. */
  weekStart: string
  distanceMeters: number
  runCount: number
}

/**
 * Distance totalled per week for the last `weeks` weeks (oldest first, ending
 * with the current week) — for the dashboard bar chart. Empty weeks are kept so
 * the chart has an even time axis.
 */
export function weeklyBuckets(
  runs: RunLike[],
  weeks: number,
  now: Date = new Date(),
): WeekBucket[] {
  const thisMonday = startOfWeek(now)
  const buckets: WeekBucket[] = []
  const indexByKey = new Map<number, number>()

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(
      thisMonday.getFullYear(),
      thisMonday.getMonth(),
      thisMonday.getDate() - i * 7,
    )
    indexByKey.set(start.getTime(), buckets.length)
    buckets.push({ weekStart: toYmd(start), distanceMeters: 0, runCount: 0 })
  }

  for (const r of runs) {
    const d = parseLocalDate(r.date)
    if (!d) continue
    const idx = indexByKey.get(startOfWeek(d).getTime())
    if (idx == null) continue
    buckets[idx].distanceMeters += r.distanceMeters || 0
    buckets[idx].runCount += 1
  }

  return buckets
}

export interface DayBucket {
  /** The day, as local 'YYYY-MM-DD'. */
  date: string
  distanceMeters: number
  runCount: number
}

/**
 * Distance totalled per calendar day for the last `days` days (oldest first,
 * ending today). Empty days are kept so a daily chart has an even time axis.
 */
export function dailyBuckets(
  runs: RunLike[],
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const buckets: DayBucket[] = []
  const indexByKey = new Map<number, number>()

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    indexByKey.set(d.getTime(), buckets.length)
    buckets.push({ date: toYmd(d), distanceMeters: 0, runCount: 0 })
  }

  for (const r of runs) {
    const d = parseLocalDate(r.date)
    if (!d) continue
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const idx = indexByKey.get(key)
    if (idx == null) continue
    buckets[idx].distanceMeters += r.distanceMeters || 0
    buckets[idx].runCount += 1
  }

  return buckets
}

/**
 * Length of the current daily run streak — consecutive calendar days with at
 * least one logged run, counting back from today. Today not having a run yet
 * doesn't break the streak (we start the count from yesterday in that case), so
 * a streak stays alive until the day is actually over.
 */
export function currentStreak(runs: RunLike[], now: Date = new Date()): number {
  const days = new Set<number>()
  for (const r of runs) {
    const d = parseLocalDate(r.date)
    if (d) days.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())
  }

  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!days.has(cursor.getTime())) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1)
  }

  let streak = 0
  while (days.has(cursor.getTime())) {
    streak += 1
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1)
  }
  return streak
}
