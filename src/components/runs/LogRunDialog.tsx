/**
 * Log a run — manual entry. A run is an immutable snapshot: when the user links
 * a saved route we *copy* its distance/place/mode in (and keep a soft `routeId`),
 * so later editing or deleting that route never rewrites the logged run.
 *
 * Uses UI primitives throughout (no native <select>/confirm), validates before
 * saving, and stores distance/time in SI base units + a local 'YYYY-MM-DD' date.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import {
  Button,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '../ui'
import { metersFrom } from '../../lib/units'
import { toYmd } from '../../lib/stats'
import type { TravelMode, Unit } from '../../lib/types'

interface RouteRecord {
  name: string
  distanceMeters: number
  unit?: string
  mode?: TravelMode
  place?: string
}

interface RunRecord {
  distanceMeters: number
  durationSeconds: number
  date: string
  unit: Unit
  mode: TravelMode
  routeId?: string
  place?: string
  notes?: string
}

const NONE = 'none'

export function LogRunDialog({
  open,
  onClose,
  onLogged,
}: {
  open: boolean
  onClose: () => void
  onLogged?: () => void
}) {
  const { records: routes } = useQuery<RouteRecord>('routes', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { create } = useMutations<RunRecord>('runs')
  const { success, error: toastError } = useToast()

  const [unit, setUnit] = useState<Unit>('mi')
  const [distance, setDistance] = useState('')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [seconds, setSeconds] = useState('')
  const [date, setDate] = useState(() => toYmd())
  const [routeId, setRouteId] = useState(NONE)
  const [mode, setMode] = useState<TravelMode>('foot')
  const [place, setPlace] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)

  const today = useMemo(() => toYmd(), [])

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setUnit('mi')
    setDistance('')
    setHours('')
    setMinutes('')
    setSeconds('')
    setDate(toYmd())
    setRouteId(NONE)
    setMode('foot')
    setPlace('')
    setNotes('')
    setSubmitting(false)
    setTouched(false)
  }, [open])

  // Linking a route snapshots its distance/place/mode into the form (editable).
  const onPickRoute = (id: string) => {
    setRouteId(id)
    if (id === NONE) return
    const r = routes.find((rec) => rec.recordId === id)
    if (!r) return
    const u = (r.data.unit as Unit) ?? 'mi'
    setUnit(u)
    setDistance(distanceToInput(r.data.distanceMeters, u))
    // The Activity picker only offers foot/bike; a route saved as car/manual
    // would blank the Select, so clamp it to a loggable run activity.
    setMode(r.data.mode === 'bike' ? 'bike' : 'foot')
    setPlace(r.data.place ?? '')
  }

  const distanceNum = Number(distance)
  const totalSeconds =
    (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0)

  const distanceError =
    distance.trim() === '' || !(distanceNum > 0) ? 'Enter a distance greater than 0.' : null
  const timeError = !(totalSeconds > 0) ? 'Enter a time greater than 0.' : null
  const dateError = !date ? 'Pick a date.' : date > today ? 'Date can’t be in the future.' : null
  const formError = distanceError || timeError || dateError

  const handleSubmit = async () => {
    setTouched(true)
    if (formError) return
    setSubmitting(true)
    try {
      const linked = routeId !== NONE ? routes.find((r) => r.recordId === routeId) : null
      await create({
        distanceMeters: metersFrom(distanceNum, unit),
        durationSeconds: totalSeconds,
        date,
        unit,
        mode,
        ...(linked ? { routeId } : {}),
        ...(place.trim() ? { place: place.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      success('Run logged')
      onLogged?.()
      onClose()
    } catch {
      toastError('Could not log run')
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header>
        <Modal.Title>Log a run</Modal.Title>
        <Modal.Description>Record a run you finished. Pace and weekly totals update automatically.</Modal.Description>
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {/* Distance + unit */}
        <div className="space-y-1.5">
          <Label htmlFor="run-distance">Distance</Label>
          <div className="flex items-center gap-2">
            <Input
              id="run-distance"
              data-testid="run-distance"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              aria-invalid={touched && distanceError ? true : undefined}
            />
            <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
              <SelectTrigger className="w-24" aria-label="Distance unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mi">mi</SelectItem>
                <SelectItem value="km">km</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {touched && distanceError && (
            <p className="text-xs text-destructive">{distanceError}</p>
          )}
        </div>

        {/* Time hh:mm:ss */}
        <div className="space-y-1.5">
          <Label>Time</Label>
          <div className="flex items-center gap-2">
            <TimeField label="hours" testid="run-hours" value={hours} onChange={setHours} max={99} />
            <span className="text-muted-foreground">:</span>
            <TimeField label="minutes" testid="run-minutes" value={minutes} onChange={setMinutes} max={59} />
            <span className="text-muted-foreground">:</span>
            <TimeField label="seconds" testid="run-seconds" value={seconds} onChange={setSeconds} max={59} />
          </div>
          {touched && timeError && <p className="text-xs text-destructive">{timeError}</p>}
        </div>

        {/* Date + mode */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="run-date">Date</Label>
            <Input
              id="run-date"
              data-testid="run-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={touched && dateError ? true : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Activity</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as TravelMode)}>
              <SelectTrigger aria-label="Activity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="foot">Run / walk</SelectItem>
                <SelectItem value="bike">Bike</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {touched && dateError && <p className="text-xs text-destructive">{dateError}</p>}

        {/* Optional link to a saved route */}
        {routes.length > 0 && (
          <div className="space-y-1.5">
            <Label>Link a saved route (optional)</Label>
            <Select value={routeId} onValueChange={onPickRoute}>
              <SelectTrigger aria-label="Link a saved route">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No linked route</SelectItem>
                {routes.map((r) => (
                  <SelectItem key={r.recordId} value={r.recordId}>
                    {r.data.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="run-notes">Notes (optional)</Label>
          <Textarea
            id="run-notes"
            rows={2}
            placeholder="How did it feel?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          data-testid="run-submit"
          onClick={handleSubmit}
          loading={submitting}
          disabled={touched && formError != null}
        >
          Log run
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function TimeField({
  label,
  testid,
  value,
  onChange,
  max,
}: {
  label: string
  testid: string
  value: string
  onChange: (v: string) => void
  max: number
}) {
  return (
    <Input
      aria-label={label}
      data-testid={testid}
      type="number"
      inputMode="numeric"
      min="0"
      max={max}
      placeholder="00"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 text-center"
    />
  )
}

function distanceToInput(meters: number, unit: Unit): string {
  const v = unit === 'mi' ? meters / 1609.344 : meters / 1000
  return (Math.round(v * 100) / 100).toString()
}
