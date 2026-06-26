/** Floating travel-mode selector (top-left). Sets the mode for new segments. */

import type { TravelMode } from '../../lib/types'
import { cn } from '../ui/utils'
import { MODE_META } from './modes'

interface ModePillProps {
  value: TravelMode
  onChange: (mode: TravelMode) => void
  /** Drop the standalone glass chrome and fill its container as an even
   *  segmented control — for embedding inside another panel (e.g. the bottom bar). */
  embedded?: boolean
}

export function ModePill({ value, onChange, embedded }: ModePillProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Travel mode"
      className={cn(
        'flex items-center gap-1',
        embedded
          ? 'w-full rounded-xl bg-secondary/50 p-1'
          : 'rounded-2xl border border-border bg-card/80 p-1 shadow-lg backdrop-blur-md',
      )}
    >
      {MODE_META.map(({ mode, label, hint, Icon }) => {
        const active = mode === value
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} — ${hint}`}
            title={`${label} — ${hint}`}
            data-testid={`mode-${mode}`}
            onClick={() => onChange(mode)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
              embedded && 'flex-1',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
