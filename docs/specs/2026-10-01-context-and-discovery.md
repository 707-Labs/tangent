# Context and discovery

## Implemented decisions

The strongest failure mode is losing the user's place as reading, exploring, and
saving become separate actions. Browser history therefore holds the open article
and visible feed card with its offset. The reader restores its section position,
including expanded Sources and Quick facts. Older trail waypoints fetch on demand.
Recent tangents have an explicit Resume action on the start page.

Read opens the article. Explore offers up to three unseen, named destinations with
their Wikipedia descriptions and a relationship label supported by existing
metadata. The title list is cached and warmed on hover/focus; errors can be retried.
Choosing a destination appends that exact article. Short metadata cannot always
explain an interesting connection, so the honest fallback is “Related topic.”

The star saves an article to a list accessible from the header. It no longer
changes recommendation weights. Reading and exploring still provide interest
signals. The card overflow offers Less of this and Undo feedback; either refreshes
the candidate buffer while preserving resolved cards and the trail.

Saved articles and recent tangents are stored on this device. They do not sync with
the existing account interest profile. The saved list is capped at 200 entries;
recent tangents retain six trails with up to 200 waypoints each. Storage failure
leaves the current session usable but cannot promise restoration after reload.

The map adds 21 named neighborhoods anchored to real bundled articles, and three
editorial routes with numbered stops. Overview, neighborhood, and article views
give the map several levels of navigation. The first three connections favor
unread, concrete destinations; more remain available in a disclosure. Eight
focused edges keep the canvas readable, while the visit path stays visible.

These neighborhoods are editorial landmarks in the existing fixed atlas. They are
not new semantic clusters, and curated route steps are not represented as direct
Wikipedia hyperlinks. Search continues to reach beyond the sampled collection.
Creating cohesive spatial neighborhoods requires a future offline graph-layout
pass; this change intentionally keeps atlas coordinates stable.

Contents uses real article headings and preserves existing anchors. Inline
citations open a contextual preview with the original reference text, substantive
external source URLs when available, and View in Sources. A print-only citation
receives no fabricated visit link. The reader stores positions for forty articles.

## Concrete directions for better previews (item 6)

These are proposals, not an automatic change to current article excerpts. The
main risk is making a catchy claim that drops qualifications or misrepresents a
source. Start with a small curated set tied to an article revision and section.
Keep the ordinary introduction as a fallback for every other article.

### 1. One sourced detail

Keep the article title and one-line description, then use a compact factual hook
instead of its definitional first paragraph. Selecting Read should land at that
section, with an obvious way back to the top. This is the simplest first experiment:
curate 20–30 articles and compare the whole card against the current excerpt.

| Article | Proposed visible preview | Source section |
|---|---|---|
| Coffee | Sufi communities used coffee to stay awake during religious rituals. | [Historical transmission](https://en.wikipedia.org/wiki/Coffee#Historical_transmission) |
| Silk Road | The trade routes are ancient. The name “Silk Road” was coined in the nineteenth century. | [Name](https://en.wikipedia.org/wiki/Silk_Road#Name) |
| Antikythera mechanism | Turning a crank let its gears track the Sun and Moon and predict eclipses. | [Operation](https://en.wikipedia.org/wiki/Antikythera_mechanism#Operation) |

These are editorial paraphrases verified against the current Wikipedia articles on
2026-10-01, not quotations. Preserve uncertainty in claims about the mechanism's
possible planetary display; the proposed hook deliberately omits that disputed
detail. Before shipping, store the supporting revision and citation with each
curated hook and verify the section anchor still exists.

### 2. A preview connected to the arrival path

When someone reaches Coffee from Sufism, show the coffee-history passage supporting
that connection. Arriving from Coffea instead shows the biology passage. Small
visible context such as “From Sufism” explains the selection without narrating the
button. Read opens at the passage; Contents and Top remain available.

The initial implementation can use the linked article's exact mention to select a
paragraph, retaining its citations. It must fall back to the introduction when the
paragraph is too short, merely a list, or absent. Shared keywords alone do not
prove a relationship. This version needs sanitized section excerpts and revision
tracking, so it is more work than the curated detail set.

### 3. A restrained question above the preview

Try “Why did Sufi communities drink coffee?” or “How did ancient gears predict an
eclipse?” with one short supporting sentence underneath. These are editorial
questions, not a promise that every article resolves a mystery. Avoid questions
that embed unverified premises or “You won't believe…” language.

Test this separately from passage selection so we can tell whether the question
helps. It should use the same sourced record as option 1 and remain visually
quieter than the article title.

## Evaluation

The code and browser checks validate behavior, not an engagement improvement. For
previews, track reading beyond the landing passage, exploration to another topic,
source visits, and immediate return. Saves are a separate intent. Check whether
users can explain the three actions without coaching. Do not optimize only for
clicks on a catchy preview; a rapid bounce is evidence against it.

## Verification

The integrated branch passes 421 tests in 34 files, Svelte checks with zero errors
and warnings, and the Cloudflare production build. Browser checks covered feed
Back/Forward, exact Explore destination selection, Saved persistence and reopening,
cross-route and cross-seed Back, recent-tangent Resume, Less of this with Undo,
Saved Escape without closing the reader, Contents, print-only and linked
citations, expanded Sources restoration, curated-route navigation, and mobile map
connections and reader takeover. Layout checks used 320px, 375px, and 1280px widths.

Reading restoration uses an anchor and offset with a scroll-ratio fallback. Article
edits and images loading above that anchor can still change the eventual position.
No engagement or loading-speed improvement has been measured in this change.
