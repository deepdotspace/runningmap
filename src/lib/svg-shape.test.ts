import { describe, expect, it } from 'vitest'
import { extractPathData, rawPointsToShape, splitSubpaths, stitchSubpaths } from './svg-shape'

describe('splitSubpaths', () => {
  it('splits a path into its moveto-delimited subpaths', () => {
    const subs = splitSubpaths('M0 0 L1 1 Z M2 2 L3 3 Z')
    expect(subs).toHaveLength(2)
    expect(subs[0].trim()).toBe('M0 0 L1 1 Z')
    expect(subs[1].trim()).toBe('M2 2 L3 3 Z')
  })

  it('handles relative movetos and a single subpath', () => {
    expect(splitSubpaths('m0 0 l1 1 z')).toHaveLength(1)
    expect(splitSubpaths('M0 0 C1 1 2 2 3 3')).toHaveLength(1)
  })

  it('returns empty for a path with no movetos', () => {
    expect(splitSubpaths('L1 1')).toEqual([])
  })
})

describe('extractPathData', () => {
  it('pulls every d="…" out of icon body markup', () => {
    const body = '<path fill="currentColor" d="M1 2L3 4"/><path d="M5 6Z"/>'
    expect(extractPathData(body)).toEqual(['M1 2L3 4', 'M5 6Z'])
  })

  it('returns empty when there are no paths', () => {
    expect(extractPathData('<circle cx="1" cy="2" r="3"/>')).toEqual([])
  })
})

describe('stitchSubpaths', () => {
  it('returns a single contour unchanged', () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(stitchSubpaths([loop])).toEqual(loop)
  })

  it('keeps every piece so the image is complete (no dropped subpaths)', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const b = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 11, y: 11 },
      { x: 10, y: 11 },
    ]
    const out = stitchSubpaths([a, b])
    // Both contours are present: every original point appears in the stroke.
    for (const p of [...a, ...b]) {
      expect(out.some((q) => q.x === p.x && q.y === p.y)).toBe(true)
    }
    // Each contour is closed back to its entry, so the stroke is longer than the
    // bare point count (one closing point per piece).
    expect(out.length).toBe(a.length + b.length + 2)
  })

  it('enters each later piece at the point nearest the running cursor', () => {
    const first = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]
    // Second square sits to the right; its nearest corner to `first` is (10,0).
    const second = [
      { x: 12, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 0 },
      { x: 12, y: 0 },
    ]
    const out = stitchSubpaths([first, second])
    // The bridge into the second piece should land on its nearest corner.
    const bridgeTarget = out[first.length + 1]
    expect(bridgeTarget).toEqual({ x: 10, y: 0 })
  })

  it('ignores degenerate pieces', () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(stitchSubpaths([[{ x: 5, y: 5 }], loop])).toEqual(loop)
  })
})

describe('rawPointsToShape', () => {
  it('flips y (SVG is y-down) and normalises into the unit box', () => {
    // A square in SVG coords (y grows downward).
    const shape = rawPointsToShape('Box', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    expect(shape).not.toBeNull()
    expect(shape!.name).toBe('box')
    expect(shape!.closed).toBe(true)
    for (const p of shape!.points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    }
    // The SVG-top point (y=0) should map to the unit-top (y≈1) after the flip.
    const topInSvg = shape!.points[0]
    expect(topInSvg.y).toBeCloseTo(1, 5)
  })

  it('rejects a degenerate sample', () => {
    expect(rawPointsToShape('x', [{ x: 0, y: 0 }])).toBeNull()
  })
})
