import { describe, expect, it } from 'vitest'
import { SHAPE_LIBRARY, SHAPE_SYNONYMS, findShape, shapeNames } from './shapes'

describe('shape library', () => {
  it('exposes every library shape by name', () => {
    const names = shapeNames()
    expect(names.length).toBeGreaterThanOrEqual(10)
    expect(names).toEqual(Object.keys(SHAPE_LIBRARY))
  })

  it('every shape is a non-trivial, in-bounds, low-vertex outline', () => {
    for (const [name, shape] of Object.entries(SHAPE_LIBRARY)) {
      expect(shape.name, name).toBe(name)
      expect(shape.points.length, name).toBeGreaterThanOrEqual(3)
      expect(shape.points.length, name).toBeLessThanOrEqual(48)
      for (const p of shape.points) {
        expect(p.x, name).toBeGreaterThanOrEqual(0)
        expect(p.x, name).toBeLessThanOrEqual(1)
        expect(p.y, name).toBeGreaterThanOrEqual(0)
        expect(p.y, name).toBeLessThanOrEqual(1)
      }
    }
  })

  it('normalises each shape to fill the unit box on its longest side', () => {
    for (const [name, shape] of Object.entries(SHAPE_LIBRARY)) {
      const xs = shape.points.map((p) => p.x)
      const ys = shape.points.map((p) => p.y)
      const spanX = Math.max(...xs) - Math.min(...xs)
      const spanY = Math.max(...ys) - Math.min(...ys)
      // toUnit scales the longest side to exactly 1.
      expect(Math.max(spanX, spanY), name).toBeCloseTo(1, 5)
    }
  })
})

describe('findShape', () => {
  it('matches an exact library name', () => {
    expect(findShape('heart')).toBe(SHAPE_LIBRARY.heart)
    expect(findShape('  STAR ')).toBe(SHAPE_LIBRARY.star)
  })

  it('resolves synonyms', () => {
    expect(findShape('love')).toBe(SHAPE_LIBRARY.heart)
    expect(findShape('puppy')).toBe(SHAPE_LIBRARY.dog)
    for (const [word, target] of Object.entries(SHAPE_SYNONYMS)) {
      expect(findShape(word), word).toBe(SHAPE_LIBRARY[target])
    }
  })

  it('matches a shape name embedded in a phrase', () => {
    expect(findShape('a big star please')).toBe(SHAPE_LIBRARY.star)
    expect(findShape('draw me a house')).toBe(SHAPE_LIBRARY.house)
  })

  it('returns null for an unknown word or empty input', () => {
    expect(findShape('asdfqwerty')).toBeNull()
    expect(findShape('')).toBeNull()
    expect(findShape('   ')).toBeNull()
  })

  it('matches on word boundaries, not substrings', () => {
    // These contain a shape name as a substring but are different words — they
    // must fall through (to the AI path) rather than silently matching.
    expect(findShape('category')).toBeNull()
    expect(findShape('across')).toBeNull()
    expect(findShape('starling')).toBeNull()
  })
})
