/**
 * External-service configuration. Every endpoint is a free, no-key public API;
 * base URLs are overridable via `VITE_*` env vars so a deployment can swap in a
 * premium/self-hosted provider without code changes. No secrets here.
 */

const env = import.meta.env

/** MapLibre vector style JSON. OpenFreeMap — free, no key, no signup. */
export const MAP_STYLE_URL: string =
  env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Routing root — FOSSGIS public Valhalla instance. Free, no key, CORS-enabled
 * (`Access-Control-Allow-Origin: *`), supports pedestrian/bicycle/auto, and is
 * dramatically faster + more reliable than the public OSRM demo servers (which
 * frequently time out). Override with a keyed/self-hosted Valhalla for prod.
 */
export const ROUTING_URL: string =
  env.VITE_ROUTING_URL ?? 'https://valhalla1.openstreetmap.de'

/** Per-request routing timeout (ms). Fail fast to a straight line; never hang. */
export const ROUTING_TIMEOUT_MS = 12_000

/** Open-Meteo root for the elevation API. */
export const ELEVATION_URL: string =
  env.VITE_ELEVATION_URL ?? 'https://api.open-meteo.com'

/** Per-request elevation timeout (ms) so a hung provider falls through to the next. */
export const ELEVATION_TIMEOUT_MS = 8_000

/** Max coordinates Open-Meteo accepts (and we sample) per elevation request. */
export const ELEVATION_SAMPLE_COUNT = 100

/** Initial map view (continental US) when there's no shared route to fit. */
export const DEFAULT_CENTER = { lat: 39.5, lng: -98.35 }
export const DEFAULT_ZOOM = 3.4
