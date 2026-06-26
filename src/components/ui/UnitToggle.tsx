/**
 * Sliding mi/km pill toggle, shared by the My Routes and My Runs dashboards.
 *
 * `order` controls which unit sits on the left; the sliding indicator is driven
 * from the active unit's index in `order`, so the highlight always tracks the
 * selected button regardless of ordering.
 */

import type { Unit } from '../../lib/types'

export function UnitToggle({
  unit,
  onChange,
  order = ['mi', 'km'],
}: {
  unit: Unit
  onChange: (u: Unit) => void
  order?: readonly [Unit, Unit]
}) {
  const activeIndex = order.indexOf(unit)
  return (
    <div className="relative flex rounded-full bg-secondary p-[3px]">
      <span
        aria-hidden
        className="absolute bottom-[3px] top-[3px] w-[calc(50%-3px)] rounded-full bg-card shadow-sm transition-transform duration-300 ease-out"
        style={{ transform: activeIndex === 1 ? 'translateX(100%)' : 'translateX(0)' }}
      />
      {order.map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={unit === u}
          onClick={() => onChange(u)}
          className="relative z-10 rounded-full px-4 py-1.5 text-[13px] font-semibold text-foreground"
        >
          {u}
        </button>
      ))}
    </div>
  )
}
