# Exploration redesign

## Decisions

The feed's old thumbnails left empty space between the heading and excerpt. Images
now sit in a centered, bounded row with their original aspect ratio; previews stop
after five lines so reading and steering remain reachable. Read article opens the
full text. Follow related adds a connected topic. Remember interest changes future
suggestions independently of navigation.

Repeated Wikimedia files appear once per tangent, using repository, file name, and
page identity rather than thumbnail width. Article metadata remains intact. Unknown
image URLs only deduplicate on an exact match; visually similar photos stored as
different files are not detected. An exhausted image relinquishes its presentation
slot so a later card can try the same file.

Small Wikimedia thumbnails request a 500 px variant and fall back to the supplied
URL on failure. A live Parthenon check returned 400 for 640 px and 200 for 500 px;
this verifies one file, not every renderer or image format. Geometry tests preserve
SVG suffixes, multipage identity, and existing large or invalid-dimension inputs.

The first automatic hop gets a soft penalty for a narrow process facet that repeats
the full seed title, corroborated by its description. This addresses Coffee to
Coffee preparation without suppressing all shared-word relationships. Explicit
related steering and later hops are exempt. The weight is a conservative heuristic,
not an experimentally measured engagement improvement.

The reader follows the measured header height and scrolls citations and Sources
within its own body. Tall lead images have a viewport-relative height limit and
still open at full size. Quick facts keep real table geometry for nested or spanned
rows. Source actions use original substantive publication URLs, retain citation
text and anchors, and avoid inventing links for print-only references. Explicit
bibliography lists remain visible and receive the same source actions.

Renderer responses use a shared version in the request URL and server cache key so
previously cached HTML cannot hide presentation changes after a release.

The map fills the window and begins with seven topic regions containing 42 real
article landmarks. Wikipedia search brings other articles into the map. Selecting
a node moves the camera immediately; summaries and connections load locally. First
placement stays stable, including redirect aliases. Solid edges show the focused
article's discovered connections; dotted edges preserve the ordered visit trail.
Background stars are decorative and are never clickable articles.

## Bounds and limitations

- This is an on-demand map, not a downloaded spatial index of all Wikipedia.
  Topic regions are entry points; newly imported positions do not claim a global
  semantic embedding.
- The client retains up to 1,200 nodes, culls to 250 visible nodes and 36 labels,
  draws up to 30 focused connections and 12 recent visits, and retains 64 completed
  summaries and neighborhoods each. Long exploration may discard older non-hub nodes.
- A shared FIFO queue permits four active graph requests; two speculative
  neighborhood acquisitions share that budget with foreground requests. Requests
  time out after 18 seconds in flight. Teardown rejects queued jobs and aborts active
  jobs; failures remain retryable.
- No speedup percentage or engagement lift is claimed. Loading improvements here
  concern reuse, bounded work, and immediate local interaction.

## Validation

369 tests in 26 files pass; Svelte check reports zero errors/warnings and the
Cloudflare production build succeeds. New regressions cover image identity and
fallback geometry, first-hop process ranking and related API semantics, redirect
merging, true visit order, camera framing/zoom, bounded acquisition and teardown,
source links, bibliography preservation, and table/caption markup.

Browser checks at 320/375 px and 1,280 px found no horizontal overflow. The
Parthenon appears once after diving from Ancient Greek architecture into Ancient
Greece. The desktop reader stays below the header at deep feed scroll positions;
native source navigation preserves the feed scroll. Third Intermediate Period of
Egypt retains its map caption and nested facts. On a phone the map reader's title
and close button remain above the app header. Map search, redirected USA selection,
drag/keyboard pan, overview, and responsive camera framing were checked against
actual Wikipedia responses.
