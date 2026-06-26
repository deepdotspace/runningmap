/**
 * Generic past/present/future undo-redo stack. Pure and immutable so it can be
 * driven from a reducer and unit-tested without React.
 */

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

/** Cap so a long editing session can't grow history without bound. */
const MAX_HISTORY = 100

export function initHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] }
}

/** Commit a new present, recording the old one for undo. Clears redo. */
export function pushHistory<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  const past = [...h.past, h.present]
  if (past.length > MAX_HISTORY) past.shift()
  return { past, present: next, future: [] }
}

/** Replace the present without touching history (e.g. live drag updates). */
export function replacePresent<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  return { ...h, present: next }
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h
  const previous = h.past[h.past.length - 1]
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
  }
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h
  const next = h.future[0]
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
  }
}
