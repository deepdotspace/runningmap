/**
 * Brand — the runningmap mark + wordmark.
 *
 * The mark is an inline SVG (a winding route between two nodes) so it inherits
 * `currentColor` and themes for free. Used in the floating nav; reusable
 * anywhere the brand should appear.
 */

import { cn } from './ui/utils'

/** Route glyph: a start node, a curved path, and an end pin. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('text-primary', className)}
      aria-hidden
    >
      {/* The route line */}
      <path
        d="M6.5 17.5c3.2 0 3.2-4.2 5.5-4.2s2.3-4.6 5.5-4.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Start node */}
      <circle cx="6.5" cy="17.5" r="2.4" fill="currentColor" />
      {/* End pin (donut so it reads as a destination, not just a dot) */}
      <circle cx="17.5" cy="8.7" r="2.6" fill="currentColor" />
      <circle cx="17.5" cy="8.7" r="1" className="fill-card" />
    </svg>
  )
}

/** Mark + wordmark lockup. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandMark className="h-5 w-5 shrink-0" />
      {/* Wordmark hides on the smallest screens so it never crowds the
          centered search box on the planner. */}
      <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
        running<span className="text-primary">map</span>
      </span>
    </span>
  )
}
