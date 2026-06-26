/** Floating bottom action bar: distance + unit, undo/redo, route actions,
 * GPX export, share, save, and the elevation toggle. */

import {
  Download,
  Loader2,
  type LucideIcon,
  MoreHorizontal,
  Mountain,
  Redo2,
  Repeat,
  RotateCcw,
  Share2,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { TravelMode, Unit } from '../../lib/types'
import { formatDistanceValue, formatDuration, otherUnit } from '../../lib/units'
import { cn } from '../ui/utils'
import { ModePill } from './ModePill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu'

interface BottomBarProps {
  totalMeters: number
  totalSeconds: number
  unit: Unit
  onToggleUnit: () => void
  mode: TravelMode
  onModeChange: (mode: TravelMode) => void
  pointCount: number
  snapping: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onReverse: () => void
  onReturnToStart: () => void
  onOutBack: () => void
  onExportGpx: () => void
  onShare: () => void
  onSave: (() => void) | null
  saving: boolean
  elevationOpen: boolean
  onToggleElevation: () => void
}

export function BottomBar(props: BottomBarProps) {
  const {
    totalMeters,
    totalSeconds,
    unit,
    onToggleUnit,
    mode,
    onModeChange,
    pointCount,
    snapping,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onClear,
    onReverse,
    onReturnToStart,
    onOutBack,
    onExportGpx,
    onShare,
    onSave,
    saving,
    elevationOpen,
    onToggleElevation,
  } = props
  const hasRoute = pointCount >= 2
  const isEmpty = pointCount === 0

  return (
    <div className="pointer-events-auto flex flex-col gap-2.5 rounded-2xl border border-border bg-card/85 px-3 py-2.5 shadow-xl backdrop-blur-md">
      {/* Row 1 — distance readout + unit toggle, with an estimated-time / hint line beneath */}
      <div className="flex flex-col px-0.5">
        <div className="flex items-baseline gap-1.5">
          <span data-testid="distance-value" className="text-2xl font-semibold tabular-nums text-foreground">
            {formatDistanceValue(totalMeters, unit)}
          </span>
          <button
            type="button"
            data-testid="unit-toggle"
            onClick={onToggleUnit}
            aria-label={`Switch to ${otherUnit(unit)}`}
            className="rounded-md px-1.5 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {unit}
          </button>
          {snapping && (
            <Loader2
              data-testid="snapping-indicator"
              className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground"
              aria-label="Snapping to roads"
            />
          )}
        </div>
        {hasRoute ? (
          <span
            data-testid="duration-value"
            className="-mt-0.5 text-xs font-medium tabular-nums text-muted-foreground"
            title="Estimated travel time"
          >
            ~{formatDuration(totalSeconds)}
          </span>
        ) : (
          <span className="-mt-0.5 text-xs font-medium text-muted-foreground">
            {isEmpty ? 'Tap the map to begin' : 'Add one more point'}
          </span>
        )}
      </div>

      {/* Row 2 — travel mode (Strava-style control deck), available even before drawing */}
      <ModePill value={mode} onChange={onModeChange} embedded />

      {/* Row 3 — actions appear once the route has at least one point — an empty
          deck is just the readout + mode, not a wall of disabled icons. */}
      {!isEmpty && (
        <>
          <div className="h-px w-full bg-border" />
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Undo" testid="undo-btn" disabled={!canUndo} onClick={onUndo} Icon={Undo2} />
            <IconButton label="Redo" testid="redo-btn" disabled={!canRedo} onClick={onRedo} Icon={Redo2} />

            {/* Clear is a primary action — kept visible next to undo/redo, not buried
                in the overflow menu. Destructive hover so it reads as a wipe. */}
            <button
              type="button"
              aria-label="Clear route"
              title="Clear route"
              data-testid="clear-route"
              disabled={pointCount === 0}
              onClick={onClear}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More route actions"
                  data-testid="more-btn"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top" className="w-52">
                <DropdownMenuItem onClick={onReturnToStart} disabled={!hasRoute} data-testid="return-to-start">
                  <RotateCcw className="mr-2 h-4 w-4" /> Return to start
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOutBack} disabled={!hasRoute} data-testid="out-and-back">
                  <Repeat className="mr-2 h-4 w-4" /> Out &amp; back
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onReverse} disabled={!hasRoute} data-testid="reverse-route">
                  <Repeat className="mr-2 h-4 w-4" /> Reverse direction
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="h-7 w-px bg-border" />

            <IconButton
              label="Elevation"
              testid="elevation-toggle"
              active={elevationOpen}
              disabled={!hasRoute}
              onClick={onToggleElevation}
              Icon={Mountain}
            />
            <IconButton
              label="Export GPX"
              testid="export-gpx"
              disabled={!hasRoute}
              onClick={onExportGpx}
              Icon={Download}
            />
            <IconButton label="Share link" testid="share-btn" disabled={pointCount === 0} onClick={onShare} Icon={Share2} />

            {onSave && (
              <button
                type="button"
                data-testid="save-btn"
                title="Save route"
                disabled={!hasRoute || saving || snapping}
                onClick={onSave}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                <span className="hidden sm:inline">Save</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function IconButton({
  label,
  testid,
  Icon,
  onClick,
  disabled,
  active,
}: {
  label: string
  testid?: string
  Icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
