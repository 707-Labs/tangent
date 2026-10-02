# Share cards

A shared Tangent link should unfurl as the article it points at. Every page used to carry
the same Open Graph tags and a static card drawn with the retired S-curve logo, so a link
to Elephant Island looked exactly like a link to the home page. Three parts change that:
the favicon and the site card now draw the current BrandMark; feed and article-map links
get the article's own title and description in their metadata; and those tags point at a
1200×630 PNG for the article, rendered on demand by `/og`.

## Which links describe an article

Only the feed (`/`) and the article map (`/graph`) carry article state. Their subject is
the open reader, else the focused card, else the seed: the precedence the page itself
restores. The map never reads `card`, so it ignores that parameter. Feed card ids end in
a `#n` suffix (`card=Russian+sloop+Mirny%232`) that is per-feed bookkeeping, so it is
stripped. Reader and card values longer than the page accepts (500 and 200 characters)
are ignored, as the page ignores them. Every other route, and a bare feed, keeps the site
card.

Titles are normalized as MediaWiki stores them, as far as the URL alone allows: Unicode is
composed (NFC), direction marks and overrides are dropped, and underscores and runs of
whitespace become single spaces. A value that cannot be a MediaWiki title falls back to
the site card, never to a different article. That covers forbidden or control characters,
bidi isolates, more than 255 UTF-8 bytes, and `.`, `..` or `./`-style segments, which
would otherwise resolve as relative paths in the REST request. The first letter is not
capitalized. MediaWiki would capitalize it, but the tags carry the requested title, and
eBay would read as "EBay". The cost is that `moscow` and `Moscow` are cached as separate
cards.

`src/app.html` carries `%tangent.share.*%` placeholders. The server hook fills them through
`transformPageChunk` from the URL alone (`src/lib/share/meta.ts`), so no page response
waits on Wikipedia, and the client-rendered map is covered like the feed. Only the
document head is filled. Once `</head>` has passed, chunks go through untouched, so page
data in the body that echoes URL text is never rewritten. Values are escaped for
attributes and replaced in one pass, so a title containing `$&` or a placeholder
look-alike stays literal. Titles are clipped to 120 characters in the tags. `og:url` keeps
only `seed`, `reader` and `card`. Facebook and LinkedIn treat it as canonical, and the bare
site URL there would collapse every article share into the site card.

The tags carry the requested title and the card shows Wikipedia's canonical title. They
differ after a redirect, and in letter case: a feed seeded with `Москва` unfurls under that
title over a card for Moscow. Like the rest of the app, the card uses the stored title, not
the display title, so eBay's card reads "EBay".

## The card

`GET /og?title=Elephant%20Island&v=1` returns the card. It uses the Nightstand tokens as
literal values: the void ground with the lamplight wash, the BrandMark lockup at the
header's proportions (mark 1.5× the wordmark, half an em apart), the title in Newsreader,
the description in Newsreader italic and `tangent.page` in Hanken Grotesk. The ember
appears only on the mark's dot.

Two compositions share one frame. With a usable lead image, the image sits in a rounded
panel on the right. Photographs (JPEG and TIFF originals) fill the panel unless filling it
would enlarge them more than 2.25×; diagrams, maps, logos and small photos are shown whole
on the surface tone. Images under 320 px on their longer side are left off. Without an
image, a typographic card sets a larger title beside a large, quiet ghost of the mark.

The description is Wikipedia's short description, else the extract's first sentence.
Disambiguation pages get none, because theirs is always "Topics referred to by the same
term".

The title takes the largest size step at which an estimate fits it in three lines without
breaking a word, with room left for the description. The estimate uses average advance
widths measured on rendered cards and rounded up, so it errs toward smaller type. A title
that fits at no step uses the smallest, where the renderer breaks an overlong word and
ellipsizes past three lines.

The card's fonts are Newsreader's Latin, Latin Extended and Vietnamese subsets. An article
whose Wikipedia title has characters outside them (Cyrillic, Greek, CJK, emoji) redirects
to the site card instead of drawing missing-glyph boxes, and a description with such
characters is left off.

## Renderer

Takumi (`@takumi-rs/wasm` 2.14) renders the cards. It is a Rust layout and raster engine
compiled to WebAssembly that turns a node tree into an encoded PNG in one call. Workers
refuse to compile WebAssembly from bytes at runtime. The package's `workerd` export
condition resolves `@takumi-rs/wasm/auto` to an import of its `.wasm` file, which wrangler
bundles as a precompiled module. The SvelteKit server build leaves that import for wrangler,
so neither the Vite nor the Wrangler configuration changed. Fonts are the Fontsource WOFF2
files the site already serves, read once per isolate through the assets binding. Each
isolate creates the renderer on first use and retries a failed setup on the next request.

Satori with resvg was the expected choice. Satori 0.33.0 and later depend on harfbuzzjs;
with the current release, 0.35.0, it throws while loading under local workerd (`Cannot read
properties of undefined (reading 'href')`). Satori 0.32.0, the last release without
HarfBuzz, did render with `@resvg/resvg-wasm` 2.6.2 in a bare Wrangler probe, though it was
not taken through this app's build. Staying with Satori would pin a superseded release and
require a workerd check before every upgrade. Satori also reads TTF, OTF and WOFF, but not
WOFF2.

Takumi is the larger option. Its wasm is 3.82 MB, or 1.62 MB gzipped. Satori's standalone
build, Yoga and resvg together come to about 1.07 MB gzipped. Cloudflare's documented
Worker size limit (checked 2026-10-02) is 64 MiB uncompressed, with no compressed limit,
so the difference does not approach a limit. Its costs are deploy size, startup, memory
and CPU, measured under Limits and Validation.

## Rejected alternatives

**Metadata only, with Wikipedia's lead image as `og:image`.** The card would carry no brand,
and crawlers crop arbitrary aspect ratios: portraits lose heads and diagrams lose labels.
Imageless articles would unfurl without an image. Finding the image takes a summary request
while building the page, which puts Wikipedia's latency on every page response.

**Browser Rendering.** A headless browser could screenshot an HTML card with full CSS, but
every uncached card would need a browser session. Cloudflare's documentation (checked
2026-10-02) gives Free accounts 10 browser minutes a day, 3 concurrent browsers and one new
browser every 20 seconds. Paid accounts include 10 browser hours a month, then $0.09 an
hour, and 10 concurrent browsers, then $2 for each additional one. Link previews arrive in
bursts when a link spreads, exactly when concurrency limits bite, and each card would wait
on a browser session instead of an in-process render.

**Image Transformations and the Images binding.** Overlays could composite the mark onto a
photo, but drawn text takes only a font, color and size. With no wrapping, width, line
height or alignment, titles of arbitrary length cannot be set. Local development supports
only width, height, rotation and format, so cards could not be checked offline.
Transformations beyond 5,000 unique a month cost $0.50 per 1,000.

The isolate's existing `card:${title}` summary cache (shared by `/api/card` and
`/api/summary`) is not used for descriptions. It lives in one isolate, is usually cold
when a crawler arrives, and would make a card depend on which isolate answered.

## Upstream requests

A card makes at most two upstream requests: Wikipedia's REST summary through the shared
client with Tangent's User-Agent, and one lead-image fetch. Each has its own 3-second
deadline, which also bounds reading the body. A probe worker in local workerd fetched from
a server that sent its headers at once and then one byte every half second. A 1-second
deadline cut the read off at 1.0 s (n = 3); a 10-second deadline read the whole body.

When the original is at least 960 px wide or is a vector, the card requests Wikimedia's
standard 960 px rendition. Wikimedia rejects hotlinked thumbnails at other widths and
never upscales. If the rendition's URL can't be derived from the summary's thumbnail, the
thumbnail itself is used, so an original wider than 960 px is never fetched. Smaller
originals in web formats are used as they are, and other formats (TIFF, PDF) fall back to
the summary's thumbnail.

Decoded images are capped at 960 × 2,880 pixels. Takumi used up to about 11 bytes of
wasm memory per decoded pixel when measured, and wasm memory never shrinks within an
isolate. A single 4,000 × 4,000 decode peaked at 109 MiB, close to the isolate's 128 MB.
At the cap, the whole renderer peaked at 32 MB, against 9 to 10 MB for a typical card.
The cap is checked twice: against the summary's dimensions before fetching, and against
the fetched file's own header, since the file can change after the summary is cached. The
header check reads PNG, JPEG, GIF (canvas and first frame) and WebP, and refuses a file
whose header it can't read. An image over the cap by the summary's numbers is left off a
card that is otherwise complete. One refused after fetching degrades the card.

Image fetches are restricted to https on `upload.wikimedia.org` and `thumb.wikimedia.org`,
the feed's `WIKIMEDIA_HOSTS`, with no credentials or port. Redirects are followed manually
for at most two hops, and every hop is checked against the same allowlist. Only JPEG, PNG,
GIF and WebP responses are accepted, capped at 4 MiB whether the size is declared or
streamed. Takumi receives the bytes under a name and never fetches anything itself.
Animated GIFs render their first frame.

Upstream error text never reaches a response. A failed or slow summary yields a typographic
card from the requested title, and a failed image yields the card without it. When Takumi
rejects an image it fetched (an unusual encoding, say), the card is rendered again without
the image and cached as degraded. A missing article, an undrawable or invalid title, or a
render failure redirects (302) to `/og.png`.

## Caching

The card URL carries `v`, the `CARD_VERSION` in `src/lib/share/meta.ts`. Crawlers and the
edge cache key on the image URL, so a visual change must bump it; otherwise old cards
persist for days.

The adapter's worker caches responses under the exact request URL. The handler also caches
under the normalized card URL that the metadata uses, so variants such as `Elephant_Island`
or extra parameters share one render. Complete cards are sent with `public, max-age=86400,
s-maxage=604800, stale-while-revalidate=86400`. A card degraded by an upstream or decode
failure gets `public, max-age=300, s-maxage=300`, so it is retried soon. Redirects are not
cached.

A hit under the normalized URL is stored again by the adapter, under the variant's URL with
the same headers. If that second write restarts the entry's lifetime, a card reached
through a variant URL can be served for up to twice as long: about 14 days for a complete
card, 10 minutes for a degraded one. Whether the Cache API restarts it was not verified.
The only purge is a `CARD_VERSION` bump, which retires every card at once.

Each outcome is recorded as a `share_card` Analytics Engine event (photo, text, degraded,
missing, undrawable, invalid, render_failed) with the title, as `feed_served` already does.

## Limits

- `/og` is public and has no rate limit. Each uncached title costs up to two upstream
  requests and a render. The cache absorbs repeats but not unique titles, and a missing
  title redirects without caching, so every repeat costs a summary request. The summary
  request carries the same User-Agent as the feed's Wikipedia calls. A flood of unique
  titles that got that User-Agent throttled would break the feed as well as cards. While
  throttled, every card falls back to the requested title (next item). A Workers
  rate-limiting binding on `/og`, or a separate User-Agent for card requests, would
  contain this. Neither was added.
- When the summary request fails (a timeout, 5xx or 429), the card is drawn from the
  requested title. While Wikipedia is failing, `/og` will set any valid title text on a
  tangent.page card, cached for 300 seconds. Invalid titles still redirect. This fallback
  was a requirement. The alternative is an uncached redirect to `/og.png`.
- Rendering needs more CPU than the Workers Free plan's 10 ms per request. Under bun, a
  photo card took a median 48 ms of CPU (SD 16, n = 12) and a typographic card 30 ms
  (SD 9, n = 12); production hardware and V8 will differ. Workers Paid allows 30 seconds
  by default. The account is on Workers Paid according to
  `docs/specs/2026-06-13-accounts-design.md`, which was not re-checked. On Free, renders
  would fail on the CPU limit instead of redirecting to `/og.png`.
- Wasm memory stays at the largest decode an isolate has done: up to about 32 MB at the
  pixel cap.
- Cards show Wikimedia images without attribution. Some lead images are non-free files
  local to English Wikipedia (`/wikipedia/en/`), which the feed already displays.
- Articles titled outside the font subsets get the site card. Descriptions containing
  such characters, including symbols like →, are left off.
- Title sizing is an estimate. Unusual runs of wide letters can wrap differently, with the
  three-line clamp as the backstop.
- The site card (`static/og.png`) is regenerated by hand from `scripts/og-card.html`.

## Validation

`bun run check` reports no errors or warnings, and 488 tests in 40 files pass, 67 of them
in the six share suites. The route suite stubs the summary loader and the renderer to cover
cache-control selection, the decode fallback, the redirects and the normalized cache key.
The measurements below come from the production build in local workerd (`wrangler dev`
4.147.0) on a Mac. They include Wikipedia round trips from that machine and say nothing
about production CPU time. SD is the sample standard deviation.

| Measurement | n | Median | SD | Range |
|---|---|---|---|---|
| Uncached card, warm isolate | 12 | 92.0 ms | 44.5 | 33.0–176.8 |
| First card in a fresh isolate, photo | 3 | 316.2 ms | 15.5 | 304.9–335.6 |
| Photo card after a typographic card, same isolate | 3 | 209.7 ms | 12.3 | 197.3–221.9 |
| First card in a fresh isolate, typographic | 3 | 190.5 ms | 41.7 | 159.4–242.0 |
| Typographic card after a photo card, same isolate | 3 | 43.1 ms | 2.3 | 40.9–45.5 |
| Same URL again (adapter cache) | 20 | 2.2 ms | 0.4 | 1.7–3.1 |
| Variant spelling (normalized cache) | 10 | 2.6 ms | 0.5 | 2.1–3.9 |

The first card in an isolate takes 100 to 150 ms longer than later ones. That covers
instantiating the renderer, registering fonts and opening fresh upstream connections.
Startup profiles from `wrangler check startup` on an earlier build of this change measured
10.1–12.2 ms before the change and 11.1–14.1 ms after (n = 3 each). The ranges overlap, so
no startup change is claimed. The deploy dry run grew from 1,564.12 KiB (302.88 KiB
gzipped) to 5,390.12 KiB (1,910.56 KiB gzipped), almost all of it the 3,819,847-byte wasm
module.

With Discord's crawler User-Agent, the feed link
`/?reader=Elephant+Island&card=Russian+sloop+Mirny%232` and the map link
`/graph?seed=Plastic+arts` each served one `og:image` and one `twitter:image`, both pointing
at the article's card. `/` and `/about` kept the site card. A script injected through
`seed` fell back to the site card, and quotes and ampersands in titles arrived escaped.
Cards rendered at 1200×630 for photographs (Elephant Island, Plastic arts, Mona Lisa,
Earth from a 12,261-pixel original, Moscow reached from `Москва`), the first frame of an
animated GIF (Newton's cradle), a WebP (WebP), vector renditions (Flag of Japan, the
Python logo), a typographic card (Phatic expression), a 72-character list title,
Llanfairpwllgwyngyll, Pneumonoultramicroscopicsilicovolcanoconiosis and Vietnamese
diacritics (Võ Nguyên Giáp). Each of these real lead images passed the header check. A
nonexistent title redirected to `/og.png`.

Not verified: real unfurls in Discord, Slack, X or iMessage against a deployed URL; the
degraded card and the decode fallback in workerd, which unit tests cover with a stubbed
upstream and renderer; production startup, memory and CPU time.
