# BUILD_LOG — runningmap (On The Go Map rebuild)

A running log of what was built, decisions made, and pass/fail status.
Target: functional parity with https://onthegomap.com/#/create, redesigned UI/UX
(floating-glass), built on the deepspace-sdk. No edits to `worker.ts` / infra.

## Locked decisions (from the user)

- **Map engine:** MapLibre GL JS (3D globe projection toggle). One new runtime dep.
- **Basemap:** Street only — OpenFreeMap vector style (`tiles.openfreemap.org`),
  free, no API key, no signup. Configurable via `VITE_MAP_STYLE`.
- **UI/UX:** Floating-glass — full-bleed map, translucent floating panels.
- **Theme:** `midnight` (dark navy / sky-blue) — dark glass panels read well over
  the light street basemap. Easy to change in `index.html`.

## External services (all no-key, wrapped behind interfaces in `src/services/`)

| Capability | Provider | Key? | Env var |
|---|---|---|---|
| Map tiles / style | OpenFreeMap (vector) | none | `VITE_MAP_STYLE` |
| Snap routing (foot/bike/car) | FOSSGIS public OSRM (`routing.openstreetmap.de/routed-*`) | none | `VITE_OSRM_URL` |
| Elevation | Open-Meteo `/v1/elevation` | none | `VITE_ELEVATION_URL` |
| Geocoding (search) | OSM Photon + Nominatim fallback (direct fetch) | none | n/a |
| Nearby places (parks) | OSM Overpass API (`overpass-api.de`) | none | n/a |

**Needs a key from me:** none. Everything runs key-free. (Premium tile providers
like MapTiler/Thunderforest can be swapped in later via `VITE_MAP_STYLE`.)

## Notable decisions

- Geocoding uses the SDK integration (owner-billed), so the **search box is gated
  behind sign-in** per the integrations guidance; the rest of the planner works
  fully anonymously (matching OTGM, which needs no login).
- Manual mode = straight lines, **no network** → deterministic, used for offline
  unit/e2e geometry assertions. Snap modes (foot/bike/car) hit OSRM; in e2e those
  calls are stubbed via `page.route` for determinism + zero cost.
- Route is encoded into `?r=` (Google-polyline of anchor points + per-segment mode
  chars + unit). Loading the URL reconstructs and re-snaps the route.
- History (undo/redo) stores a light `RouteCore` (points + modes + unit), not the
  fetched geometry — geometry is re-derived/cached.

## Acceptance criteria → implementation

1. **Interactive editing** — click adds (`RouteMap` map click), drag vertex
   (`maplibregl.Marker` draggable), drag segment to insert (`route-hit` layer
   mousedown → `beginInsert`), shift-click + trash delete, undo/redo (history).
2. **Snap routing** — `OsrmRoutingService` foot/bike/car + manual straight; mode
   pill sets new-segment mode, `SelectedPointPanel` changes a segment's mode.
3. **Live distance + mi/km** — `BottomBar` readout + unit toggle.
4. **Elevation profile** — `useElevation` (Open-Meteo) + `ElevationProfile` SVG.
5. **GPX export** — `buildGpx`/`downloadGpx`, elevation interpolated per point.
6. **Share URL** — `encodeRoute`/`decodeRoute` ↔ `?r=`, synced + reload-restored.
7. **Keyboard a11y** — Tab→canvas, arrows pan (MapLibre), Space adds at centre,
   Del removes (wrapper keydown).

Extras beyond OTGM: 3D globe toggle, locate-me, fullscreen, return-to-start,
out-and-back, reverse, saved routes (owner-scoped collection + My Routes page).

## Status — COMPLETE, all green ✅

- [x] Foundation libs (geo, polyline, units, route-model, share, gpx, history)
- [x] Services (routing, elevation, geocoding, config, types)
- [x] useRoute hook (state + history + async snapping orchestration)
- [x] MapLibre RouteMap (markers, line, click/drag/insert, globe, keyboard)
- [x] Planner UI (mode pill, search, selected-point, bottom bar, elevation)
- [x] Pages / schema (routes) / nav / theme (midnight)
- [x] `tsc --noEmit` clean · `eslint .` clean · `vite build` succeeds
- [x] **Unit: 37/37 passing** (vitest)
- [x] **E2E: 19/19 passing** (Playwright) — smoke 6, api 3, collab/RBAC 1, planner 9
- [x] Verified live with real services (OpenFreeMap tiles, OSRM foot-snap,
      Open-Meteo elevation): a shared `?r=` route renders snapped at 1.93 mi
      with an elevation profile; the 3D globe toggle renders a real Earth.

### Notable fix during verification

MapLibre's own CSS (`.maplibregl-map { position: relative }`) overrode the map
container's Tailwind `absolute inset-0`, collapsing it to 0 height — the canvas
mis-sized and never received clicks. Fixed by sizing the container with explicit
`h-full w-full` (works under relative positioning) and giving the planner a
definite `h-[calc(100dvh-3.5rem)]`. Caught by the e2e map-click test, not by
type-check/lint — exactly why the browser tests matter.

## How to run

```
npx deepspace dev          # local dev server (http://localhost:5173)
npm run test:unit          # vitest (37 tests, no login)
npx deepspace test e2e     # full Playwright suite (needs login + ≥2 test accounts)
npx deepspace deploy       # ship to runningmap.app.space
```

Optional env overrides (all have free, no-key defaults): `VITE_MAP_STYLE`,
`VITE_OSRM_URL`, `VITE_ELEVATION_URL`.

## Open items / notes

- **Needs a key from me:** none — every external service runs key-free.
- Search is sign-in gated (owner-billed geocoding); the rest works anonymously.
- Public Valhalla/OpenFreeMap/Open-Meteo are demo-grade; for production traffic,
  point the `VITE_*` vars at a keyed/self-hosted provider (swap-in only).
- Bundle is ~2.2 MB (MapLibre); acceptable, could be code-split later.

## Round 2 — bug fixes (post-review)

User reported: routing slow + fails often (#1), markers "floating" off the line,
and an unwanted "click the map" popup. Findings + fixes:

1. **Routing was hanging, not just slow.** Measured the endpoints directly:
   both OSRM servers (`routing.openstreetmap.de/routed-*`,
   `router.project-osrm.org`) returned **nothing for 12–21 s** (curl exit 28),
   and the service had **no timeout**, so the UI waited forever. The FOSSGIS
   **Valhalla** instance (`valhalla1.openstreetmap.de`) answered in **0.87 s**,
   is CORS-enabled (`Access-Control-Allow-Origin: *`), free, no key, and supports
   pedestrian/bicycle/auto. **Switched routing to Valhalla** (`src/services/
   routing.ts`, precision-6 polyline) + added a **12 s per-request timeout** and
   straight-line fallback so it can never hang. Verified live: a 4-point foot
   route snaps in ~1.2 s.
2. **Snapping churn.** The orchestration aborted *all* in-flight requests on
   every edit, re-fetching valid segments. Rewrote `useRoute` to keep a
   persistent in-flight map and only abort segments that no longer exist.
3. **Markers "floating".** MapLibre positions a marker by writing `transform`
   onto the element; our `.rm-marker` had `transition: transform`, so every pan
   *animated* the translate and the marker lagged behind the map. Moved all
   visuals to an inner `.rm-marker__dot`; the MapLibre-positioned element is now
   transition-free (markers stay pinned).
4. **Removed** the "Click the map to start your route" popup.
5. **Tests cost nothing.** Removed the real owner-billed geocoding call from
   `api.spec.ts`; search is now covered by a **stubbed** page test. Routing,
   tiles, and elevation are all stubbed (Valhalla stub added). Added a
   routing-failure→straight-line-fallback test. Created a 3rd local test account
   so the save/delete spec uses an account disjoint from the collab spec (they
   were racing the same account's records under parallel workers); save/My-Routes
   assertions now use client-side nav so they read the live store, not a reload.

Status after round 2: `tsc`/`eslint` clean · **37 unit + 20 e2e green (twice)** ·
no test run incurs any charge.
