# Plan — Remove shape "Follow roads" toggle + Add "Plan a route" (auto-loop by distance)

Two independent changes. **Code changes only**; the only commands run are local/free
(`npx tsc --noEmit`, `npx eslint .`, `npx vitest run`). No dev server, no deploy, no
network, no DeepSpace credits.

---

## Change A — Remove the "Follow roads / Exact shape" toggle from the shape panel

**Why:** road-snapping distorts a traced silhouette badly (the user can see how different
street layouts mangle it). Shapes should always render as the **exact outline** (manual,
straight segments) so a dog looks like a dog. Snapping a *shape* to roads is being dropped;
snapping is still the default for the new route planner and for hand-drawn routes (the
main planner's per-segment mode controls are untouched).

### Files & edits

- **`src/components/planner/ShapePanel.tsx`**
  - Delete the `followRoads` state (`const [followRoads, setFollowRoads] = useState(true)`).
  - Delete the entire "Route style" toggle block (the `Follow roads` / `Exact shape`
    buttons + the explanatory `<p>`), currently ~lines 246–282 (`data-testid="shape-follow"`
    and `data-testid="shape-exact"`).
  - Delete the `FOLLOW_WAYPOINTS` constant. Keep `EXACT_WAYPOINTS = 80`.
  - In `draw()`, hard-code the exact path: `mode: 'manual'`, `maxWaypoints: EXACT_WAYPOINTS`.
    Remove the `followRoads` ternaries.
    - **Consequence (intended, document it):** `mode: 'manual'` makes `shapeToRouteCore`
      fill `modes` with `'manual'`, and `useRoute` skips manual gaps
      (`if (mode === 'manual') continue`), so a drawn shape fires **zero** snap calls.
      That is the whole point (exact outline, no road distortion) — nobody should later
      "fix" it back to `foot`.
  - `pickIcon` already traces at `EXACT_WAYPOINTS` — unchanged.
  - Update the file header doc comment: "Two output modes …" → state shapes always trace
    the **exact outline**; remove the "then switch to Follow roads" guidance.
- **`src/components/planner/ShapePanel.tsx` — `ShapeDrawMeta`**
  - Remove the `followRoads: boolean` field. (It exists only to drive the post-draw toast.)
- **`src/pages/create.tsx` — `applyShape` + surrounding comments**
  - Remove the `meta.followRoads` branch; the toast style line is always `exact outline`.
    e.g. ``success(`Drew "${meta.word}"`, `${how} · exact outline`)``.
  - **Also fix the stale comments at create.tsx:124–128** — the `applyShape` doc comment
    says "(in follow mode) snaps it" and "snapped vs exact"; rewrite so it reflects that
    shapes are always the exact outline. (Don't just change the toast line.)
  - No other call sites construct `ShapeDrawMeta` (verified: only ShapePanel + create.tsx
    reference `followRoads`).

### Notes / non-goals
- The map's per-segment mode control (`SelectedPointPanel`) still lets a user snap
  individual legs later if they ever want to — we are not removing route-level snapping,
  only the shape panel's shortcut. This is intentional and matches the request.
- No test references `shape-follow` / `shape-exact` (grep clean), so no test churn here.

---

## Change B — "Plan a route": auto-generate a loop (or out-and-back) of a target distance

**What the user gets:** open a "Plan a route" panel, pick a **target distance** and a
**type** (Loop / Out-and-back), press **Generate** → the app seeds waypoints near the map
centre sized to the target, builds a **road-snapped** route (this is a real run, so it
SHOULD follow streets), fits it in view, and lets the user edit/shuffle. The bottom bar's
distance readout shows the actual snapped length.

### Approach (deterministic, free, reuses the existing engine)

This mirrors the shape pipeline: generate seed waypoints → `shapeToRouteCore` (mode `foot`)
→ existing `useRoute` snapping resolves each leg on real streets. No new network code, no
credits. Generation is **pure geometry** (testable, no DOM/network).

Snapping inflates length (roads are longer than a smooth straight chord), so the geometric
seed is sized a bit **shorter** than the target via an empirical `ROAD_FACTOR`. The result
is *approximate by design* — the panel shows the target, the bottom bar shows the actual,
and the user can adjust the distance or **Shuffle** (re-seed a new direction). This matches
the app's established "seed it, then the user edits" philosophy and avoids multi-call
refinement loops (which would add latency + hammer the public router).

### New file — `src/lib/route-plan.ts` (pure, unit-tested)

```ts
export type PlanType = 'loop' | 'out-and-back'

/** Geometric seed is sized SHORTER than target; road-snapping inflates it back up.
 *  Empirical, documented as approximate. */
export const ROAD_FACTOR = 0.85

export interface PlanOptions {
  type: PlanType
  /** Compass bearing of the loop's far side / out-leg, for variety. Default 0 (north). */
  bearingDeg?: number
  /** Loop vertex count (more = rounder seed → snaps closer to a circle). Default 10. */
  points?: number
}

/** Ordered seed waypoints for a planned route, starting (and for a loop, ending) at `start`. */
export function generatePlanWaypoints(
  start: LatLng,
  targetMeters: number,
  opts: PlanOptions,
): LatLng[]
```

- **Loop:** radius `r = (targetMeters * ROAD_FACTOR) / (2π)`. Place the loop's **centre** at
  `destination(start, bearingDeg, r)`. ⚠️ **Phase offset (reviewer-flagged bug):** with the
  centre `r` away along `bearingDeg`, `start` lies on the ring at angle **`bearingDeg + 180`**
  from the centre — NOT at angle 0. So emit vertices at `angle_i = (bearingDeg + 180) +
  360·i/points` for `i = 0..points`, i.e. the traversal **must start at `bearingDeg + 180`**.
  The first vertex (`i = 0`) is the start point; append a closing copy of that **same computed
  value** as the last vertex (`i = points`) so `shapeToRouteCore`'s dedupe sees an exact
  `lat/lng` match and the loop closes cleanly (reuse the identical object/number — a second
  `destination()` call could differ by a float epsilon and leave a hairline gap). Reuse
  `destination` from `lib/geo.ts` (`circleRing` at geo.ts:81 is a good angle-convention
  reference).
- **Out-and-back:** `dest = destination(start, bearingDeg, (targetMeters/2) * ROAD_FACTOR)`,
  with a couple of evenly-spaced intermediate anchors along the bearing so snapping has
  something to follow. Return the out-leg `[start, …anchors…, dest]` **then its reverse**
  back to `start` (the route genuinely retraces — that's what an out-and-back is).
  `shapeToRouteCore` dedupes the consecutive duplicate at the turnaround. ⚠️ Keep the total
  seed length **well under `maxWaypoints`** (few anchors): `resampleWaypoints` downsamples
  evenly **by index before dedupe**, and on a palindrome that can drop the `dest` turnaround
  vertex and silently shorten the route. The test must assert the farthest point survives at
  the chosen `maxWaypoints`.
- Guards: `targetMeters <= 0` → return `[]`; clamp `points` to a sane min (≥ 6).

### New file — `src/components/planner/RoutePlannerPanel.tsx`

Collapsible glass panel matching `ShapePanel` / `DiscoverPanel` (reuse the same primitives
and the native `<input type="range">` style — there is no `Slider` in `components/ui`).

- Controls: **distance** (range + readout in the current `unit`, e.g. 1–30 km, default 5 km),
  **type** segmented buttons (Loop / Out-and-back), **Generate** button, and a small
  **Shuffle direction** control (re-randomises the bearing for a different street pattern).
- On Generate: `bearing = Math.random() * 360` (plain app code — `Math.random` is fine here,
  it's only banned inside Workflow scripts), `points = generatePlanWaypoints(getCenter(),
  targetMeters, { type, bearingDeg: bearing })`, then
  `shapeToRouteCore(points, { unit, mode: 'foot', maxWaypoints: 24 })`. Hand the core to the
  planner via `onGenerate(core, meta)`.
- Estimated hint before generating: e.g. "~5.0 km loop near the map centre — snapped to
  roads, then drag any point to refine."
- Props: `getCenter(): LatLng`, `onGenerate(core: RouteCore, meta: PlanMeta): void`, `unit: Unit`.
- States: idle only (generation is synchronous + local). No loading/error/empty network
  states needed because nothing is fetched here (snapping happens downstream in `useRoute`).

### Edit — `src/pages/create.tsx`

- Render `<RoutePlannerPanel getCenter={…} onGenerate={…} unit={…} />` in the existing
  **top-left tool stack** alongside `DiscoverPanel` and `ShapePanel`.
- **Reuse the existing replace-confirm + commit + fit + toast flow** via a **sibling
  `handlePlanGenerate` + `pendingPlan` state** (reviewer-preferred — lower blast radius than
  re-typing the shared `pendingShape`/`ShapeDrawMeta` state):
  - Add a `pendingPlan` state and a `handlePlanGenerate(core, meta)` that, when a route
    already exists, opens the **same `ConfirmModal`** (generic "Replace current route?" copy),
    and otherwise commits immediately.
  - The apply step reuses the **same body** as `applyShape`: `commitCore(core)` +
    `setSelectedIndex(null)` + `requestAnimationFrame(() => fitToRoute(core.points…))`, then a
    plan-specific success toast. The duplication is ~6 lines and avoids changing the typed
    shared shape state — do NOT generalise `applyShape`/`pendingShape`.
- Post-generate toast (success): e.g. `Planned a 5.0 km loop` / `Snapped to roads · edit any point`.

### New file — `src/lib/route-plan.test.ts` (vitest, free)

- **Loop:** first waypoint ≈ last waypoint (closed) and ≈ `start`; waypoint count ==
  `points`+1 (closing copy); all coordinates finite; two different `bearingDeg` values produce
  rotated loops that still start at `start`.
  - ⚠️ **Perimeter assertion math (reviewer-flagged):** a `points`-gon inscribed in radius `r`
    has perimeter `2·points·r·sin(π/points)`, which is **less** than `2πr` (chord deficit:
    ~98.4% at `points=10`, ~95.5% at `points=6`). So do **not** assert the seed perimeter
    equals `targetMeters·ROAD_FACTOR`. Either assert against the exact polygon formula
    `2·points·r·sin(π/points)`, or assert "within tolerance of `targetMeters·ROAD_FACTOR`"
    with a realistic tolerance (≥3% at `points=10`).
- **Out-and-back:** the farthest point is ≈ `targetMeters/2 * ROAD_FACTOR` from `start`
  (haversine); the path returns to `start`; the back half mirrors the out half.
- **Edge cases:** `targetMeters = 0` → `[]`; very small and very large targets stay finite
  and in-bounds; `points` below the floor is clamped.

### Optional stretch (NOT required for v1 — call out for the reviewer to weigh in)
A single auto-correction pass: after the first snap resolves, if
`|actual − target| / target > 0.20`, rescale the radius by `target/actual` and regenerate
once. More accurate but needs async coordination with `useRoute` snapping state and risks a
second burst of snap calls. **Default: omit for v1**; ship the one-shot seed + Shuffle +
live actual-distance readout.

---

## Verification (local / free only)

1. `npx tsc --noEmit` — clean.
2. `npx eslint .` — clean.
3. `npx vitest run` — existing suite + new `route-plan` tests green; no network, no credits.

(No `deepspace dev`, no `deepspace deploy`, no e2e — those need login/credits.)

## Out of scope for v1
- Hitting the target distance exactly (we seed-and-show-actual; user adjusts).
- Difficulty/elevation-aware generation, avoiding busy roads, surface preference.
- Saving "planned" routes as a distinct type — a generated route is a normal route and
  already saves / shares / exports through the existing planner.
