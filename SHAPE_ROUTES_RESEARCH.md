# Shape Routes ("GPS art") — Feasibility Research

**Status: research only. No code has been written.** This documents whether the
"type a word → get a runnable, shape-like route on real streets near me" feature
is possible with runningmap's current stack, and the recommended path if we build it.

## The idea (as confirmed with the user)

- User types a **word** (e.g. "dog").
- An **AI agent** makes a *simple* shape for that word (one-shot — one attempt per word).
- The shape becomes a **true GPS-art route**: it follows **real streets** near the
  user *and* still resembles the shape ("true GPS art", not just a decorative overlay).

## Verdict

**Achievable as a best-effort approximation — not as a guarantee.** The shape→road
route is a known, solved-enough problem (peer-reviewed algorithm + several live tools,
see References). The **word→shape via AI** step is the novel part and is the *easy*
part for us (the AI SDK is already wired in). The hard, unavoidable truth:

> **Fidelity is bounded by local street topology.** A shape traces well where streets
> are dense and irregular; in a strict grid or a cul-de-sac suburb it degrades. No
> algorithm beats "the streets aren't shaped like a dog."

This is *why* every existing tool (Motera, RouteDoodle, Draw My Loop) ships the same
three things: expectation-management copy, a fidelity/preview step, and manual
adjust / relocate. We must do the same — market it as **best-effort art**, with a
"try a different location / rotation" control, not "a perfect dog-shaped run."

## How it works (algorithm) and how it maps to our stack

The academic approach: stream OSM street data for the area → build a bidirectional
street-network graph → single-source/multi-target shortest-path search (Dijkstra-like,
divide-and-conquer) that threads a route through real roads to approximate the outline.

| Step | Needs | Current setup |
|---|---|---|
| 1. Word → shape | AI agent emits a simple, single-stroke, closed, normalized polyline | ✅ `@ai-sdk/anthropic` + AI-chat infra already present. New `src/services/shapes.ts`. |
| 2. Georeference | Scale / translate / rotate the outline over a box near the user | ✅ `src/lib/geo.ts` already has `destination()`, `bounds()`, `haversine()`. |
| 3. Snap to streets | Trace the outline through real roads | ⚠️ The hard part — two options below. |
| 4. Fidelity score | Fréchet/Hausdorff distance between route and target → "works here / move it" | 🟡 Pure math, moderate effort. Powers honest UX. |
| 5. Integrate | Points → route, share, GPX, save | ✅ `RouteCore` + share-URL + GPX + saved routes reuse for free. |

### Step 3 — the two snap options

- **Cheap (reuses everything):** sample the shape into ordered waypoints, then call the
  existing `ValhallaRoutingService` between each consecutive pair. This is essentially
  what Motera does with OSRM. Low new code; lossy shapes; *many* network calls per shape
  against a demo-grade public endpoint.
- **Faithful (the academic way):** pull the local street graph via **Overpass** (already
  used in `src/services/places.ts`) and do client-side graph search to actually trace the
  outline. Better shapes, matches the paper; heavy new component; public Overpass is
  rate-limited (already flagged as a risk in `BUILD_LOG.md`).

## Decisions confirmed

1. **AI agent role: one-shot draw.** The agent emits *one* simple shape per word;
   the user adjusts placement (location / size / rotation) manually. Cheapest, lowest
   latency. (Iterative generate→snap→score→retry, and agent-chosen placement, are
   explicitly deferred to a later version.)
2. **Snap fidelity: decide after a prototype.** Spec both snap options, build the
   **cheap Valhalla-per-segment** prototype first, judge real output quality, *then*
   decide whether to invest in the faithful Overpass street-graph router.

## Scale reality (must be surfaced in the UI)

From the existing tools' own data: a simple heart in a 2 km × 2 km box → a **10–15 km
route**, and a GPS-art run takes **1.5–3× longer** than a normal run of the same
distance. These are long runs; the UI must show distance up front.

## Recommended path (research/spec, then prototype)

1. **AI shape generator** (`src/services/shapes.ts`): word → one normalized,
   single-stroke, closed polyline. Validate output (simple, closed, vertex-count cap).
   Generate → **preview** → confirm before snapping.
2. **Georeference + placement controls**: place the outline near the user; expose
   size / rotation / move (reuse `geo.ts`).
3. **Cheap snap prototype**: waypoint-pairs through existing `ValhallaRoutingService`;
   render the result into the existing planner `RouteCore`.
4. **Fidelity score + honest UX**: Fréchet/Hausdorff vs. target; "this works here /
   try moving it"; distance shown up front.
5. **Judge the prototype**, then decide: ship as-is, or upgrade Step 3 to the faithful
   Overpass street-graph router.

## Risks / open items

- **Fidelity is not guaranteed** — bounded by local streets; needs relocate/adjust UX
  and expectation-setting copy (every successful tool does this).
- **Public-API rate limits** — Valhalla (per-segment, many calls) and Overpass are both
  demo-grade; `BUILD_LOG.md` already warns to self-host / key for production traffic.
- **GPS-art routes are long** (10–15 km for a simple shape) — surface distance early.
- **AI shape quality** — one-shot may produce un-snappable shapes; validation +
  preview-before-snap mitigates, but some words just won't yield a good simple shape.

## References

- [Automatic route planning for GPS art generation — Computational Visual Media (Springer, 2019)](https://link.springer.com/article/10.1007/s41095-019-0146-z)
- [RouteDoodle — free Strava/GPS art route maker (OSM)](https://www.routedoodle.com/)
- [Motera — GPS Art Route Planner (OSRM snap; warns result differs from drawing)](https://www.motera.app/gps-art-planner)
- [Draw My Loop — Strava art generator (shape → OSM snap → GPX)](https://drawmyloop.com/en/strava-art-generator)
