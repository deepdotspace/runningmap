/**
 * /routes — "My Routes", presented as the Claude "Run Routes" **Activities**
 * design: a hero, a horizontal **Saved routes** rail, and a **Recent activities**
 * grid of logged runs. Each saved-route card sketches the snapped shape and
 * reopens in the planner via its `?r=` share string (with inline rename/delete);
 * each activity card sketches its *linked* route's shape (when the run still
 * points at a saved route) plus distance / pace / time, and is filterable by mode.
 *
 * Runs are owner-scoped snapshots that only *softly* reference a route, so an
 * activity whose route was deleted (or that was logged with no route) simply
 * shows a gridded placeholder instead of a sketch — never a fake shape. Runs
 * carry no elevation, so the design's 4th "Elev" stat is intentionally dropped.
 *
 * The design's Apple palette maps onto the app's theme tokens (primary/
 * foreground/card/secondary/muted/border), so it renders faithfully under the
 * `apple` theme and adapts to every other theme. Distances display in the chosen
 * unit (distanceMeters is SI, so conversion is free).
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type RecordData, useMutations, useQuery } from 'deepspace'
import {
  ArrowRight,
  Bike,
  Car,
  Footprints,
  MapPin,
  MapPinned,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  Button,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  LoadingSpinner,
  Modal,
  UnitToggle,
  cn,
  useToast,
} from '../../components/ui'
import { distanceIn, formatClock, formatPaceValue } from '../../lib/units'
import { formatYmdPretty } from '../../lib/stats'
import type { TravelMode, Unit } from '../../lib/types'
import { useRouteShape } from '../../hooks/useRouteShape'
import { RouteThumbnail } from '../../components/RouteThumbnail'

interface RouteRecord {
  name: string
  encoded: string
  distanceMeters: number
  durationSeconds?: number
  unit: string
  /** Encoded polyline of the snapped path (newer saves). */
  shape?: string
  mode?: TravelMode
  place?: string
}

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

const MODE_META: Record<TravelMode, { label: string; Icon: typeof Footprints }> = {
  foot: { label: 'Walk', Icon: Footprints },
  bike: { label: 'Bike', Icon: Bike },
  car: { label: 'Drive', Icon: Car },
  manual: { label: 'Manual', Icon: PenLine },
}

/** Distance value (no unit) in the chosen unit with fixed decimals. */
function distValue(meters: number, unit: Unit, decimals: number): string {
  return distanceIn(meters, unit).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export default function MyRoutesPage() {
  const { records: routes, status } = useQuery<RouteRecord>('routes', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { records: runs, status: runsStatus } = useQuery<RunRecord>('runs', {
    orderBy: 'date',
    orderDir: 'desc',
  })
  const { remove, put } = useMutations<RouteRecord>('routes')
  const { success, error } = useToast()
  const navigate = useNavigate()

  const [unit, setUnit] = useState<Unit>('mi')
  const [filter, setFilter] = useState<TravelMode | 'all'>('all')
  const [removing, setRemoving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  // Resolve a run's soft route pointer to the (still-existing) route record so
  // activity cards can sketch the real shape.
  const routesById = useMemo(() => {
    const map = new Map<string, RouteRecord>()
    for (const r of routes) map.set(r.recordId, r.data)
    return map
  }, [routes])

  // "All" plus whichever modes actually appear across logged runs.
  const presentModes = useMemo(() => {
    const set = new Set<TravelMode>()
    for (const r of runs) set.add(r.data.mode ?? 'foot')
    return (['foot', 'bike', 'car', 'manual'] as const).filter((m) => set.has(m))
  }, [runs])

  const visibleRuns = useMemo(
    () => (filter === 'all' ? runs : runs.filter((r) => (r.data.mode ?? 'foot') === filter)),
    [runs, filter],
  )

  const loading = status === 'loading' || runsStatus === 'loading'

  const handleDelete = async () => {
    if (!pendingDelete) return
    setRemoving(true)
    try {
      await remove(pendingDelete.id)
      success('Route deleted')
      setPendingDelete(null)
    } catch {
      error('Could not delete route')
    } finally {
      setRemoving(false)
    }
  }

  const handleRename = async (name: string) => {
    if (!renaming) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === renaming.name) {
      setRenaming(null)
      return
    }
    try {
      await put(renaming.id, { name: trimmed })
      success('Route renamed')
    } catch {
      error('Could not rename route')
    } finally {
      setRenaming(null)
    }
  }

  return (
    <div className="min-h-full bg-card text-foreground" data-testid="my-routes">
      {/* Hero */}
      <section className="mx-auto max-w-[1120px] px-5 pb-2 pt-24">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold uppercase tracking-[0.09em] text-primary">
            My Routes
          </div>
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[34px] font-bold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-[52px]">
            Every route you've run.
          </h1>
          <div className="text-[17px] text-muted-foreground">
            {routes.length > 0 || runs.length > 0
              ? `${routes.length} ${routes.length === 1 ? 'route' : 'routes'} · ${runs.length} ${runs.length === 1 ? 'activity' : 'activities'}`
              : 'Your saved routes and logged runs, together.'}
          </div>
        </div>
      </section>

      {loading && (
        <div className="flex justify-center py-32">
          <LoadingSpinner />
        </div>
      )}

      {!loading && (
        <>
          {/* Saved routes — horizontal rail */}
          <section className="mt-10 bg-muted px-5 py-12">
            <div className="mx-auto max-w-[1120px]">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
                    Saved routes
                  </h2>
                  <p className="mt-1 text-[15px] text-muted-foreground">
                    Tap any to run it again.
                  </p>
                </div>
                <Button onClick={() => navigate('/create')} className="shrink-0 gap-1.5">
                  <Plus className="h-4 w-4" aria-hidden />
                  Plan a route
                </Button>
              </div>

              {routes.length > 0 ? (
                <div className="mt-6 flex gap-[18px] overflow-x-auto pb-2">
                  {routes.map((rec) => (
                    <SavedRouteCard
                      key={rec.recordId}
                      rec={rec}
                      unit={unit}
                      onRename={() => setRenaming({ id: rec.recordId, name: rec.data.name })}
                      onDelete={() => setPendingDelete({ id: rec.recordId, name: rec.data.name })}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-6">
                  <EmptyState
                    icon={<MapPinned className="h-8 w-8" />}
                    title="No saved routes yet"
                    description="Plan a route, then hit Save to keep it here."
                    action={{ label: 'Open the planner', onClick: () => navigate('/create') }}
                  />
                </div>
              )}
            </div>
          </section>

          {/* Recent activities — grid of logged runs */}
          <section className="mx-auto max-w-[1120px] px-5 pb-24 pt-14">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
                Recent activities
              </h2>
              {runs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                    All
                  </FilterChip>
                  {presentModes.map((m) => (
                    <FilterChip key={m} active={filter === m} onClick={() => setFilter(m)}>
                      {MODE_META[m].label}
                    </FilterChip>
                  ))}
                </div>
              )}
            </div>

            {runs.length === 0 ? (
              <div className="mt-7 rounded-3xl bg-muted px-6 py-16 text-center">
                <div className="text-[22px] font-semibold text-foreground">No activities yet.</div>
                <p className="mt-2 text-base text-muted-foreground">
                  Log a run to see it mapped here.
                </p>
                <Link
                  to="/stats"
                  className="mt-6 inline-flex rounded-full bg-primary px-7 py-3 text-base font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-95"
                >
                  Go to My Runs
                </Link>
              </div>
            ) : (
              <div className="mt-7 grid gap-[22px] [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
                {visibleRuns.map((rec) => (
                  <RunActivityCard
                    key={rec.recordId}
                    rec={rec}
                    unit={unit}
                    route={rec.data.routeId ? routesById.get(rec.data.routeId) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <RenameDialog
        open={renaming != null}
        initialName={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        onSave={handleRename}
      />

      <ConfirmModal
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title={pendingDelete ? `Delete "${pendingDelete.name}"?` : 'Delete route?'}
        description="This route will be permanently removed. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        loading={removing}
      />
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-4 py-2 text-[13px] font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

/** Faint grid overlay shared by every map sketch, matching the design. */
function MapGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.5]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg,rgba(0,0,0,0.04) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,rgba(0,0,0,0.04) 0 1px,transparent 1px 28px)',
      }}
    />
  )
}

function SavedRouteCard({
  rec,
  unit,
  onRename,
  onDelete,
}: {
  rec: RecordData<RouteRecord>
  unit: Unit
  onRename: () => void
  onDelete: () => void
}) {
  const d = rec.data
  const href = `/create?r=${encodeURIComponent(d.encoded)}`
  const coords = useRouteShape(d.encoded, d.shape)
  const mode = MODE_META[d.mode ?? 'foot'] ?? MODE_META.foot

  return (
    <div
      data-testid="route-card"
      className="group relative w-[268px] flex-none rounded-[22px] border border-border bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_14px_38px_-22px_rgba(0,0,0,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* Full-card click target opens the route; action controls sit above it. */}
      <Link to={href} aria-label={`Open ${d.name}`} className="absolute inset-0 z-10 rounded-[22px]" />

      {/* Map sketch + hover actions */}
      <div className="relative h-[150px] overflow-hidden rounded-2xl bg-muted">
        <RouteThumbnail coords={coords} className="h-full w-full" />
        <MapGrid />
        <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Rename ${d.name}`}
            data-testid="route-rename"
            onClick={onRename}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            <PenLine className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${d.name}`}
            data-testid="route-delete"
            onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/90 text-destructive shadow-sm backdrop-blur transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Name + mode chip */}
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <h3
          className="truncate text-[16px] font-semibold tracking-[-0.01em] text-foreground"
          data-testid="route-card-name"
        >
          {d.name}
        </h3>
        <span className="flex flex-none items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <mode.Icon className="h-3 w-3" aria-hidden />
          {mode.label}
        </span>
      </div>

      {/* Distance + Run it */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-baseline gap-1">
          <span className="text-[21px] font-bold tabular-nums tracking-[-0.02em] text-foreground">
            {distValue(d.distanceMeters, unit, 1)}
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">{unit}</span>
        </div>
        <Link
          to={href}
          className="relative z-20 inline-flex items-center gap-1 rounded-full bg-secondary px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          Run it
        </Link>
      </div>
    </div>
  )
}

function RunActivityCard({
  rec,
  unit,
  route,
}: {
  rec: RecordData<RunRecord>
  unit: Unit
  route?: RouteRecord
}) {
  const d = rec.data
  // Always call the hook (hooks can't be conditional); an empty encoded string
  // resolves to no geometry, so unlinked runs simply render a gridded placeholder.
  const coords = useRouteShape(route?.encoded ?? '', route?.shape)
  const hasMap = coords.length >= 2
  const mode = MODE_META[d.mode ?? 'foot'] ?? MODE_META.foot
  const href = route?.encoded ? `/create?r=${encodeURIComponent(route.encoded)}` : null

  const title = route?.name ?? d.place ?? `${mode.label} run`
  const datePretty = formatYmdPretty(d.date)
  const subtitle = d.place && d.place !== title ? `${datePretty} · ${d.place}` : datePretty

  return (
    <div
      data-testid="activity-card"
      className="group relative flex flex-col rounded-3xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-22px_rgba(0,0,0,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {href && (
        <Link
          to={href}
          aria-label={`Open ${title} in the planner`}
          className="absolute inset-0 z-10 rounded-3xl"
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[19px] font-semibold tracking-[-0.015em] text-foreground">
            {title}
          </h3>
          <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            {d.place && d.place !== title && <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{subtitle}</span>
          </div>
        </div>
        <span className="flex flex-none items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <mode.Icon className="h-3 w-3" aria-hidden />
          {mode.label}
        </span>
      </div>

      {/* Map sketch (or placeholder) */}
      <div className="relative mt-4 h-[214px] overflow-hidden rounded-2xl bg-muted">
        {hasMap ? (
          <RouteThumbnail coords={coords} className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] font-medium text-muted-foreground">
            No route linked
          </div>
        )}
        <MapGrid />
      </div>

      {/* Stats: distance / pace / time */}
      <div className="mt-4 flex">
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Distance
          </div>
          <div className="mt-1 text-[19px] font-semibold tabular-nums text-foreground">
            {distValue(d.distanceMeters, unit, 2)}{' '}
            <span className="text-[13px] font-medium text-muted-foreground">{unit}</span>
          </div>
        </div>
        <div className="flex-1 border-l border-border pl-4">
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Pace
          </div>
          <div className="mt-1 text-[19px] font-semibold tabular-nums text-foreground">
            {formatPaceValue(d.distanceMeters, d.durationSeconds, unit)}{' '}
            <span className="text-[13px] font-medium text-muted-foreground">/{unit}</span>
          </div>
        </div>
        <div className="flex-1 border-l border-border pl-4">
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Time
          </div>
          <div className="mt-1 text-[19px] font-semibold tabular-nums text-foreground">
            {formatClock(d.durationSeconds)}
          </div>
        </div>
      </div>
    </div>
  )
}

function RenameDialog({
  open,
  initialName,
  onClose,
  onSave,
}: {
  open: boolean
  initialName: string
  onClose: () => void
  onSave: (name: string) => void | Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)

  // Seed the field each time the dialog opens for a different route.
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const submit = async () => {
    setSaving(true)
    try {
      await onSave(name)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>Rename route</Modal.Title>
        <Modal.Description>Give this route a name you'll recognise.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-1.5">
          <Label htmlFor="route-name">Route name</Label>
          <Input
            id="route-name"
            data-testid="route-name-input"
            autoFocus
            value={name}
            maxLength={80}
            placeholder="Morning river loop"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void submit()
            }}
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button data-testid="route-name-save" onClick={submit} loading={saving} disabled={!name.trim()}>
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
