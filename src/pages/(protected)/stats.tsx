/**
 * /stats — "My Runs". An Apple-Fitness-style dashboard for each signed-in user's
 * logged runs (owner-scoped): a career-total hero, streak / this-week / avg-pace
 * cards, a weekly-goal activity ring beside a last-7-days bar chart, and a recent
 * runs list. Runs are self-contained snapshots, so nothing here depends on a
 * linked route still existing.
 *
 * Built from the Claude Design "Running Statistics Page" — the design's hardcoded
 * Apple palette is expressed through the app's theme tokens (primary/foreground/
 * card/secondary/muted/border) so it renders faithfully under the `apple` theme
 * and adapts to every other theme. Surfaces are plain styled <div>s with explicit
 * symmetric padding (not the shared <CardContent>, whose `sm:pt-0` can't be
 * cancelled by a page-level override) so every readout stays truly centred.
 */

import { useEffect, useMemo, useState } from 'react'
import { type RecordData, useMutations, useQuery } from 'deepspace'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmModal,
  Input,
  Label,
  LoadingSpinner,
  Modal,
  UnitToggle,
  cn,
  useToast,
} from '../../components/ui'
import { LogRunDialog } from '../../components/runs/LogRunDialog'
import { distanceIn, formatMmSs, formatPaceValue, metersFrom } from '../../lib/units'
import {
  currentStreak,
  dailyBuckets,
  formatYmdPretty,
  parseLocalDate,
  records,
  toYmd,
  totals,
  type DayBucket,
  type RunLike,
} from '../../lib/stats'
import type { TravelMode, Unit } from '../../lib/types'

interface RunRecord {
  distanceMeters: number
  durationSeconds: number
  date: string
  unit?: Unit
  mode?: TravelMode
  routeId?: string
  place?: string
  notes?: string
}

interface PrefsRecord {
  weeklyGoalMeters?: number
}

/** Fallback weekly distance goal for the activity ring until the user sets their
 * own (~31 mi / 50 km). Persisted per-user in the `prefs` collection. */
const DEFAULT_WEEKLY_GOAL_METERS = 50_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Distance in the active unit with thousands separators and fixed decimals. */
function dist(meters: number, unit: Unit, decimals: number): string {
  return distanceIn(meters, unit).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Daily distance buckets for the current calendar week, Sunday → Saturday, so
 * the weekday axis reads S M T W T F S. Days later in the week than today are
 * kept (empty) so the week always shows its full Sun–Sat shape.
 */
function currentWeekDays(runs: RunLike[], now: Date): DayBucket[] {
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  const buckets: DayBucket[] = []
  const indexByKey = new Map<number, number>()
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i)
    indexByKey.set(d.getTime(), i)
    buckets.push({ date: toYmd(d), distanceMeters: 0, runCount: 0 })
  }
  for (const r of runs) {
    const d = parseLocalDate(r.date)
    if (!d) continue
    const idx = indexByKey.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())
    if (idx != null) {
      buckets[idx].distanceMeters += r.distanceMeters || 0
      buckets[idx].runCount += 1
    }
  }
  return buckets
}

export default function StatsPage() {
  const { records: runs, status } = useQuery<RunRecord>('runs', {
    orderBy: 'date',
    orderDir: 'desc',
  })
  const { remove } = useMutations<RunRecord>('runs')
  // orderBy makes prefs[0] deterministic (oldest first) so the same record is
  // always read/updated even if a duplicate ever slipped in across devices.
  const { records: prefs } = useQuery<PrefsRecord>('prefs', { orderBy: 'createdAt' })
  const { create: createPref, put: putPref } = useMutations<PrefsRecord>('prefs')
  const { success, error } = useToast()

  const [unit, setUnit] = useState<Unit>('mi')
  const [logging, setLogging] = useState(false)
  const [editingGoal, setEditingGoal] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null)

  // One prefs record per user; tolerate it not existing yet.
  const prefRecord = prefs[0]
  const goalMeters = prefRecord?.data.weeklyGoalMeters || DEFAULT_WEEKLY_GOAL_METERS

  const saveGoal = async (meters: number) => {
    if (prefRecord) {
      await putPref(prefRecord.recordId, { weeklyGoalMeters: meters })
    } else {
      await createPref({ weeklyGoalMeters: meters })
    }
  }

  // Drive the design's staggered fade-up once mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const runLikes: RunLike[] = useMemo(
    () =>
      runs.map((r) => ({
        distanceMeters: r.data.distanceMeters || 0,
        durationSeconds: r.data.durationSeconds || 0,
        date: r.data.date,
      })),
    [runs],
  )

  const { all, streak, week, days, weekDays, longestMeters } = useMemo(() => {
    const now = new Date()
    const wd = currentWeekDays(runLikes, now)
    return {
      all: totals(runLikes),
      streak: currentStreak(runLikes, now),
      // "This week" + goal ring track the current Sun–Sat calendar week.
      week: wd.reduce((sum, b) => sum + b.distanceMeters, 0),
      // Hero sparkline stays a rolling 7-day trend.
      days: dailyBuckets(runLikes, 7, now),
      weekDays: wd,
      longestMeters: records(runLikes).longest?.distanceMeters ?? 0,
    }
  }, [runLikes])

  const goalPct = Math.min(100, goalMeters > 0 ? (week / goalMeters) * 100 : 0)

  const handleDelete = async () => {
    if (!pendingDelete) return
    setRemoving(true)
    try {
      await remove(pendingDelete.id)
      success('Run deleted')
      setPendingDelete(null)
    } catch {
      error('Could not delete run')
    } finally {
      setRemoving(false)
    }
  }

  const rise = (delay: number) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'none' : 'translateY(18px)',
    transition: `opacity .8s cubic-bezier(.16,1,.3,1) ${delay}s, transform .8s cubic-bezier(.16,1,.3,1) ${delay}s`,
  })

  return (
    <div className="min-h-full bg-card text-foreground" data-testid="my-runs">
      {/* Top control row — clears the floating nav; gives the unit toggle a home. */}
      <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-5 pt-24">
        <span className="text-[13px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          My Runs
        </span>
        <div className="flex items-center gap-3">
          <UnitToggle unit={unit} onChange={setUnit} order={['km', 'mi']} />
          <button
            type="button"
            data-testid="log-run"
            onClick={() => setLogging(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-95"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add run
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex justify-center py-32">
          <LoadingSpinner />
        </div>
      )}

      {status !== 'loading' && (
        <>
          {/* Hero — career total */}
          <section className="mx-auto max-w-[1080px] px-5 pb-2 pt-12 text-center sm:pt-16">
            <div
              style={rise(0)}
              className="text-[13px] font-semibold uppercase tracking-[0.09em] text-primary"
            >
              Total distance
            </div>
            <h1
              style={rise(0.06)}
              className="mt-3 flex items-baseline justify-center gap-3"
            >
              <span className="text-[76px] font-bold leading-[0.9] tracking-[-0.045em] tabular-nums text-foreground sm:text-[120px]">
                {dist(all.distanceMeters, unit, 1)}
              </span>
              <span className="text-3xl font-semibold text-muted-foreground sm:text-4xl">{unit}</span>
            </h1>
            {all.count > 0 && (
              <div style={rise(0.1)} className="mt-6 flex justify-center">
                <Sparkline days={days} unit={unit} />
              </div>
            )}
            <p style={rise(0.16)} className="mt-5 text-lg text-muted-foreground sm:text-xl">
              {all.count > 0
                ? `${all.count} ${all.count === 1 ? 'run' : 'runs'} · ${streak}-day streak · ${dist(longestMeters, unit, 1)} ${unit} longest`
                : 'Log your first run to start your streak.'}
            </p>
            <div style={rise(0.2)} className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setLogging(true)}
                className="rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-95"
              >
                Add a run
              </button>
              <a
                href="#runs"
                className="inline-flex items-center rounded-full bg-secondary px-7 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent"
              >
                View activity
              </a>
            </div>
          </section>

          {/* Stat trio */}
          <section
            style={rise(0.28)}
            className="mx-auto mt-9 grid max-w-[1080px] gap-4 px-5 sm:grid-cols-3"
          >
            <StatCard
              label="Current streak"
              value={String(streak)}
              suffix={streak === 1 ? 'day' : 'days'}
              caption="Don't break the chain."
            />
            <StatCard
              label="This week"
              value={dist(week, unit, 1)}
              suffix={unit}
              caption={`${all.count} ${all.count === 1 ? 'run' : 'runs'} logged all-time.`}
            />
            <StatCard
              label="Average pace"
              value={formatPaceValue(all.distanceMeters, all.durationSeconds, unit)}
              suffix={`/${unit}`}
              caption="Across every logged run."
            />
          </section>

          {/* Weekly glance — full-bleed band */}
          <section className="mt-16 bg-muted px-5 py-16">
            <div className="mx-auto max-w-[1080px]">
              <h2 className="text-[28px] font-semibold tracking-[-0.025em] text-foreground sm:text-[38px]">
                Your week, at a glance.
              </h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Goal progress and daily distance, updated the moment you log a run.
              </p>
              <div className="mt-8 flex flex-wrap gap-5">
                <GoalRing
                  week={week}
                  unit={unit}
                  goalMeters={goalMeters}
                  goalPct={goalPct}
                  onEditGoal={() => setEditingGoal(true)}
                />
                <WeekBars days={weekDays} unit={unit} />
              </div>
            </div>
          </section>

          {/* Recent runs */}
          <section id="runs" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24 pt-16">
            <div className="flex flex-wrap items-center justify-between gap-3.5">
              <div>
                <h2 className="text-[28px] font-semibold tracking-[-0.025em] text-foreground sm:text-[38px]">
                  Recent runs
                </h2>
                <p className="mt-1.5 text-lg text-muted-foreground">
                  Every effort, kept in one clean record.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogging(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-95"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add run
              </button>
            </div>

            {runs.length > 0 ? (
              <div
                data-testid="run-list"
                className="mt-7 overflow-hidden rounded-3xl border border-border bg-card"
              >
                {runs.slice(0, 12).map((r) => (
                  <RunRow
                    key={r.recordId}
                    rec={r}
                    unit={unit}
                    onDelete={() =>
                      setPendingDelete({
                        id: r.recordId,
                        label: `${dist(r.data.distanceMeters, (r.data.unit as Unit) ?? unit, 2)} ${(r.data.unit as Unit) ?? unit} on ${formatYmdPretty(r.data.date)}`,
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="mt-7 rounded-3xl bg-muted px-6 py-16 text-center">
                <div className="text-[22px] font-semibold text-foreground">No runs yet.</div>
                <p className="mt-2 text-base text-muted-foreground">
                  Log your first run to start your streak.
                </p>
                <button
                  type="button"
                  onClick={() => setLogging(true)}
                  className="mt-6 rounded-full bg-primary px-7 py-3 text-base font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-95"
                >
                  Add a run
                </button>
              </div>
            )}
          </section>

          <footer className="border-t border-border px-5 py-7 text-center text-[13px] text-muted-foreground">
            runningmap — every run, beautifully counted.
          </footer>
        </>
      )}

      <LogRunDialog open={logging} onClose={() => setLogging(false)} />

      <GoalDialog
        open={editingGoal}
        unit={unit}
        goalMeters={goalMeters}
        onClose={() => setEditingGoal(false)}
        onSave={saveGoal}
      />

      <ConfirmModal
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete this run?"
        description={
          pendingDelete ? `${pendingDelete.label} will be permanently removed.` : 'This cannot be undone.'
        }
        confirmText="Delete"
        variant="destructive"
        loading={removing}
      />
    </div>
  )
}

function GoalDialog({
  open,
  unit,
  goalMeters,
  onClose,
  onSave,
}: {
  open: boolean
  unit: Unit
  goalMeters: number
  onClose: () => void
  onSave: (meters: number) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const { error } = useToast()

  // Seed the field with the current goal (in the active unit) each time it opens.
  useEffect(() => {
    if (open) {
      const v = distanceIn(goalMeters, unit)
      setValue((Math.round(v * 10) / 10).toString())
      setSaving(false)
    }
  }, [open, goalMeters, unit])

  const num = Number(value)
  const valid = value.trim() !== '' && num > 0 && Number.isFinite(num)

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await onSave(metersFrom(num, unit))
      onClose()
    } catch {
      error('Could not save goal')
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>Weekly goal</Modal.Title>
        <Modal.Description>
          How far do you want to run each week? The activity ring fills toward this.
        </Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-1.5">
          <Label htmlFor="weekly-goal">Distance per week</Label>
          <div className="flex items-center gap-2">
            <Input
              id="weekly-goal"
              data-testid="weekly-goal-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              autoFocus
              placeholder="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) void submit()
              }}
            />
            <span className="text-sm font-medium text-muted-foreground">{unit}</span>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button data-testid="weekly-goal-save" onClick={submit} loading={saving} disabled={!valid}>
          Save goal
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function StatCard({
  label,
  value,
  suffix,
  caption,
}: {
  label: string
  value: string
  suffix: string
  caption: string
}) {
  return (
    <div className="rounded-3xl bg-muted px-7 py-7">
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-3.5 flex items-baseline gap-2">
        <span className="text-5xl font-bold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-lg font-semibold text-muted-foreground">{suffix}</span>
      </div>
      <div className="mt-2.5 text-sm text-muted-foreground">{caption}</div>
    </div>
  )
}

function GoalRing({
  week,
  unit,
  goalMeters,
  goalPct,
  onEditGoal,
}: {
  week: number
  unit: Unit
  goalMeters: number
  goalPct: number
  onEditGoal: () => void
}) {
  // Radius + half the 20px stroke must stay within the 240-unit viewBox (≤120
  // from the centre) or the ring clips at the top/bottom/left/right.
  const r = 108
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - goalPct / 100)
  return (
    <div className="flex flex-1 basis-[300px] flex-col items-center justify-center gap-6 rounded-[28px] bg-card px-8 py-10 shadow-sm">
      <div className="relative h-[220px] w-[220px]">
        <svg width="220" height="220" viewBox="0 0 240 240" className="block">
          <circle
            cx="120"
            cy="120"
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--color-primary) 16%, transparent)"
            strokeWidth="20"
          />
          <circle
            cx="120"
            cy="120"
            r={r}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="20"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: '50% 50%',
              transition: 'stroke-dashoffset .9s cubic-bezier(.16,1,.3,1)',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-[46px] font-bold leading-none tracking-[-0.03em] tabular-nums text-foreground">
            {dist(week, unit, 1)}
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            of {dist(goalMeters, unit, 0)} {unit} goal
          </div>
          <div className="mt-2 text-[13px] font-bold tracking-[0.02em] text-primary">
            {Math.round(goalPct)}% complete
          </div>
        </div>
      </div>
      <button
        type="button"
        data-testid="edit-goal"
        onClick={onEditGoal}
        className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Set weekly goal
      </button>
    </div>
  )
}

/** Hero mini-chart: last-7-days distance as a filled sparkline (matches the
 * Overview design). Purely derived from the daily buckets, in the active unit. */
function Sparkline({ days, unit }: { days: DayBucket[]; unit: Unit }) {
  const W = 360
  const TOP = 8
  const BOT = 46
  const PAD = 6
  const values = days.map((b) => distanceIn(b.distanceMeters, unit))
  const max = Math.max(...values, 0.0001)
  const pts = values.map((v, i) => {
    const x = PAD + (i * (W - 2 * PAD)) / Math.max(1, days.length - 1)
    const y = BOT - (v / max) * (BOT - TOP)
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const area = `M ${pts[0].x},${BOT} L ${pts.map((p) => `${p.x},${p.y}`).join(' L ')} L ${pts[pts.length - 1].x},${BOT} Z`
  const end = pts[pts.length - 1]

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={W}
        height="54"
        viewBox={`0 0 ${W} 54`}
        className="block max-w-[78vw] overflow-visible"
        role="img"
        aria-label="Distance over the last 7 days"
      >
        <defs>
          <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#hero-spark)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={end.x} cy={end.y} r="4.5" fill="var(--color-primary)" stroke="var(--color-card)" strokeWidth="2" />
      </svg>
      <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        Last 7 days
      </div>
    </div>
  )
}

function WeekBars({ days, unit }: { days: DayBucket[]; unit: Unit }) {
  const max = Math.max(...days.map((b) => b.distanceMeters), 1)
  const todayYmd = toYmd()
  return (
    <div className="flex-[2] basis-[340px] rounded-[28px] bg-card px-8 py-8 shadow-sm">
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-semibold tracking-[-0.01em] text-foreground">This week</div>
        <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {unit} / day
        </div>
      </div>
      <div className="mt-7 flex h-[210px] items-end justify-between gap-2.5">
        {days.map((b) => {
          const isToday = b.date === todayYmd
          const pct = b.distanceMeters > 0 ? Math.max(8, Math.round((b.distanceMeters / max) * 100)) : 4
          const letter = DAY_LETTERS[(parseLocalDate(b.date)?.getDay() ?? 0)]
          const label = `${formatYmdPretty(b.date)}: ${dist(b.distanceMeters, unit, 1)} ${unit}`
          return (
            <div
              key={b.date}
              className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              title={label}
              role="img"
              aria-label={label}
            >
              <div className="h-[15px] text-[11px] font-semibold tabular-nums text-muted-foreground">
                {b.distanceMeters > 0 ? dist(b.distanceMeters, unit, 1) : ''}
              </div>
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className={cn(
                    'w-[72%] max-w-[48px] rounded-t-[9px] transition-[height] duration-700 ease-out',
                    b.distanceMeters > 0 ? 'bg-gradient-to-b from-primary to-primary/80' : 'bg-border',
                  )}
                  style={{ height: `${pct}%` }}
                  aria-hidden
                />
              </div>
              <div
                className={cn(
                  'text-[13px] font-semibold',
                  isToday ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {letter}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RunRow({
  rec,
  unit,
  onDelete,
}: {
  rec: RecordData<RunRecord>
  unit: Unit
  onDelete: () => void
}) {
  const d = rec.data
  const date = parseLocalDate(d.date)
  const month = date ? MONTHS[date.getMonth()] : ''
  const dayNum = date ? date.getDate() : ''
  const weekday = date ? WEEKDAYS[date.getDay()] : ''
  return (
    <div
      data-testid="run-row"
      className="group flex items-center gap-5 border-t border-border px-6 py-5 transition-colors first:border-t-0 hover:bg-secondary/40"
    >
      <div className="flex w-[54px] flex-none flex-col items-center justify-center">
        <div className="text-xs font-semibold uppercase tracking-[0.04em] text-primary">{month}</div>
        <div className="text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
          {dayNum}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tracking-[-0.01em] tabular-nums text-foreground">
            {dist(d.distanceMeters, unit, 2)}
          </span>
          <span className="text-[15px] font-medium text-muted-foreground">{unit}</span>
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {weekday}
          {d.place ? ` · ${d.place}` : ''}
        </div>
      </div>
      <div className="flex-none text-right">
        <div className="text-[17px] font-semibold tabular-nums text-foreground">
          {formatMmSs(d.durationSeconds)}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">time</div>
      </div>
      <div className="w-[90px] flex-none text-right">
        <div className="text-[17px] font-semibold tabular-nums text-foreground">
          {formatPaceValue(d.distanceMeters, d.durationSeconds, unit)}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">/{unit}</div>
      </div>
      <button
        type="button"
        aria-label="Delete run"
        data-testid="run-delete"
        onClick={onDelete}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
