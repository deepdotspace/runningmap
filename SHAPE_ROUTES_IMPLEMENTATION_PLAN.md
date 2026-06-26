# Shape Routes — Implementation Plan (v1)

**Feature:** user types a word → a simple shape is produced → the shape is placed
near the map center → the existing snap-to-roads engine turns it into a runnable
route → the user edits any points they don't like.

This is the concrete build plan derived from `SHAPE_ROUTES_RESEARCH.md`. It reflects
the production-standard "connect-the-dots" approach (sample outline into ordered
waypoints, route between consecutive waypoints), which the existing
`ValhallaRoutingService` + `useRoute` snapping already implement.

## Division of labor (confirmed with the user)

- **Shape source** draws the shape (the points only — never touches roads).
- **Routing engine (Valhalla, already in `useRoute`)** snaps those points onto real
  streets automatically.
- **User** edits the points that came out wrong (drag/insert/delete already exist).

## Hard constraints for this build

- **Code changes only.** No `deepspace deploy`, no `deepspace dev`, no
  `deepspace test` (e2e needs login + would bill credits).
- **No credits of any kind.** The AI path bills the owner, so it is built
  **fallback-guarded** and is **not exercised** in this session. The deterministic
  library path makes the whole feature work and be unit-tested with **zero** network
  and **zero** credits.
- After coding, only **read-only / free** commands are run: `tsc --noEmit`,
  `eslint .`, `vitest run` (local, no login, no credits).

## Architecture (two shape sources, one pipeline)

```
word ──► [shape source] ──► NormalizedShape (unit [0,1] polyline)
                               │
            placeShape(center, sizeMeters, rotation)   ← pure geo math
                               ▼
                          LatLng[] waypoints
                               │
              shapeToRouteCore(points, unit, mode)     ← builds RouteCore (foot)
                               ▼
                        route.loadCore(core)
                               │
        existing useRoute snapping → Valhalla per gap  ← roads (already built)
                               ▼
                   editable, shareable, GPX-able route
```

**Two shape sources:**

1. **Deterministic library (primary, free, tested):** a curated set of simple
   single-stroke shapes in unit space + a word→shape matcher (synonyms + fuzzy).
   Always works, no network, no credits. This is the shippable core.
2. **AI generation (enhancement, gated, fallback-guarded):** for words the library
   doesn't cover, a signed-in user can press "Generate with AI ✨". It calls the
   existing **integration proxy** (`integration.post('openai/chat-completion', …)`,
   developer-billed) asking for a normalized point list, validates the output, and
   **falls back to the library / a friendly error on any failure.** Auth-gated per
   the integrations guidance (anonymous `integration.post` would bill the owner).
   *Code-complete but unverified in this session — exercising it needs credits.*

**No `worker.ts` change** (AI uses the existing `/api/integrations/*` proxy).
**No schema change. No nav change** (the feature lives inside the `/create` planner).

## Files

### New — pure libs (unit-tested, zero network)

- `src/lib/shapes.ts`
  - `interface NormalizedShape { name: string; points: { x: number; y: number }[]; closed: boolean }`
    (points in unit space, x/y ∈ [0,1]).
  - `SHAPE_LIBRARY` — ~12–16 simple shapes: heart, star, circle, square, triangle,
    diamond, cross, arrow, house, fish, dog, cat, flower, lightning, moon. Each a
    low-vertex (≤ ~24 pts) closed polyline so routing calls stay bounded.
  - `SHAPE_SYNONYMS` — e.g. `love→heart`, `puppy→dog`, `kitty→cat`.
  - `findShape(word): NormalizedShape | null` — normalize (lowercase/trim), exact key,
    synonym, then substring match; `null` when nothing matches.
  - `shapeNames(): string[]` — for the quick-pick chips.
- `src/lib/shape-geo.ts`
  - `placeShape(shape, center: LatLng, sizeMeters: number, rotationDeg: number): LatLng[]`
    — recenter unit points to [-0.5,0.5], rotate, scale so the longest side spans
    `sizeMeters`, project to LatLng via the local equirectangular approximation
    (`dLat = dyM/111320`, `dLng = dxM/(111320·cos lat)`; same constant `create.tsx`
    already uses). Repeats the first point at the end when `closed`.
- `src/lib/shape-route.ts`
  - `shapeToRouteCore(points: LatLng[], opts: { unit: Unit; mode: TravelMode }): RouteCore`
    — build a `RouteCore` (one `mode` per gap). Uses `genId` from `lib/types`.
  - `resampleWaypoints(points, maxN)` — cap waypoint count (default ~24) so a complex
    shape can't fan out into hundreds of Valhalla calls. (Documented, not silent.)

### New — service (AI, gated, fallback-guarded)

- `src/services/shapes.ts`
  - `generateShapeWithAI(word, signal?): Promise<NormalizedShape | null>` — one
    `integration.post('openai/chat-completion', …)` call. **The proxy returns an
    envelope `{ success, data?, error? }` — read `res.success`/`res.data`, not the
    value directly.** Then strict JSON parse + validate (array of {x,y} in [0,1],
    length 6–48, finite numbers); returns `null` on **any** error (envelope failure,
    bad JSON, validation) so the caller always degrades gracefully. No retries, no
    loops (cost safety). NOTE: this is the first client-side `integration.post` in the
    app (geocoding deliberately uses plain `fetch`) — it is not "mirroring" an existing
    call site; the SDK API itself is the contract.

### New — UI

- `src/components/planner/ShapePanel.tsx` — collapsible glass panel (mirrors
  `DiscoverPanel` structure + primitives from `../components/ui`):
  - word `<input>`; quick-pick shape chips (`shapeNames()`); size + rotation controls.
    **There is no `Slider` in `components/ui`** — use native `<input type="range">`
    (matches the raw-element style already used in `SearchBox`/`DiscoverPanel`);
    "Draw shape" button.
  - submit: `findShape(word)` → if hit, build + draw. If miss: signed-in users see
    "Generate with AI ✨" (loading/error/empty states); signed-out users are nudged to
    pick a chip or sign in. Estimated route-length hint shown before drawing.
  - props: `getCenter(): LatLng`, `onDraw(core: RouteCore): void`, `isSignedIn: boolean`.

### Edited

- `src/pages/create.tsx` — add `<ShapePanel>` to the existing top-center stack;
  `onDraw={(core) => { route.loadCore(core); setSelectedIndex(null);
  requestAnimationFrame(() => mapRef.current?.fitToRoute(core.points.map(p => ({ lat: p.lat, lng: p.lng })))) }}`.
  **Fit to the raw input `core.points`** — there is no `routeCoordsOf(core)` helper, and
  on a fresh `loadCore` no snapped geometry exists yet (`route.coords` would be empty
  until snapping resolves). Reuse `getCenter` already wired for
  `SearchBox`/`DiscoverPanel`. `isSignedIn` already in scope. (Drawing replaces the
  current route — confirm via the existing `ConfirmModal` if a route already exists, so
  we don't silently nuke the user's work.)
- `src/integrations.ts` — uncomment/add `openai: { billing: 'developer' }` so the AI
  endpoint is reachable (developer-billed, anonymous-capable → that's why the UI gates
  it behind `isSignedIn`). The deterministic library path needs no integration.

### New — tests (vitest, free, no login)

- `src/lib/shapes.test.ts` — matcher: exact, synonym, fuzzy, miss; every library shape
  is closed, non-empty, in-bounds, within the vertex cap.
- `src/lib/shape-geo.test.ts` — placed shape is centered on `center`; longest side ≈
  `sizeMeters` (haversine); rotation by 0/90/180 behaves; closed shapes repeat point 0.
- `src/lib/shape-route.test.ts` — `modes.length === points.length - 1`; mode applied;
  `resampleWaypoints` caps and preserves first/last.

## Quality / expectation-setting (from the research)

- Show the **estimated route length** before drawing (a 2 km shape ≈ a 10–15 km run).
- Drawing **replaces** the working route — guard with the existing confirm modal.
- AI surface is **auth-gated** (owner-billed) and **rate-naive but single-shot** (no
  loops/retries) so a click can't fan out into many billed calls.
- Every new surface has loading / error / empty states using existing UI primitives.

## Out of scope for v1 (documented, not built)

- Overpass street-graph optimizer (the "faithful" snap from the research) — deferred;
  v1 uses per-gap Valhalla, exactly like the shipping tools.
- Iterative AI loops, AI-chosen placement, letter/word-spelling glyphs.
- Saving shapes as a distinct collection (a drawn shape is just a normal route — it
  already saves/share/exports through the existing planner).

## Verification (read-only / free only)

1. `npx tsc --noEmit` — clean.
2. `npx eslint .` — clean.
3. `npx vitest run` — existing suite + new shape tests green, no network, no credits.

(No dev server, no e2e, no deploy, no integration calls — those need login/credits.)

## Then: two independent code reviews

After implementation + green read-only checks, two agents review the diff:
1. **Code quality / correctness / bugs.**
2. **Security** (esp. the `integration.post` AI path, input validation, owner-billing
   exposure, no secret/identity leakage).
