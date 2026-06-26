/**
 * Pure helpers for turning an SVG icon path into a runnable shape outline.
 *
 * An icon's `body` may contain several `<path>`s, and each `d` may contain
 * several subpaths (eyes, ears, holes). A running route is ONE continuous
 * stroke, so we keep only the single longest subpath (the silhouette) — the
 * length measurement + sampling happens in `services/icons.ts` because it needs
 * the browser's SVG geometry APIs. These functions are the testable pieces:
 * splitting subpaths and converting sampled points into a unit-space shape.
 */

import { normalizeToUnit, type NormalizedShape, type ShapePoint } from './shapes'

/**
 * Split a path `d` into its subpaths, each starting at a moveto (M/m). When a
 * subpath is taken in isolation a leading relative `m` is treated as absolute,
 * so its SHAPE and length are preserved — its absolute POSITION may shift, but
 * that's fine here because we re-centre via `normalizeToUnit` afterward.
 */
export function splitSubpaths(d: string): string[] {
  return d.match(/[Mm][^Mm]*/g) ?? []
}

/**
 * Extract every `d="…"` value from an icon's SVG `body` markup. (Icons drawn
 * purely with `<circle>`/`<rect>`/`<polygon>` yield none, so such icons trace
 * to null and the UI shows "couldn't trace" — a known, graceful gap.)
 */
export function extractPathData(body: string): string[] {
  return [...body.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1])
}

/** Append `loop` to `out`, rotated to begin at `startIdx` and closed back to it,
 * so the contour is drawn in full before the stroke moves on. */
function appendLoop(out: ShapePoint[], loop: ShapePoint[], startIdx: number): void {
  const n = loop.length
  for (let i = 0; i < n; i += 1) out.push(loop[(startIdx + i) % n])
  out.push(loop[startIdx])
}

/**
 * Stitch several sampled contours (each an ordered list of points along one
 * closed subpath) into ONE continuous stroke, so a running route can trace the
 * WHOLE icon instead of leaving disconnected pieces. This is what fixes icons
 * that came out with "holes": an icon made of several filled shapes (body, head,
 * ears…) previously kept only the largest piece, dropping the rest.
 *
 * Greedy nearest-neighbour: start with the first contour (callers pass the
 * largest first), then repeatedly attach the remaining contour whose closest
 * point is nearest the current cursor. Each contour is entered at that closest
 * point, traversed all the way round, and closed back to its entry, so every
 * piece is fully drawn; a straight bridge segment joins consecutive pieces. The
 * bridges are real route segments — unavoidable when an icon is several disjoint
 * shapes, and they keep the drawn image connected end-to-end.
 */
export function stitchSubpaths(subs: ShapePoint[][]): ShapePoint[] {
  const loops = subs.filter((s) => s.length >= 2)
  if (loops.length <= 1) return loops[0] ?? subs[0] ?? []

  const result: ShapePoint[] = []
  const remaining = loops.slice()
  appendLoop(result, remaining.shift()!, 0)
  let cursor = result[result.length - 1]

  while (remaining.length > 0) {
    let bestSub = 0
    let bestPt = 0
    let bestDist = Infinity
    for (let s = 0; s < remaining.length; s += 1) {
      const loop = remaining[s]
      for (let i = 0; i < loop.length; i += 1) {
        const dx = loop[i].x - cursor.x
        const dy = loop[i].y - cursor.y
        const d = dx * dx + dy * dy
        if (d < bestDist) {
          bestDist = d
          bestSub = s
          bestPt = i
        }
      }
    }
    const [loop] = remaining.splice(bestSub, 1)
    appendLoop(result, loop, bestPt)
    cursor = result[result.length - 1]
  }
  return result
}

/**
 * Convert sampled outline points (in SVG user units, y-down) into a normalized,
 * closed unit-space shape (y-up). Returns null for a degenerate sample.
 */
export function rawPointsToShape(name: string, raw: ShapePoint[]): NormalizedShape | null {
  if (raw.length < 3) return null
  // SVG y grows downward; flip so the icon is drawn upright (north-up).
  const flipped = raw.map((p) => ({ x: p.x, y: -p.y }))
  return { name: name.toLowerCase(), points: normalizeToUnit(flipped), closed: true }
}
