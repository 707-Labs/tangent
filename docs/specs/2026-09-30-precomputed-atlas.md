# Precomputed article atlas

## Why a static snapshot

The first map redesign began with 42 landmarks and fetched a summary and a
neighborhood for every selection. Immediate camera movement could not compensate
for sparse overview content or waiting for live acquisition. Adding more points to
that same path would increase startup work while leaving the delay intact.

The smallest useful change has two parts: a generated static atlas and a client
that consumes it directly. The snapshot contains real canonical Wikipedia articles,
short previews, known article hyperlinks and fixed coordinates. Selecting an atlas
article uses these records immediately. Live search and acquisition extend the map
beyond the sample; full article HTML continues to load through the existing reader.

No new database, hosted crawler, vector service or paid infrastructure is required.
The generator runs locally, and the existing Cloudflare asset deployment carries
the resulting JSON. Production builds use the checked-in snapshot and do not crawl.

## Data and refresh contract

`bun run build:atlas` refreshes `static/graph/atlas.v1.json`. The versioned format is
`{ version, generatedAt, language, aliases, nodes }`. Each node stores the existing
article fields plus `x`, `y`, `region`, `hub`, directed `outgoing` links and canonical
incident `neighbors`. The checked-in snapshot was assembled on September 30, 2026.

Acquisition resolves redirects, rejects missing pages and disambiguation pages,
and collects actual article hyperlinks. Connections include known incoming and
outgoing hyperlinks within the snapshot. They are a sampled connection set, not
a claim to include every link in an article. Alias records point to one canonical
article, and every saved neighbor must resolve to an included canonical node.

Summary batches use at most 20 titles. A three-title empirical probe returned all
extracts and thumbnails and resolved Eastern Roman Empire to Byzantine Empire.
Batching `prop=links` with a shared limit did not yield a neighborhood for each
article, so the generator collects lead-section hyperlinks separately.

The acquisition cache is local and ignored by Git. At most two requests run together,
with a 20-second timeout, one retry and a 2,300-attempt budget per run. Cached raw
responses let an interrupted refresh resume. `ATLAS_REFRESH=1` bypasses that cache
for a deliberate fresh collection; `ATLAS_TARGET` supports smaller local samples.
Previews retain Wikipedia's text, cut to a short excerpt; each record keeps its
Wikipedia URL and the map's Wikipedia/CC BY-SA attribution remains visible.

## Navigation and rendering

Fixed positions are computed before shipping the snapshot. Seven topic regions
provide entry points. They are navigation aids, not a global semantic embedding;
cross-disciplinary articles retain a stable first placement.

The overview draws the actual corpus as points. More article names appear as the
camera zooms in. Interactive labels, focused edges and visit trails remain bounded,
so global density does not turn into a wall of overlapping text or connections.
Local search makes every atlas article reachable by title; live Wikipedia search
reaches articles outside the sample.

Atlas previews and connections do not wait for `/api/card` or `/api/links`. An
unavailable or invalid snapshot falls back to the live map. Imported live articles
do not move or evict atlas nodes. Full reader content remains current, while map
previews reflect `generatedAt` until the next refresh.

## Limits

This snapshot does not contain all of Wikipedia. Its purpose is to make a substantial
starting collection immediately explorable while preserving access to the rest.
No quantitative production speedup or engagement improvement is claimed.

If the starting collection eventually needs tens of thousands of summaries, split
it into a compact overview and regional detail assets. The concrete reason to add
that complexity would be measured startup transfer or memory cost. The initial
implementation keeps one asset so every bundled selection has a ready preview.

## Validation

The snapshot contains 2,000 canonical articles, 355 aliases and 16,947 directed
lead hyperlinks. Incident adjacency has 28,726 entries. All nodes form one connected
component, with 274–293 articles per topic region and a minimum point separation of
55.013 world units. The final acquisition run used 1,641 network attempts and 465
cached responses, with zero acquisition failures.

The saved JSON is exactly 3,257,627 bytes. A local gzip encoding is 955,310 bytes;
this is an encoding size, not a measured production transfer or speedup. The maximum
preview is 901 characters. SHA-256:
`aa517476af43664f40d70ed468b283df19d367993e1c70652e9f721898149e85`.

Independent review checked 295 canonical nodes and 1,223 outgoing edges against
their cached Wikipedia responses without mismatches. Snapshot tests check canonical
URL provenance, aliases, actual incident-edge evidence, finite positions, corruption
rejection, compact previews and minimum corpus coverage. Redirect regressions cover
both response orders so live aliases cannot overwrite atlas positions or connections.

393 tests in 28 files pass. Svelte check reports zero errors and warnings, and the
Cloudflare production build succeeds with the atlas included in its assets.

Browser checks at 320/375 px and 1,280 px found no horizontal overflow. At 375 px,
the reader occupies the viewport and returns to the selected article on close.
The selected-article panel resets its scroll position when following a connection.
A local test proxy rejected all card and link requests: selecting Nature, Universe
and Matter still displayed previews and connections, with zero such requests.
Rejecting the atlas asset recovered to the live map and its retry controls.
Global search imported Voynich manuscript outside the snapshot, with its live
preview and connections. Clicking an unlabeled canvas point selected Elementary
particle. No browser console errors were recorded during those checks.
