# Constellation map

## Problem

The atlas map from `2026-09-30-precomputed-atlas.md` had two faults that no tuning
of the old renderer could fix.

- **Names shifted and popped while browsing.** Labels were placed every frame by a
  greedy screen-space collision check over whatever was on screen. Panning changed
  that set, so a name could swap with its neighbor, vanish or reappear without the
  zoom changing.
- **The map had no structure to look at.** The crawl placed each article on a spiral
  around the article that linked to it. Positions recorded discovery order, not
  relationships, so the overview read as an even scatter with no clusters, bridges
  or landmarks.

Both had to change together. Stable labels over a structureless scatter still show
nothing, and a structured layout under jittering labels still feels broken.

## Layout from links

`scripts/layout-atlas.ts` computes positions offline from the atlas link graph. The
script runs in four stages:

1. **Region assignment.** Label propagation moves each article into the region most
   of its links point to. Region landmarks and neighborhood anchors keep their
   curated region. The current region votes first with inertia, so ties never flip.
2. **Communities.** Louvain splits each region into communities.
3. **Force layout.** ForceAtlas2 (LinLog) arranges each region around its pinned hub.
   Links within a community pull hardest. A link to another region draws the article
   toward the side facing that region, so bridges sit on the borders they bridge.
4. **Scale and spacing.** Each region gets an area proportional to its article count.
   Stragglers are pulled in, and a final pass keeps every pair of points at least
   `MIN_SEPARATION` (50 world units) apart so each article stays clickable.

The layout is deterministic. Starting positions come from title hashes, not input
coordinates. Laying out the September 30 crawl output reproduces the bundled atlas
exactly: all 2,000 positions and regions match.

On that crawl:

- Propagation moved 162 articles to a better-linked region in 5 rounds.
- 68.2% of links stay within one region.
- Louvain found 7–16 communities per region.

`bun run build:atlas` runs this layout as its final step. Without it, a fresh crawl
would silently put crawl-order positions back.

Region centers sit at equal spacing on an ellipse in `REGIONS`
(`src/lib/graph/world.ts`). Each hub is pinned at its region's center, so moving a
center means running the layout again.

## Rendering

One 2D canvas draws every layer:

- **Nebula.** Soft regional light is painted once into a small world-space texture
  and scaled each frame. It recedes as a region fills the view.
- **Link fabric.** Links within a region are batched 500 to a stroke, so dense areas
  build up where strokes overlap. Links between regions are gentle arcs bowed away
  from the map's middle, so they do not all cross at one point.
- **Points.** Point size grows with link count. Points are batched by region and
  fade level, so a highlight costs a few fills rather than one per point.
- **Focus.** The selected and hovered articles draw their links whole. Hubs draw
  each link lighter so their rays stay distinct. Everything else recedes over an
  eased fade rather than switching.

Region hues are muted data colors with no purple or cyan, per `DESIGN.md`. Region
names mix 40% toward the ink color, so they stand apart from their own points.

## Labels

Each label gets one zoom interval, computed once when the atlas loads
(`src/lib/graph/labels.ts`).

- **Why zoom alone decides overlap.** Two names anchored to world points move
  together when the camera pans. Whether they overlap depends only on the zoom `k`,
  and `conflictRange` finds the range of `k` where they do.
- **How intervals are assigned.** Labels are taken in priority order: region names
  first, then each region's articles by link count, interleaved across regions. An
  article ranked `r` in its region may start at `ARTICLE_ZOOM × √(r + 1)` (0.08 for
  the first). Each label's start is then pushed past every collision with a label
  placed before it. A label that could only start beyond the 2.3 maximum zoom never
  shows.

The rules that follow from this:

- **Panning never changes which names show.** Visibility depends only on zoom.
- **Zooming in only adds names.** An article's interval runs to infinity, so it never
  makes way for another.
- **Region names hold below `REGION_LABEL_MAX` (0.42) and then give way.** Articles
  that would collide with them start above that zoom.
- **Names fade in and out.** Each fades over a zoom ratio of `LABEL_FADE` (1.12) at
  the ends of its interval, rather than popping.

Highlighted names (hovered, selected and leading connections) are the one exception.
Interval names under them step aside with a short eased fade. Hit testing checks names
before points, because names are what people aim for.

Region names sit on a blurred two-pass shadow rather than an outline. Near a screen
edge they slide inward to stay whole, and fade once their center passes the edge.

### Rejected alternatives

- **Per-frame collision with hysteresis.** This only damps the popping. The shown set
  still depends on what is on screen, so panning still changes names.
- **Storing label intervals in the atlas.** Intervals depend on measured font widths,
  so they belong to the client that draws the names.
- **Neighborhood names on the canvas.** They competed with region and article names
  for the same space. Neighborhoods remain in Browse, each starting at its landmark
  article.

## Camera and input

- **Flights.** Long moves use van Wijk and Nuij's smooth zoom-and-pan path
  (`flight` in `src/lib/graph/camera.ts`). The camera pulls back far enough to show
  the destination, then closes in, over 380–1300 ms.
- **Glides.** Direct input uses `glide`, which keeps the point under the pointer
  fixed during a zoom.
- **Reduced motion.** Moves jump instead of animating.

Wheel input separates three devices:

| Input | How it is recognized | Result |
|---|---|---|
| Trackpad pinch | Ctrl or Meta plus wheel | Zooms immediately |
| Trackpad scroll | Fine pixel deltas, or any horizontal delta | Pans, and keeps panning through its momentum events |
| Mouse wheel notch | Lines, large whole pixels, or multiples of 4.000244140625 px (Chrome and Safari on macOS) | Glides a zoom about the pointer |

Touch drags pan, and two-finger pinches zoom about the midpoint.

On phones the search panel, Browse button and orientation card stack over the top
of the map. `mapTop` starts the overview frame below them. At 320×568 the map cannot
fit between the card and the controls without zooming past the 0.045 floor. There
the bottom regions sit about 39 px behind the controls, which was accepted.

Overlays stack by DOM order at one z-index. The exceptions are search results and
the Browse menu, which rise above the panels below them so taps reach them.

## Accessibility

The canvas has no DOM text, so a visually hidden "Articles in view" list mirrors the
named articles on screen. Focusing an entry draws a ring on its point. Activating it
selects the article. Arrow keys pan, `+` and `-` zoom, and Home or `0` returns to the
overview.

## Performance

Measured in headless Chromium 154 (ANGLE Metal, Apple M4 Pro). Each figure is the
time of the JavaScript render callback per frame, over six flights alternating
between the overview and a recentered selection.

| CPU throttle | Median | p95 | Max | Frames |
|---|---|---|---|---|
| 1× | 0.8 ms | 1.0 ms | 1.1 ms | 72 |
| 4× | 3.0 ms | 5.0 ms | 6.5 ms | 67 |

Long-animation-frame entries of about 60 ms showed no blocking time and 1–3 ms of
rendering. They are idle frame-clock waits, and headless rAF runs near 30 fps even
when idle, so frame gaps are not meaningful there.

## Not verified

- **GPU raster cost on low-end phones.** The timings above cover JavaScript only.
- **The wheel classification on real hardware.** It has not been checked against
  physical trackpads and mouse wheels, including Windows precision touchpads and
  Firefox's line-mode wheels. Only synthetic events in headless Chromium were used.
- **Safari and iOS.** Rendering and gestures have not been checked there.
