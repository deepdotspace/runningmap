/**
 * Shape library — simple, single-stroke outlines in unit space (x/y ∈ [0,1])
 * that a running route can trace.
 *
 * A shape is just an ordered list of points; turning it into a real route is
 * done downstream: `shape-geo.ts` places it on the map, `shape-route.ts` builds
 * a `RouteCore`, and the existing `useRoute` snapping engine connects the points
 * along real streets. The shape source NEVER touches roads.
 *
 * Quality note (see SHAPE_ROUTES_RESEARCH.md): shapes are deliberately
 * low-vertex so a drawn route stays a bounded number of snap calls, and
 * recognisability is best-effort — the street network distorts the shape when
 * snapped, exactly like every shipping GPS-art tool.
 *
 * Convention: unit space has y pointing UP (north), x pointing right (east),
 * origin at the bottom-left. `toUnit` re-centres + uniformly scales every shape
 * so its longest side spans 1.0 (aspect ratio preserved, all points in [0,1]).
 */

export interface ShapePoint {
  x: number
  y: number
}

export interface NormalizedShape {
  /** Lowercase display + match key. */
  name: string
  /** Ordered outline points in unit space (x/y ∈ [0,1]). Not auto-closed. */
  points: ShapePoint[]
  /** When true, the route loops back to the first point. */
  closed: boolean
}

/** Sample a parametric curve at `n` evenly-spaced steps over t ∈ [0,1). */
function sample(n: number, fn: (t: number) => ShapePoint): ShapePoint[] {
  const pts: ShapePoint[] = []
  for (let i = 0; i < n; i += 1) pts.push(fn(i / n))
  return pts
}

/**
 * Re-centre + uniformly scale points so the longest side spans 1.0, centred on
 * (0.5, 0.5). Preserves aspect ratio and keeps every point within [0,1]. Shared
 * by the curated library and the icon-import path (`lib/svg-shape.ts`).
 */
export function normalizeToUnit(points: ShapePoint[]): ShapePoint[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const ox = (minX + maxX) / 2
  const oy = (minY + maxY) / 2
  // Clamp to absorb floating-point epsilon at the box edges (e.g. -1e-16).
  const unit = (n: number): number => Math.min(1, Math.max(0, n))
  return points.map((p) => ({ x: unit(0.5 + (p.x - ox) / span), y: unit(0.5 + (p.y - oy) / span) }))
}

const TWO_PI = Math.PI * 2

// --- Computed (smooth) shapes -------------------------------------------------

const circle = sample(24, (t) => ({
  x: 0.5 + 0.5 * Math.cos(TWO_PI * t),
  y: 0.5 + 0.5 * Math.sin(TWO_PI * t),
}))

// Classic parametric heart, sampled then normalised. y is negated so the lobes
// sit at the top (north) in our y-up convention.
const heart = sample(24, (t) => {
  const a = TWO_PI * t
  const hx = 16 * Math.sin(a) ** 3
  const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)
  return { x: hx, y: hy }
})

// Five-pointed star, top point facing north.
const star = (() => {
  const pts: ShapePoint[] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.5 : 0.2
    const a = Math.PI / 2 + (Math.PI * i) / 5
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) })
  }
  return pts
})()

// Rose-ish flower: a wavy circle with five lobes.
const flower = sample(24, (t) => {
  const a = TWO_PI * t
  const r = 0.32 + 0.18 * Math.cos(5 * a)
  return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) }
})

// Crescent moon: an outer C-arc closed by an inner arc.
const moon = (() => {
  const pts: ShapePoint[] = []
  const outerSteps = 14
  for (let i = 0; i <= outerSteps; i += 1) {
    const deg = 60 + (300 - 60) * (i / outerSteps)
    const a = (deg * Math.PI) / 180
    pts.push({ x: 0.5 + 0.45 * Math.cos(a), y: 0.5 + 0.45 * Math.sin(a) })
  }
  const innerSteps = 9
  for (let i = 0; i <= innerSteps; i += 1) {
    const deg = 300 - (300 - 60) * (i / innerSteps)
    const a = (deg * Math.PI) / 180
    pts.push({ x: 0.62 + 0.3 * Math.cos(a), y: 0.5 + 0.3 * Math.sin(a) })
  }
  return pts
})()

// --- Polygonal (literal) shapes ----------------------------------------------

const square: ShapePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

const triangle: ShapePoint[] = [
  { x: 0.5, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
]

const diamond: ShapePoint[] = [
  { x: 0.5, y: 1 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 0 },
  { x: 0, y: 0.5 },
]

const cross: ShapePoint[] = [
  { x: 0.34, y: 0 },
  { x: 0.66, y: 0 },
  { x: 0.66, y: 0.34 },
  { x: 1, y: 0.34 },
  { x: 1, y: 0.66 },
  { x: 0.66, y: 0.66 },
  { x: 0.66, y: 1 },
  { x: 0.34, y: 1 },
  { x: 0.34, y: 0.66 },
  { x: 0, y: 0.66 },
  { x: 0, y: 0.34 },
  { x: 0.34, y: 0.34 },
]

const arrow: ShapePoint[] = [
  { x: 0, y: 0.32 },
  { x: 0.6, y: 0.32 },
  { x: 0.6, y: 0.1 },
  { x: 1, y: 0.5 },
  { x: 0.6, y: 0.9 },
  { x: 0.6, y: 0.68 },
  { x: 0, y: 0.68 },
]

const house: ShapePoint[] = [
  { x: 0.15, y: 0 },
  { x: 0.85, y: 0 },
  { x: 0.85, y: 0.55 },
  { x: 0.5, y: 1 },
  { x: 0.15, y: 0.55 },
]

const lightning: ShapePoint[] = [
  { x: 0.6, y: 1 },
  { x: 0.25, y: 0.5 },
  { x: 0.45, y: 0.5 },
  { x: 0.32, y: 0 },
  { x: 0.78, y: 0.58 },
  { x: 0.52, y: 0.58 },
]

const fish: ShapePoint[] = [
  { x: 0.05, y: 0.5 },
  { x: 0.4, y: 0.85 },
  { x: 0.7, y: 0.7 },
  { x: 1, y: 0.95 },
  { x: 1, y: 0.05 },
  { x: 0.7, y: 0.3 },
  { x: 0.4, y: 0.15 },
]

// Rough side-view dog silhouette (facing left). Best-effort, not anatomically
// precise — the street snap will distort it further regardless.
const dog: ShapePoint[] = [
  { x: 0.05, y: 0.58 },
  { x: 0.18, y: 0.6 },
  { x: 0.2, y: 0.78 },
  { x: 0.28, y: 0.8 },
  { x: 0.32, y: 0.62 },
  { x: 0.5, y: 0.66 },
  { x: 0.72, y: 0.66 },
  { x: 0.8, y: 0.82 },
  { x: 0.87, y: 0.78 },
  { x: 0.8, y: 0.6 },
  { x: 0.82, y: 0.2 },
  { x: 0.7, y: 0.2 },
  { x: 0.68, y: 0.46 },
  { x: 0.4, y: 0.46 },
  { x: 0.38, y: 0.2 },
  { x: 0.26, y: 0.2 },
  { x: 0.24, y: 0.5 },
  { x: 0.12, y: 0.5 },
]

// Cat face with two ears.
const cat: ShapePoint[] = [
  { x: 0.25, y: 0.78 },
  { x: 0.18, y: 1 },
  { x: 0.4, y: 0.82 },
  { x: 0.6, y: 0.82 },
  { x: 0.82, y: 1 },
  { x: 0.75, y: 0.78 },
  { x: 0.92, y: 0.5 },
  { x: 0.82, y: 0.18 },
  { x: 0.5, y: 0.05 },
  { x: 0.18, y: 0.18 },
  { x: 0.08, y: 0.5 },
]

function shape(name: string, points: ShapePoint[], closed = true): NormalizedShape {
  return { name, points: normalizeToUnit(points), closed }
}

/** The curated shape library, keyed by lowercase name. */
export const SHAPE_LIBRARY: Record<string, NormalizedShape> = {
  heart: shape('heart', heart),
  star: shape('star', star),
  circle: shape('circle', circle),
  square: shape('square', square),
  triangle: shape('triangle', triangle),
  diamond: shape('diamond', diamond),
  cross: shape('cross', cross),
  arrow: shape('arrow', arrow),
  house: shape('house', house),
  fish: shape('fish', fish),
  dog: shape('dog', dog),
  cat: shape('cat', cat),
  flower: shape('flower', flower),
  lightning: shape('lightning', lightning),
  moon: shape('moon', moon),
}

/** Common words → a library shape key. */
export const SHAPE_SYNONYMS: Record<string, string> = {
  love: 'heart',
  valentine: 'heart',
  puppy: 'dog',
  kitty: 'cat',
  kitten: 'cat',
  feline: 'cat',
  ring: 'circle',
  round: 'circle',
  circ: 'circle',
  box: 'square',
  rectangle: 'square',
  rhombus: 'diamond',
  gem: 'diamond',
  plus: 'cross',
  add: 'cross',
  home: 'house',
  bolt: 'lightning',
  thunder: 'lightning',
  flash: 'lightning',
  petal: 'flower',
  rose: 'flower',
  bloom: 'flower',
  crescent: 'moon',
  lune: 'moon',
}

/** All library shape names (for quick-pick chips). */
export function shapeNames(): string[] {
  return Object.keys(SHAPE_LIBRARY)
}

/**
 * Resolve a free-text word to a library shape, or `null` if nothing matches.
 * Tries: exact key → synonym → a whole-word token in the phrase. Matching is on
 * word boundaries (not substrings) so "category" doesn't match "cat" and
 * "across" doesn't match "cross" — those fall through to the AI path instead.
 */
export function findShape(word: string): NormalizedShape | null {
  const w = word.trim().toLowerCase()
  if (!w) return null
  if (SHAPE_LIBRARY[w]) return SHAPE_LIBRARY[w]
  const syn = SHAPE_SYNONYMS[w]
  if (syn && SHAPE_LIBRARY[syn]) return SHAPE_LIBRARY[syn]
  // Whole-word tokens of a phrase ("draw me a house" → "house").
  for (const token of w.split(/[^a-z]+/).filter(Boolean)) {
    if (SHAPE_LIBRARY[token]) return SHAPE_LIBRARY[token]
    const target = SHAPE_SYNONYMS[token]
    if (target && SHAPE_LIBRARY[target]) return SHAPE_LIBRARY[target]
  }
  return null
}
