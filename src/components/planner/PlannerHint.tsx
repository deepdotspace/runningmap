/**
 * First-run guidance shown over an empty map. The planner's interactions
 * (tap to add, drag to adjust, shift-click to remove) are otherwise invisible,
 * so a new user lands on a blank map with no idea what to do. The parent only
 * mounts this while the route has no points, so it disappears on the first tap;
 * a manual dismiss is offered too.
 */

import { useState } from 'react'
import { MousePointerClick, Move, Search, X } from 'lucide-react'

const TIPS = [
  { Icon: Move, text: 'Drag a point to fine-tune the line' },
  { Icon: MousePointerClick, text: 'Shift-click a point to remove it' },
  { Icon: Search, text: 'Or search a place to jump there' },
] as const

export function PlannerHint() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    // Wrapper lets map taps fall through; only the card itself is interactive.
    // Sits at the top, centred in the gap between the left title block and the
    // right profile/search clusters — they hug the corners, so the centre stays
    // clear at usable widths.
    <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-10 flex justify-center px-3">
      <div className="pointer-events-auto relative w-full max-w-sm rounded-2xl border border-border bg-card/85 p-4 pr-10 shadow-xl backdrop-blur-md">
        <button
          type="button"
          aria-label="Dismiss tip"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <p className="text-sm font-semibold text-foreground">
          Tap the map to drop your start point
        </p>
        <ul className="mt-2 space-y-1.5">
          {TIPS.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
