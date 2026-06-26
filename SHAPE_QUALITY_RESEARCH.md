# Shape Quality — how generation works, why a "dog" looked weird, and the fix

This answers three things you asked: (1) **exactly** how a shape is determined,
(2) **why** complex shapes (like a dog) came out poorly, and (3) **how** it's fixed.

## UPDATE — pivoted from "AI draws coordinates" to "search a real icon and trace it"

Your feedback (the AI dog/Hello-Kitty looked wrong and sometimes only drew half)
matches the core finding below: **LLMs are bad at inventing drawing coordinates.**
So the AI-coordinate path has been **removed** and replaced with an **icon search**
(like the place search): type a word → search the free [Iconify](https://iconify.design)
library (200k+ professionally-drawn icons) → pick one → its silhouette is traced
into the route. This needs **no AI and no DeepSpace credits**, and produces far more
recognisable shapes because a human designed them. The "draws half" symptom came from
the LLM returning partial/garbled point lists; a real icon path is complete by
construction. Details of the new flow are in "What shipped" below; the original
analysis is kept for the reasoning.

## 1. Exactly how a shape is determined today

There are **two** sources. The app tries them in this order:

### (a) Built-in library — FREE, no AI, deterministic
`src/lib/shapes.ts` holds ~15 hand-drawn outlines (heart, star, circle, dog, cat,
fish…), each a fixed list of points in a unit square. `findShape(word)`:
1. exact name match (`"heart"`),
2. synonym (`"love" → heart`, `"puppy" → dog`),
3. whole-word token in a phrase (`"draw me a house" → house`).

If it matches, **no AI is used** — you get the stored outline. This is why "heart"
and "star" look fine: they're simple and pre-drawn.

### (b) AI generation — USES DEEPSPACE CREDITS (owner-billed)
Only runs when (i) the library has **no** match, **and** (ii) you're signed in.
`src/services/shapes.ts → generateShapeWithAI(word)`:
1. Sends one prompt to `integration.post('openai/chat-completion', …)` asking the
   model to reply with a JSON array of `{x,y}` points (a single closed loop).
2. Parses + validates the reply (numbers in [0,1], 6–48 points); on **any** failure
   it returns nothing and the UI falls back to "pick a built-in shape."

**So: a word that matches the library is free and reliable; any other word goes to
the AI, which costs credits and is the part that produces weird results.**

### What happens after a shape is chosen (both sources)
`placeShape` scales/rotates the outline onto the map near your view → `shapeToRouteCore`
turns the points into a route → the existing engine **snaps each point-to-point leg
onto real roads** (Valhalla). You then drag/edit points.

## 2. Why a "dog" comes out weird — three compounding reasons

1. **LLMs are bad at drawing by coordinates.** This is well-documented: a model
   "draws blindly" — it has no canvas to look at, so it emits coordinate lists that
   are often unclosed, self-crossing, or scribbly, especially for complex objects
   like animals. Simple primitives (heart, star) survive; a dog usually doesn't.
   (Sources below.) Our current AI prompt asks for **raw {x,y} points**, which is the
   weakest possible request for a recognizable animal.
2. **The built-in `dog`/`cat`/`fish` outlines are crude.** They're rough silhouettes
   I hand-placed; even before snapping they don't read clearly.
3. **Road-snapping distorts whatever it's given.** A running route must follow real
   streets, so the snapped result only resembles the outline as much as the local
   streets allow. Practitioners confirm: grid-street/downtown areas snap cleanly;
   curvy suburbs/cul-de-sacs mangle shapes. A small shape in a bad street area can
   end up unrecognizable no matter how good the source outline was.

**The core truth (unchanged from the first research): you can have a recognizable
shape OR a road-following run — rarely both perfectly.** Every shipping GPS-art tool
manages this with expectation-setting + letting the user see and adjust.

## 3. How to make it better — the levers

| Lever | Effect | Cost |
|---|---|---|
| **A. "Exact shape" mode (manual, no snap)** | Route IS the outline exactly — guarantees it looks like the shape (just doesn't follow roads). Lets you *verify* the shape, then switch to road-snapping. | Low ✅ implementing now |
| **B. Show source clearly (library vs AI + credits)** | You always know whether AI/credits were used. | Low ✅ implementing now |
| **C. Bigger shapes + place in grid-street areas** | More turns, more room → snapping distorts less; the #1 practitioner tip. | Low ✅ guidance now |
| **D. Better AI prompt** | Ask for a simple, single, closed, non-crossing outline with examples — squeezes more out of a weak capability. | Low ✅ improving now |
| **E. Ghost "target" overlay on the map** | Draw the intended outline under the snapped route so you see intent vs result. | Medium ⏳ next step |
| **F. Switch AI from raw points → SVG path, or word→icon mapping** | Slightly better source shapes; still weak for animals. | Medium ⏳ |
| **G. "Find a good spot" (search placements/rotations for best fidelity)** | Automatically positions the shape where streets support it. | High ⏳ (the academic approach) |
| **H. Image→one-line (TSP-art) for arbitrary pictures** | Turns any image into a single continuous stroke. Produces a dense scribble, not a clean outline — better for art than for a runnable route. | High ⏳ research-grade |

### What shipped (the icon-search rebuild)
- **Icon search replaces AI coordinates.** `src/services/icons.ts`:
  - `searchIcons(word)` → Iconify `/search` → a grid of icon thumbnails to pick from.
  - `fetchIconShape(id)` → Iconify icon JSON → take the **longest subpath** (the
    silhouette, discarding eyes/holes) → sample it with the browser's
    `getTotalLength`/`getPointAtLength` into ordered points → normalise to a closed
    unit shape. Pure parsing/normalising is in `src/lib/svg-shape.ts` (unit-tested).
  - Free, no key, **no DeepSpace credits**, no sign-in.
- **Quick presets** keep the curated built-ins for instant/offline common shapes.
- **Exact vs. Follow-roads toggle.** "Exact" renders the true outline (manual
  segments) so a dog *looks* like a dog; "Follow roads" makes it a runnable street
  route (and warns it distorts). Follow mode uses fewer waypoints (24) so it doesn't
  flood the public router; exact uses more (64) for a smooth outline.
- **Transparency**: panel says "Free icon search (no AI / no credits)"; the
  post-draw toast says e.g. *"Drew 'dog' — Traced from an icon (free) · exact outline."*
- **Guidance**: hints that solid/filled icons trace best and that big shapes in
  grid-street areas snap cleanest.
- **Tip for recognisability**: use **Exact** to verify the shape, then switch to
  **Follow roads**; pick **solid/filled** icons (line icons and emoji trace poorly
  because they're multi-stroke).

### Recommended next (E–G), in priority order
1. **E. Ghost target overlay** — highest UX value; needs a second map layer in
   `RouteMap`. Lets users adjust until the snapped route matches the intent.
2. **F. AI → SVG path or curated-icon selection** — more reliable source shapes than
   raw coordinates.
3. **G. Auto-placement search** — the academic "find where the streets fit the shape"
   step; turns best-effort into genuinely good for many words.

## Sources

- [Why graphic design / SVG is hard for LLMs (they "draw blindly")](https://davidmack.medium.com/why-graphic-design-is-hard-for-large-language-models-64ee67c4309c)
- [LLM SVG-generation benchmark across 9 models](https://www.communeify.com/en/blog/ai-image-generation-showdown-9-llms-svg-benchmark/)
- [Spatial reasoning weaknesses in LLMs (survey)](https://www.emergentmind.com/topics/spatial-reasoning-in-llms)
- [GPS-art tips: bigger designs, grid streets, zoom-out-to-verify (RunGo)](https://www.rungoapp.com/blog/how-to-make-gps-art)
- [Motera — road-snapping warns the result differs from the drawing](https://www.motera.app/gps-art-planner)
- [TSP art / one-line drawings (single continuous stroke from an image)](https://wiki.evilmadscientist.com/TSP_art)
