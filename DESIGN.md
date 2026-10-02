# Tangent Design Manifest

> This file is the design source of truth for AI-assisted development.
> When generating or modifying UI, read this file first.

---

## Design Philosophy

**Nightstand** — a warm, brown-black dark theme that reads like a book by lamplight.
Tangent is a Wikipedia rabbit-hole feed; the surface should feel editorial and calm, never
app-y or neon. The palette is warm neutrals on a near-black ground, lit by a single faint
wash from the top (lamplight, not glow). There is exactly **one ember accent** — reserve it
for the branded moment (logo touch-point, link/CTA hover); it is a highlight, not a fill.
A sage "spark" tone marks serendipity/discovery, a warm coral marks "like".

Type is the design: **Newsreader** (serif) carries headings and long-form reading;
**Hanken Grotesk** carries the UI. Iconography is a deliberately geometric node/edge/point
vocabulary echoing the brand mark (a line going off on a tangent).

**Hard nos:** no purple, no cyan, no glassmorphism, no Inter. Every text token clears WCAG AA
on its own background (the High Contrast theme clears AAA).

---

## Technical Constraints

| Constraint | Value |
|---|---|
| Framework | SvelteKit (Svelte 5 runes — `$state`/`$derived`/`$effect`/`$props`) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@theme`) + CSS custom properties; utilities compile to `var(--color-*)` |
| Component Library | None — `@lucide/svelte` for icons; components are bespoke |
| Tokens | CSS custom properties in `src/app.css` (`@theme` block) |
| Theming | System, Light, Dark, and High contrast; registry in `src/lib/theme/themes.ts` |
| Fonts | Self-hosted via Fontsource (no Google Fonts request) |
| Deploy target | Cloudflare Workers (`@sveltejs/adapter-cloudflare`) |

The `@theme` block IS the default theme (Nightstand). Re-declaring its `--color-*` variables
under `:root[data-theme='…']` re-skins the whole app at runtime with zero component changes.

---

## Design Tokens

Defined in `src/app.css`. **Always use these tokens — never hardcode color, font, radius, or
shadow values.** Tailwind generates the utilities from the `@theme` block:
`--color-void` → `bg-void`/`text-void`/`border-void`, etc.

### Colors — Surfaces

| Token | Utility | Nightstand value | Role |
|---|---|---|---|
| `--color-void` | `bg-void` | `#15110c` | Page background (also the chrome tint) |
| `--color-surface` | `bg-surface` | `#1f1a13` | Card / panel surface |
| `--color-surface-2` | `bg-surface-2` | `#2a2319` | Raised / hover surface |
| `--color-hair` | `border-hair` | `#342d22` | Hairline borders |
| `--color-hair-strong` | `border-hair-strong` | `#473d2e` | Stronger dividers |

### Colors — Text

| Token | Utility | Nightstand value | Role |
|---|---|---|---|
| `--color-ink` | `text-ink` | `#ece4d6` | Primary text, headings |
| `--color-muted` | `text-muted` | `#a89c8a` | Secondary UI text |
| `--color-faint` | `text-faint` | `#9b8f76` | Tertiary / legal small-print (AA floor) |
| `--color-read` | `text-read` | `#cdbfa6` | Long-form reading body (brighter than muted, dimmer than ink) |

### Colors — Accents

| Token | Utility | Nightstand value | Role |
|---|---|---|---|
| `--color-accent` | `text-accent` | `#e0a14e` | The ember — branded moment, hover, links |
| `--color-accent-soft` | `text-accent-soft` | `#c8893a` | Pressed / darker accent |
| `--color-spark` | `text-spark` | `#86b39a` | Sage "serendipity"/discovery tone |
| `--color-like` | `text-like` | `#e0644a` | Warm "like" |
| `--color-danger` | `text-danger` | `#f3766b` | Error / alert text |

### Typography

| Token | Value | Role |
|---|---|---|
| `--font-display` | `'Newsreader', ui-serif, Georgia, …` | Headings + long-form reading (serif) |
| `--font-body` | `'Hanken Grotesk', ui-sans-serif, system-ui, …` | UI (sans). Set on `body`. |

### Borders & Shadows

| Token | Value | Role |
|---|---|---|
| `--radius-card` | `0.875rem` | Card corner radius (`rounded-card`) |
| `--shadow-card` | `0 10px 30px -18px rgba(0,0,0,.85)` | Card drop shadow (re-toned softer per light theme) |

Spacing, breakpoints, and most radii come from **Tailwind defaults** — there are no custom
spacing/breakpoint tokens. Component properties include `--tl-spine` (timeline) and
`--app-header-height` (measured reader clearance). Motion primitives are keyframes in `app.css` (`slide-from-right`, `wh-rise`,
`wh-fade`, `wh-shimmer`, `wh-land`); all motion is gated by `@media (prefers-reduced-motion)`.

### Themes

Four appearance choices keep the picker compact: System, Light, Dark, and High contrast.
`system` resolves to the existing `nightstand` / `daylight` palettes from the OS.
Theme choice is device-local, not synced. Retired preferences migrate to the corresponding
light or dark default in both the prepaint script and runtime.

| id | Label | Mode | Page bg | Notes |
|---|---|---|---|---|
| `nightstand` | Dark | dark | `#15110c` | Default, the canonical `@theme` palette |
| `daylight` | Light | light | `#f5efe3` | Warm paper, ink-on-cream |
| `high-contrast` | High contrast | dark | `#000000` | Bright amber with strong contrast |

Adding a theme = one entry in `themes.ts` + one `:root[data-theme='…']` block in `app.css`
(+ the inline no-flash map in `app.html` only if it's a new `system` default).

---

## Layout & Navigation

Layout defined in `src/routes/+layout.svelte`.

**Navigation pattern:** sticky **top bar** (full-bleed border, inner row constrained to the
reading column). Header holds the BrandMark (home), Saved, a visible Sign in/Account action,
Settings, and a "New tangent" CTA. The graph shortcut appears on wider header rows and remains
available in Settings on phones. The Account drawer also holds **History**: the articles you've
reached in the current tangent. It is device-local, so it shows whether or not you're signed in.
Choosing an entry scrolls the feed back to that card, or, from another page, returns to the feed
at that card. A footer carries Wikipedia attribution (CC BY-SA 4.0) + About / Terms / Source links.

**Header overflow:** the page never scrolls sideways, whatever the header holds.

- The app root clips horizontal overflow (`overflow-x: clip`), so no descendant can widen the
  document. Keep it there rather than `overflow-x: hidden` on `html`/`body`: `clip` makes no
  scroll container, so the sticky header and window scrolling are unaffected, and fixed or
  top-layer UI (drawers, previews, lightbox) is not clipped.
- The clip is a backstop, not the layout. The header row is a size container
  (`@container/header-row`) and gives way in order as it narrows: the wordmark goes first (the
  brand slot gets only the width the actions leave over), then the "New tangent" label (rows
  under 24rem), then the Sign in/Account text becomes an icon (rows under 16rem). The graph
  shortcut needs a 38rem row. If the actions still don't fit, they wrap onto a second line;
  nothing is clipped.
- New header items go in the actions group as icon buttons with an `aria-label` and `title`,
  `shrink-0`, and a 44 px touch target on coarse pointers (`icon-btn` or `size-11`). A text
  label collapses on a `@min-[…]/header-row:` variant, never a viewport breakpoint, and the
  control keeps its accessible name. CSS can't measure sibling widths, so only the wordmark
  collapse responds to content: after adding an item, check that the stock header stays on one
  line at 320, 375 and 390 px, and raise the label thresholds if it wraps.

**Shell width:** content is a narrow reading column (`max-w-2xl`). Opening the article reader
morphs the shell into a two-pane split (`lg:max-w-7xl`) via a one-shot `transition-[max-width]`
(reduced-motion snaps it). Safe-area insets are honored (`env(safe-area-inset-top)`).

### Routes

| Route | Description |
|---|---|
| `/` | The infinite feed: read connected previews, choose an Explore destination, save articles, or give explicit feedback; open the reader. History (Account drawer) returns to any card you've reached. Browser history preserves article and feed position. |
| `/start` | New tangent: search Wikipedia or pick from "Today on Wikipedia" (featured / DYK / on this day / news / trending) to seed a fresh feed. Recent tangents have explicit Resume links. |
| `/graph` | A full-window constellation of real articles in seven topic regions, laid out from their links. A static snapshot supplies articles, previews, connections and positions. The overview names the regions; zooming in names more articles. Each name shows across a fixed zoom range, so panning never changes which names show. Selecting a bundled article shows its preview and known links immediately. Search also imports articles beyond the atlas. Focused connections keep exploration readable; dotted paths show visits. Drag, wheel, trackpad, pinch, keyboard and zoom controls navigate the canvas. Read in place or start a feed from the selection. Without `?seed=`, it resumes the feed's chain tip when available. |
| `/about` | Static page — what Tangent is, where content comes from, licensing and privacy. |
| `/terms` | Terms of Use + Privacy in one plain-language page. |
| `/auth/verify` | Magic-link verification landing (sign-in token check; shows recovery copy on a spent/expired link). |

The start page prioritizes search, immediate surprise, and topic choices above daily
picks. Search dismisses on Escape or blur and selects only results matching the
current query. Daily picks enrich surprise only once available.

Feed cards center images between the heading and a five-line preview, preserve their
aspect ratio, and omit repeat Wikimedia files within a tangent. A single compact
action row gives Read primary weight, Explore a quieter text treatment, and an
saved-article star at the end. Explore opens up to three named destinations with
descriptions and supported relationship labels. Saved articles are retrievable
from the header; reading and exploring still inform suggestions. Less of this
and Undo feedback live in the card overflow. Explanations appear on hover or keyboard focus, with
descriptive accessible names and 44 px touch targets.

Reader Contents jumps to real headings; citation previews keep source access near
the passage. Reading positions restore with open Sources and Quick facts. Feed
history stores a visible waypoint and offset to survive the reader's width change.
In the two-pane layout the article's feed card sits beside the reader, so the reader
drops a lead image that repeats the picture that card is showing. Phones, the graph,
and articles whose card shows no matching picture keep the lead image.
Saved articles, recent tangents, History, map visits, and reading positions are device-local.

The map uses the whole viewport below the app header. Desktop selections sit beside
the canvas; phones use a bottom panel. The opening view fits the whole map below the
search and orientation panels. Every point represents a real article in the loaded
collection, sized by its links, and linked articles sit together
(`docs/specs/2026-10-02-constellation-map.md`). A soft haze marks each region at the
overview and recedes as a region fills the view. Region names sit on a blurred shadow
and slide inward rather than clip at the sides. Names never overlap, and zooming in
only adds names. Local search reaches bundled articles immediately, and Wikipedia
search extends the map beyond that sample. Connections stay focused on the selection.
Long moves pull back and close in; wheel notches and zoom buttons glide about the
pointer, trackpad scrolls pan, and pinches zoom directly. Reduced motion jumps instead.
Browse lists each region's neighborhoods, each starting at a landmark article, and
three editorial routes with numbered stops. Three ranked connections lead each
selection, with more in a disclosure. A visually hidden list mirrors the names in
view for keyboard and screen-reader users. The reader replaces the map controls
while open on a phone and stays within the viewport at every scroll position.

---

## Components

Components live in `src/lib/components/` (flat, no domain subdirs). Grouped by role:

- **Feed & reading** — `ArticleCard` (centered media, a five-line preview, compact Read / Explore actions and a save star; joins the trail on first view), `ExplorePanel` (three named destinations), `SavedPanel` (retrievable saved articles), `ArticleReader` (full article, Contents, Quick facts, citation previews and Sources; desktop pane follows measured header height), `SkeletonCard` (feed-card loading placeholder), `ActionHint` (one-time explanation of reading, exploring, and saving), `LinkPreview` (hover peek of an in-article link — pointer-fine only, inert on touch).
- **Trail & connections** — `TrailHistory` (History in the Account drawer: the articles you've actually reached; jump back to waypoints), `ConnectionBreadcrumb` ("came from" link back to a card's source), `RelationIcon` (geometric icon for a connection's relation type — the shared node/edge/point vocabulary).
- **Brand & chrome** — `BrandMark` (wordmark + tangent-line logo with the lone ember dot at the touch-point), `Drawer` (accessible native `<dialog>` slide-in panel primitive; focus-restoring close).
- **Settings & account** — `ProfilePanel` (Settings drawer: compact account shortcut, appearance, feed flavor, learned interests), `AccountPanel` (dedicated sign-in/account drawer, with History below), `AccountSection` (shared account forms), `ThemePicker` (four compact appearance choices).

---

## Share Cards

Feed and article-map links (`/?seed=`, `reader=`, `card=`; `/graph?seed=`, `reader=`)
unfurl as the article they point at. Every other page shares the site card,
`static/og.png`, drawn from `scripts/og-card.html`. Article cards come from
`/og?title=…&v=N` at 1200×630 in the site's language: the BrandMark lockup at header
proportions, the title in Newsreader, Wikipedia's short description in Newsreader italic,
and the lead image in a rounded panel. Photographs fill the panel; diagrams and maps sit
whole. Articles without a usable image get a typographic card anchored by a large ghost of
the mark. The ember stays on the mark's dot. Crawlers cache cards by URL, so bump
`CARD_VERSION` in `src/lib/share/meta.ts` with any visual change. Rationale and limits:
`docs/specs/2026-10-02-share-cards.md`.

---

## Maintaining This Document

When new design decisions are made:

1. Update this file, not Figma.
2. Add decisions under the appropriate section.
3. Run `/design-ctx sync` to refresh auto-detected sections (tokens, components, routes).
4. Keep descriptions intent-focused, not pixel-focused.
