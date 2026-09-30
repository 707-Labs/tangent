# tangent

A Wikipedia rabbit hole feed, live at [tangent.page](https://tangent.page). Scroll a
feed of article cards where each one shows **why** it connects to the last — "linked
from", "related to", or a surprise "tangent". The connective tissue between articles
is the whole point.

The feed and article reader fetch current Wikipedia content. The map starts with a
bundled atlas of real articles, summaries and connections so exploration can begin
without a Wikipedia request for each selection. Search also reaches articles beyond
the atlas.

## Stack

- **SvelteKit** + **Svelte 5 runes** + **TypeScript** (strict)
- **Tailwind CSS 4** (`@tailwindcss/vite`)
- **Cloudflare Workers** target (`adapter-cloudflare`) — develop locally first
- Wikipedia **REST** API (summaries/images) + **Action** API (links, related, search)

## Develop

```bash
bun install
bun run dev    # http://localhost:5173
```

Other scripts: `bun run check` (svelte-check), `bun run test` (vitest), `bun run build`.

## How it works

```
/start  ──pick a seed──▶  /?seed=Title  ──▶  feed
```

1. **Seed** — a curated topic, a search result, or "Surprise me" (curated, because
   `list=random` returns mostly obscure stubs).
2. **Advance** — for the current article, `GET /api/links` enriches its lead-section
   links in reading order. Broad pools reserve up to six slots for `morelike:`
   related alternatives; sparse articles use an outbound-link/related fallback.
   Optional related requests have a deadline, so a ready lead pool stays usable.
3. **Choose** — the pure feed engine (`src/lib/feed/`) scores candidates by relevance
   (overlap with the user's liked-token interest vector), penalizes monotony, only
   lightly prefers illustrated cards, and serves **surprise** tangents between
   coherent runs of a few articles, so the reader can explore a neighborhood
   before taking another turn. Category affinity ignores generic
   housekeeping words, and directional labels require supporting metadata.
   Selection is a softmax-weighted pick among the top scorers, not a robotic argmax.
4. **Render** — the chosen article's summary leads the card as its hook,
   with a breadcrumb explaining the connection and a centered image that keeps its proportions.
   Seed and deliberate-dive cards appear as soon as their summaries arrive; optional
   full-article imagery does not hold them up. The next few cards are prefetched,
   and concurrent cache misses share one acquisition within a Worker isolate.

The article reader preserves sources, native media, math, galleries and wide tables.
See the [renderer coverage matrix](docs/specs/2026-09-30-renderer-audit.md) for the
22-page corpus, browser checks and remaining limits. Wikipedia's interactive scripts
are not loaded. [Loading paths](docs/specs/2026-09-29-loading-paths.md) documents the
request-order changes and their verification; no measured production speedup is claimed.

Engagement (likes, foreground dwell time, clickthroughs) lives in `localStorage`
and feeds the interest vector. Tunable knobs live in `src/lib/feed/config.ts`.

### Article atlas

`bun run build:atlas` refreshes the static map snapshot from Wikipedia. The generator
uses a bounded, resumable local acquisition cache and saves canonical articles,
short previews, known hyperlinks and fixed positions. It runs separately from the
production build; deploying the site does not crawl Wikipedia.

The default target is 2,000 articles. `ATLAS_TARGET=500 bun run build:atlas` creates
a smaller sample; `ATLAS_REFRESH=1 bun run build:atlas` fetches new responses instead
of reusing the acquisition cache. Successful cached responses let ordinary runs
resume. Article excerpts retain their Wikipedia URLs and CC BY-SA attribution;
the repository's MIT license covers Tangent's code, not the Wikipedia excerpts.

The atlas is a sample of Wikipedia, not a complete spatial index. Its connections
include known incoming and outgoing article hyperlinks. Topic regions are navigation
aids, not a claim that every article belongs to one discipline. Full articles remain
live, while map previews reflect the snapshot's generation date. See
[atlas design](docs/specs/2026-09-30-precomputed-atlas.md) for the acquisition contract,
size and validation.

### Layout

```
src/lib/
  wikipedia/   client + REST/Action wrappers + types   (server-side fetching)
  server/      in-memory TTL cache
  feed/        pure engine: config, tokens, score, select + client feedState
  engagement/  localStorage interest profile (runes)
  components/   ArticleCard, ConnectionBreadcrumb, SkeletonCard, BrandMark
src/routes/
  +page.svelte         the feed (infinite scroll, prefetch, branching)
  start/+page.svelte   seed selection (search + curated topics)
  api/{card,links,search}/  cached Wikipedia proxies
```

## Notes

- Wikipedia asks for a descriptive `User-Agent`; set in `src/lib/wikipedia/client.ts`.
- The REST `related` endpoint is gone (404) — `morelike:` search is the stand-in.
