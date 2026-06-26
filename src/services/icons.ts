/**
 * Icon search → shape outline, via the free public Iconify API (no key, no
 * DeepSpace credits). This replaces asking an LLM to invent coordinates — which
 * is unreliable for anything beyond simple primitives — with picking a real,
 * professionally-drawn vector and tracing its silhouette.
 *
 *   searchIcons('dog')      → a list of matching icons (with thumbnail URLs)
 *   fetchIconShape('mdi:dog') → the icon's largest outline as a NormalizedShape
 *
 * Tracing uses the browser's SVG geometry APIs (getTotalLength /
 * getPointAtLength), so it runs client-side only; the pure parsing/normalising
 * lives in lib/svg-shape.ts and is unit-tested.
 */

import type { NormalizedShape, ShapePoint } from '../lib/shapes'
import { extractPathData, rawPointsToShape, splitSubpaths, stitchSubpaths } from '../lib/svg-shape'

const BASE = 'https://api.iconify.design'
const SVG_NS = 'http://www.w3.org/2000/svg'
/** Dark glyph colour — thumbnails render on a fixed WHITE tile (see ShapePanel)
 * so a monochrome icon is always visible regardless of the app theme. */
const THUMB_COLOR = '%231f2937'

export interface IconResult {
  /** Full Iconify id, e.g. "mdi:dog". */
  id: string
  prefix: string
  name: string
  /** Ready-to-use <img> source for a thumbnail. */
  svgUrl: string
}

function splitId(full: string): { prefix: string; name: string } | null {
  const idx = full.indexOf(':')
  if (idx <= 0) return null
  const prefix = full.slice(0, idx)
  const name = full.slice(idx + 1)
  return prefix && name ? { prefix, name } : null
}

// A running route is ONE closed stroke, so SOLID/filled silhouettes trace well
// and outline/line/duotone/emoji icons don't (they're multiple disjoint strokes,
// leaving only a fragment). We rank results to surface the traceable ones.
const SOLID_HINTS = ['solid', 'fill', 'filled', 'bold', 'glyph']
const LINE_HINTS = ['outline', 'line', 'thin', 'light', 'linear', 'broken', 'duotone', 'twotone']
// Icon sets whose default (suffix-less) icon is a solid silhouette.
const SOLID_PREFIXES = new Set(['mdi', 'bxs', 'fa6-solid', 'fa7-solid', 'ic', 'iconoir-solid'])
// Icon sets that are line/stroke by default (suffix-less names carry no "line"
// hint), so they'd otherwise score neutral and crowd out true solids.
const LINE_PREFIXES = new Set([
  'tabler', 'lucide', 'iconoir', 'feather', 'akar-icons', 'majesticons', 'radix-icons', 'ci',
])
// Multicolor/emoji sets: pretty thumbnails but they trace into noise — drop them.
const EMOJI_PREFIXES = new Set([
  'twemoji', 'noto', 'noto-v1', 'openmoji', 'fxemoji', 'emojione', 'emojione-v1',
  'fluent-emoji', 'fluent-emoji-flat', 'fluent-emoji-high-contrast', 'streamline-emojis',
])

function iconScore(prefix: string, name: string): number {
  const n = name.toLowerCase()
  let score = 0
  if (LINE_HINTS.some((h) => n.includes(h))) score -= 4
  if (SOLID_HINTS.some((h) => n.includes(h))) score += 4
  if (SOLID_PREFIXES.has(prefix)) score += 2
  if (LINE_PREFIXES.has(prefix)) score -= 2
  return score
}

/**
 * Filter + rank raw Iconify ids so traceable solid silhouettes come first.
 * Pure (no network/DOM) so it's unit-tested. Drops emoji/colored sets entirely.
 */
export function rankIcons(ids: string[], limit = 24): IconResult[] {
  const scored: Array<IconResult & { score: number }> = []
  for (const full of ids) {
    const parts = splitId(full)
    if (!parts || EMOJI_PREFIXES.has(parts.prefix)) continue
    scored.push({
      id: full,
      prefix: parts.prefix,
      name: parts.name,
      svgUrl: `${BASE}/${parts.prefix}/${parts.name}.svg?height=48&color=${THUMB_COLOR}`,
      score: iconScore(parts.prefix, parts.name),
    })
  }
  // Stable sort by score (Array.prototype.sort is stable in modern engines).
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ score: _score, ...rest }) => rest)
}

/** Search Iconify for icons matching `query`. Throws on network/HTTP failure. */
export async function searchIcons(
  query: string,
  signal?: AbortSignal,
  limit = 24,
): Promise<IconResult[]> {
  const q = query.trim()
  if (!q) return []
  // Over-fetch and exclude colored sets at the source (palette=false), then rank
  // locally for traceability before trimming to `limit`.
  const res = await fetch(
    `${BASE}/search?query=${encodeURIComponent(q)}&palette=false&limit=96`,
    { signal },
  )
  if (!res.ok) throw new Error(`Iconify search ${res.status}`)
  const data = (await res.json()) as { icons?: unknown }
  const icons = Array.isArray(data.icons) ? (data.icons as string[]) : []
  return rankIcons(icons, limit)
}

// --- Browser-only SVG path geometry ------------------------------------------

/** A hidden, reused <svg> so path elements can be measured (some engines need
 * the element attached to the document for getTotalLength to be non-zero). */
let scratch: SVGSVGElement | null = null
function scratchSvg(): SVGSVGElement | null {
  if (typeof document === 'undefined') return null
  if (scratch && scratch.isConnected) return scratch
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  svg.style.left = '-99999px'
  svg.style.overflow = 'hidden'
  svg.setAttribute('aria-hidden', 'true')
  document.body.appendChild(svg)
  scratch = svg
  return svg
}

/** Run `fn` with a temporary path element for `d`, then clean it up. */
function withPath<T>(d: string, fn: (p: SVGPathElement) => T, fallback: T): T {
  const svg = scratchSvg()
  if (!svg) return fallback
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  try {
    return fn(path)
  } catch {
    return fallback
  } finally {
    path.remove()
  }
}

interface SizedSubpath {
  d: string
  /** Bounding-box AREA — ranks the silhouette body above thin detail strokes. */
  size: number
  /** Total path length — used to share the sample budget across pieces. */
  length: number
}

/** Measure a subpath's bounding-box area and length in one pass. Area falls back
 * to length only when getBBox is unavailable (normally it is, when attached). */
function subpathMetrics(d: string): { size: number; length: number } {
  return withPath(
    d,
    (p) => {
      const len = p.getTotalLength()
      const length = Number.isFinite(len) ? len : 0
      let size = length
      try {
        const b = p.getBBox()
        const area = b.width * b.height
        if (area > 0) size = area
      } catch {
        /* getBBox unsupported — fall back to length */
      }
      return { size, length }
    },
    { size: 0, length: 0 },
  )
}

// A multi-part icon (body + head + ears…) should trace COMPLETE, not just its
// biggest blob — that was the "holes" bug. So we keep the main silhouette plus
// every other piece that is a meaningful fraction of it, drop tiny noise (eyes,
// dots), and cap the count so a busy icon can't fan out into too many segments.
const SIGNIFICANT_FRACTION = 0.06
const MAX_PIECES = 6
const MIN_PIECE_SAMPLES = 10

/** Collect the icon's significant subpaths, largest first. Each is sampled and
 * the pieces are later stitched into one connected stroke. */
function selectSubpaths(ds: string[]): SizedSubpath[] {
  const subs: SizedSubpath[] = []
  for (const d of ds) {
    for (const sub of splitSubpaths(d)) {
      const { size, length } = subpathMetrics(sub)
      if (length > 0 && size > 0) subs.push({ d: sub, size, length })
    }
  }
  if (subs.length === 0) return []
  subs.sort((a, b) => b.size - a.size)
  const cutoff = subs[0].size * SIGNIFICANT_FRACTION
  return subs.filter((s) => s.size >= cutoff).slice(0, MAX_PIECES)
}

/** Sample `n` points evenly along `d` (SVG user units). */
function samplePath(d: string, n: number): ShapePoint[] | null {
  return withPath(
    d,
    (p) => {
      const len = p.getTotalLength()
      if (!len || !Number.isFinite(len)) return null
      const pts: ShapePoint[] = []
      for (let i = 0; i < n; i += 1) {
        const pt = p.getPointAtLength((len * i) / n)
        pts.push({ x: pt.x, y: pt.y })
      }
      return pts
    },
    null,
  )
}

/**
 * Fetch an icon by id and trace its largest outline into a closed shape.
 * Returns null on any failure (network, no path, no DOM geometry) so the caller
 * can show a friendly message. `samples` controls outline smoothness.
 */
export async function fetchIconShape(
  full: string,
  signal?: AbortSignal,
  samples = 64,
): Promise<NormalizedShape | null> {
  const parts = splitId(full)
  if (!parts) return null
  try {
    const res = await fetch(
      `${BASE}/${parts.prefix}.json?icons=${encodeURIComponent(parts.name)}`,
      { signal },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { icons?: Record<string, { body?: string }> }
    const body = data.icons?.[parts.name]?.body
    if (!body) return null

    const ds = extractPathData(body)
    if (ds.length === 0) return null
    const pieces = selectSubpaths(ds)
    if (pieces.length === 0) return null

    // Share the sample budget across pieces by length, so a small-but-meaningful
    // piece still gets enough points to read, then stitch them into one stroke.
    const totalLen = pieces.reduce((sum, p) => sum + p.length, 0) || 1
    const contours: ShapePoint[][] = []
    for (const piece of pieces) {
      const n = Math.max(MIN_PIECE_SAMPLES, Math.round((samples * piece.length) / totalLen))
      const pts = samplePath(piece.d, n)
      if (pts) contours.push(pts)
    }
    if (contours.length === 0) return null
    return rawPointsToShape(parts.name, stitchSubpaths(contours))
  } catch {
    return null
  }
}
