# Feature Plan — runningmap (round 3)

Scope: improve location accuracy, add personal run logging + stats, and upgrade
search (free address geocoding + radius-based discovery of parks/trails).
Decisions confirmed with the user:

- **Run logging:** manual entry (no live GPS tracking).
- **Radius search:** discover places/parks/trails (POIs) near a point.
- **Geocoder:** switch to a free OSM geocoder (recommended — see §3a).

This is a *plan only*. Nothing below has been implemented yet.

---

## 1. Location accuracy — why it's off, and how to fix it

### Root causes (found in `src/components/map/RouteMap.tsx:429` `locate()`)

1. **Single-shot fix.** We call `navigator.geolocation.getCurrentPosition` once.
   GPS accuracy *improves over several seconds* as satellites lock; the first
   fix is the worst one. We take it and stop.
2. **No fallback + silent failure.** Options are
   `{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }`. If a precise
   fix doesn't arrive in 10 s the error callback runs — and it's **empty**
   (`/* ignore */`). The user taps "locate" and *nothing happens*, with no
   message and no coarse fallback.
3. **No accuracy indicator.** We drop a precise-looking dot at the fix even when
   the reported `accuracy` is 500–2000 m. The user can't tell the fix is coarse.
4. **Device limitation on desktop.** Laptops/desktops have no GPS chip, so the
   browser positions via Wi‑Fi/IP — inherently off by hundreds of metres to
   kilometres. This can't be fully fixed in software, but we can make it *as good
   as the browser allows* and make the uncertainty *honest and visible*.
5. **Coarse zoom heuristic.** `zoom = accuracy > 100 ? 14 : 16` implies more
   precision than exists for very coarse fixes.

### Plan

- **Refine with `watchPosition`** for ~10–15 s (or until `accuracy < ~30 m`),
  updating the dot each callback, then `clearWatch`. Best fix the device can give.
- **Draw an accuracy circle** (MapLibre circle layer / GeoJSON sized to the
  reported `accuracy` in metres) so uncertainty is visible, not hidden.
- **Two-stage fallback:** try high-accuracy first; on timeout/error retry with
  `enableHighAccuracy: false` (fast, coarse) so the user at least lands near
  their city instead of getting nothing.
- **Real feedback:** loading state on the button + a toast on
  denied/unavailable/timeout (replace the silent no-op).
- **Fit zoom to the accuracy circle** instead of a fixed 14/16.
- Reuse this for "near me" in search (§3) and as a default centre for stats —
  so extract a small `useGeolocation` hook.

### Files

- `src/components/map/RouteMap.tsx` — rewrite `locate()`; add accuracy-circle source/layer.
- `src/components/map/route-map.css` — accuracy-circle / pulsing-dot styles (if CSS marker).
- `src/hooks/useGeolocation.ts` *(new)* — shared watch/fallback logic.
- (Toast already available via `../components/ui`.)

> Note: the inherent desktop Wi‑Fi/IP imprecision is a device limitation, not a
> bug. The above is the maximum achievable in-browser; the accuracy circle keeps
> the UI from over-promising.

---

## 2. Personal run logging + statistics (manual entry)

Today there is only a `routes` collection (a *planned* route, with an
*estimated* duration). There is no record of an *actual* run. We add one.

### New collection — `runs` (owner-scoped, same RBAC pattern as `routes`)

`src/schemas/runs-schema.ts`, registered in `src/schemas.ts`:

| column | storage | meaning |
|---|---|---|
| `distanceMeters` | number | distance actually run |
| `durationSeconds` | number | **actual** elapsed time (distinct from a route's *estimate*) |
| `date` | text (ISO) | when the run happened (user-set; may differ from `createdAt`) |
| `unit` | text | display unit at entry (`mi`/`km`) |
| `mode` | text | `foot` default (bike/etc. optional) |
| `routeId` | text? | optional link to a saved `routes` record |
| `place` | text? | denormalized start label for display |
| `notes` | text? | optional |

Permissions: `member` → own read/create/update/delete; `admin` → all
(copy `routes-schema.ts`).

### Derived metrics (computed client-side, not stored)

- **Pace** = duration / distance → `mm:ss /mi` or `/km` (the key running metric).
- **Speed** = distance / duration → mph / km/h.
- **This week / this month / all-time aggregates:** run count, total distance,
  total time, average pace, best (fastest) pace, longest run.
- **Personal records:** longest run, fastest pace, most distance in a week.

Add to `src/lib/`:
- `units.ts` → `formatPace()`, `formatSpeed()`.
- `stats.ts` *(new)* → week/month boundary bucketing + aggregation, with
  `stats.test.ts` (matches the repo's 37-unit-test culture).

### UI

- **Log a run** — `src/components/runs/LogRunDialog.tsx` *(new)*: distance (+unit),
  time (hh/mm/ss inputs), date (defaults today), optional "link a saved route"
  select (pre-fills distance from the route), optional notes.
- **Stats page** — `src/pages/(protected)/stats.tsx` *(new)*, e.g. `/stats`
  ("My Runs"):
  - summary cards: This week · This month · All-time (runs, distance, time, avg pace);
  - personal records row;
  - recent-runs list with per-run pace, edit/delete;
  - optional weekly-distance bar chart (SVG, same approach as
    `ElevationProfile.tsx`).
- **Entry points:** "Log a run" button on the stats page and an optional
  "Log this as a run" on a saved-route card (`routes.tsx`) that pre-fills distance.
- **Nav:** add `/stats` to `src/nav.ts` (roles `viewer`/`member`/`admin`).

### Files

- `src/schemas/runs-schema.ts` *(new)*, `src/schemas.ts` (register)
- `src/lib/stats.ts` + `src/lib/stats.test.ts` *(new)*, `src/lib/units.ts` (pace/speed)
- `src/pages/(protected)/stats.tsx` *(new)*
- `src/components/runs/LogRunDialog.tsx` *(new)* (+ small stat-card components)
- `src/nav.ts`, optional `src/pages/(protected)/routes.tsx` entry point

---

## 3. Search upgrades

### 3a. Specific-location search → free OSM geocoder (recommended)

**Current:** `src/services/geocoding.ts` uses the deepspace `openweathermap/
geocoding` integration — **owner-billed** and **city-level only**, which is why
`SearchBox.tsx` is **gated behind sign-in**.

**Recommendation — switch to a free OSM geocoder:**

| | OpenWeatherMap (current) | **Photon / Nominatim (proposed)** |
|---|---|---|
| Precision | city-level only | **street / address / POI** |
| Cost | owner-billed | **free, no key** |
| Sign-in gate | required | **can drop it** (anonymous search) |
| Ecosystem | separate | same OSM stack as reverse-geocode + POIs |
| Tradeoff | — | OSM fair-use rate limits |

Lead with **Photon** (`photon.komoot.io` — free, no key, built for type-ahead),
with **Nominatim** as fallback (the more "official" one; already used here for
reverse-geocoding). The existing 400 ms debounce + 2-char minimum already
respects fair-use; set a descriptive `User-Agent`/`Referer`.

Benefits: address-level precision, **no owner billing**, and we can **remove the
sign-in gate** so anonymous users can search too.

### 3b. Radius discovery — parks / trails / running tracks (POIs)

Free **Overpass API** (OSM, no key) `around:<radius>` query centred on the user's
location or a searched point. Categories → OSM tags, e.g.:
- Parks → `leisure=park`
- Trails → `route=hiking`, `highway=path`/`footway`
- Running tracks → `leisure=track`

UI: a "Discover nearby" panel — category chooser + radius slider (1/3/5/10 km) +
centre (my location / map centre). Results listed with haversine distance
(`geo.ts` already has `haversine`), click to fly there / drop a marker; optionally
render results as map markers.

Add a 12 s timeout + graceful failure (mirroring the routing service), since
public Overpass instances are demo-grade and rate-limited.

### Files

- `src/services/types.ts` — add `PlacesService` + `Place` type.
- `src/services/geocoding.ts` — new `PhotonGeocoder` (+ Nominatim fallback); swap `geocodingService`.
- `src/services/places.ts` *(new)* — Overpass wrapper (timeout + fallback).
- `src/components/planner/SearchBox.tsx` — drop the `isSignedIn` gate.
- `src/components/planner/DiscoverPanel.tsx` *(new)* — category + radius + results.
- `src/lib/geo.ts` — reuse `haversine` (and `bounds` to frame results).

---

## Suggested sequencing

1. **Location accuracy** — small, isolated, high value. Ship first.
2. **Run logging + stats** — largest; self-contained new collection + page.
3. **Search** — (a) swap geocoder to free + ungate (small) → (b) POI discovery (medium).

## Testing (keep the repo's cost-free, stubbed culture)

- Unit: `stats.test.ts`, pace/speed in `units.test.ts`, radius filtering in `geo.test.ts`.
- E2E: stub Photon/Nominatim and Overpass via `page.route` (no real calls).
  Dropping OpenWeatherMap means **no owner-billed calls anywhere**.

## Review addendum — decisions from two pre-build reviews

Incorporated before coding (supersedes anything above that conflicts):

1. **`runs` RBAC:** copy *all four* permission keys from `routes-schema.ts`
   (`'*'`, `viewer`, `member`, `admin`) verbatim; owner = `createdBy` (no
   `ownerField`). `useQuery('runs')` uses no client owner filter. Nav `/stats`
   roles match `routes` (`viewer`/`member`/`admin`).
2. **A run is an immutable snapshot.** At log time, copy `distanceMeters`,
   `place`, `mode` into the run. `routeId` is a *soft* pointer only — all
   run-reading UI tolerates a deleted/missing route. No cascade exists in DeepSpace.
3. **Units:** aggregate everything in SI base units (m, s); store per-run `unit`
   only to echo the original entry. Stats page has its own unit toggle (there is
   **no** user-level unit setting today — don't pretend one exists).
4. **Stats bucketing:** store `date` as a bare **`YYYY-MM-DD` local** date string.
   Bucket in **local** time; **week starts Monday**. "Average pace" = total
   distance / total time (NOT mean of per-run paces). `stats.test.ts` covers
   month/week boundaries + DST. Parse `YYYY-MM-DD` as local (avoid JS UTC-midnight
   footgun).
5. **Pace/speed guards:** `formatPace`/`formatSpeed` return `—` for
   non-positive distance or time (mirror `formatDuration`'s `<= 0` guard). Pace is
   foot-meaningful; for non-foot modes show speed. v1 logging is foot-focused;
   elevation/splits/HR are explicitly **out of scope**.
6. **Geocoder:** new `PhotonGeocoder` uses **direct browser `fetch`** (not
   `integration.*`), implements `search(query, signal)` and wires the
   `AbortSignal` into `fetch` (the current impl silently drops it). **Do not** set
   `User-Agent`/`Referer` — browsers forbid those headers. Nominatim is a
   best-effort fallback with graceful failure (like `reverseGeocode`). Extend
   `GeoResult` only if needed for legible address labels.
7. **Drop search gate fully:** remove the `isSignedIn` early-return card *and*
   the `[query, isSignedIn]` effect gate in `SearchBox.tsx`. Add a **signed-out**
   e2e proving anonymous search works (stubbed Photon). Delete the now-dead
   OpenWeatherMap stub helper.
8. **Accuracy circle:** MapLibre `circle-radius` is **pixels, not metres** — add
   a `circlePolygon(center, radiusMeters)` helper to `geo.ts` (new destination-
   point math) and render a `fill` + `line` layer, re-added idempotently in the
   same `addRouteLayers` path so it survives globe/style swaps.
9. **`useGeolocation` hook:** explicit `{ getOnce, watch, stop }` API (no
   auto-watch). `clearWatch` on unmount, on a second tap, and unconditionally on
   timeout (handle "accuracy never < 30 m"). Do **not** mount it on the stats page.
10. **Overpass v1 cut:** parks only (`leisure=park`, nodes/ways, `out center`),
    fixed radius set, **list-only** results that `flyTo` on click (no persistent
    marker layer for v1). Empty/error is the *expected* path, not an edge case.
    Trails (`route=hiking` relations) deferred to v2.
11. **Quality bar:** every new surface gets empty/loading/error states reusing
    `EmptyState`/`LoadingSpinner`/`ConfirmModal`; `LogRunDialog` uses UI primitives
    (no native `<select>`/`window.confirm`), labeled hh/mm/ss inputs, and validates
    (no empty distance, no future date, positive time).

## Open items / risks

- Public **Overpass/Photon/Nominatim** are demo-grade — fine for personal scale;
  self-host or use a keyed provider for production traffic (swap-in only).
- Desktop location is inherently coarse (no GPS chip) — the accuracy circle keeps
  the UI honest; we can't beat the device.
- Keep `runs.durationSeconds` (**actual**) distinct from `routes.durationSeconds`
  (**estimated**) — don't conflate them in stats.
