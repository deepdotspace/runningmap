/** Travel-mode display metadata shared across planner UI. */

import { Bike, Car, Footprints, PenLine } from 'lucide-react'
import type { TravelMode } from '../../lib/types'

export interface ModeMeta {
  mode: TravelMode
  label: string
  hint: string
  Icon: typeof Footprints
}

export const MODE_META: ModeMeta[] = [
  { mode: 'foot', label: 'Walk', hint: 'Snap to footpaths', Icon: Footprints },
  { mode: 'bike', label: 'Bike', hint: 'Snap to cycle routes', Icon: Bike },
  { mode: 'car', label: 'Drive', hint: 'Snap to roads', Icon: Car },
  { mode: 'manual', label: 'Manual', hint: 'Straight lines, no snapping', Icon: PenLine },
]

export function modeMeta(mode: TravelMode): ModeMeta {
  return MODE_META.find((m) => m.mode === mode) ?? MODE_META[0]
}
