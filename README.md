# runningmap

A map-first route planner for runners — draw a loop, watch the distance add up,
check the elevation, and save it to run later. For runners figuring out where to
go. Built on the [DeepSpace SDK](https://deep.space).

**Live app:** https://runningmap.app.space

## What it does
- Plot a route point-by-point on a full-screen map, with live distance as you build
- See an elevation profile for the line you've drawn
- Search for a starting place or drop points from your current location
- Save routes to your account and export them as GPX for your watch or phone

## How it's built
The planner renders on a MapLibre GL map in the browser. Saved routes, logged
runs, and unit/display preferences are stored in DeepSpace RecordRooms and sync
per user through the SDK's record hooks, so your library follows you across
devices. Auth and session handling come from the SDK. Elevation data is pulled
from Open-Meteo and place search from OpenStreetMap Nominatim — free public APIs
called directly from the client.

## Run your own

Deploy your own copy in three commands:

```sh
npm install
npx deepspace login     # one-time, opens a browser tab
npx deepspace deploy    # -> <name>.app.space
```

Auth, the database, real-time sync, and hosting all come from DeepSpace, so
there is nothing else to configure. Your subdomain is the `name` field in
`wrangler.toml`; change it for your own deployment.

Or build something new: apps like this are made by handing a prompt to a
coding agent — start at [deep.space/get-started](https://deep.space/get-started),
or scaffold from scratch: `npm create deepspace@latest my-app`.

---
*runningmap was built end-to-end by an AI agent on the DeepSpace SDK.
DeepSpace is laying the foundation for rebuilding the Internet in an AI-native
way — [deep.space](https://deep.space) · [docs](https://docs.deep.space).*
