import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redo,
  replacePresent,
  undo,
} from './history'

describe('history', () => {
  it('starts with no undo/redo', () => {
    const h = initHistory(1)
    expect(h.present).toBe(1)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('pushes, undoes and redoes', () => {
    let h = initHistory(1)
    h = pushHistory(h, 2)
    h = pushHistory(h, 3)
    expect(h.present).toBe(3)
    expect(canUndo(h)).toBe(true)

    h = undo(h)
    expect(h.present).toBe(2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canUndo(h)).toBe(false)

    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(true)
  })

  it('clears the redo stack on a new push', () => {
    let h = initHistory(1)
    h = pushHistory(h, 2)
    h = undo(h) // present = 1, future = [2]
    h = pushHistory(h, 9) // diverge
    expect(h.present).toBe(9)
    expect(canRedo(h)).toBe(false)
  })

  it('replacePresent does not touch history', () => {
    let h = initHistory(1)
    h = pushHistory(h, 2)
    h = replacePresent(h, 5)
    expect(h.present).toBe(5)
    expect(h.past).toEqual([1])
    h = undo(h)
    expect(h.present).toBe(1)
  })
})
