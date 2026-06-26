/** Panel shown when a waypoint is selected: delete it, or change the travel
 * mode of the leg leading into it (per-segment mode control). */

import { Trash2, X } from 'lucide-react'
import type { TravelMode } from '../../lib/types'
import { cn } from '../ui/utils'
import { MODE_META } from './modes'

interface SelectedPointPanelProps {
  index: number
  total: number
  /** Mode of the segment leading into this point, or null for the start. */
  incomingMode: TravelMode | null
  onChangeIncomingMode: (mode: TravelMode) => void
  onDelete: () => void
  onClose: () => void
}

export function SelectedPointPanel({
  index,
  total,
  incomingMode,
  onChangeIncomingMode,
  onDelete,
  onClose,
}: SelectedPointPanelProps) {
  const role = index === 0 ? 'Start' : index === total - 1 ? 'Finish' : 'Waypoint'
  return (
    <div
      data-testid="selected-point-panel"
      className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-3 py-2 shadow-lg backdrop-blur-md"
    >
      <span className="text-sm font-medium text-foreground">
        {role} · point {index + 1}/{total}
      </span>

      {incomingMode && (
        <div className="flex items-center gap-1 border-l border-border pl-3">
          <span className="text-xs text-muted-foreground">Leg:</span>
          {MODE_META.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              aria-label={`Set incoming leg to ${label}`}
              title={label}
              data-testid={`leg-mode-${mode}`}
              onClick={() => onChangeIncomingMode(mode)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                mode === incomingMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        data-testid="delete-point-btn"
        onClick={onDelete}
        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Delete
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
