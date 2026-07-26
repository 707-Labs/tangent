# feed-sim — rabbit-hole journey simulator

A standalone evaluation harness for the feed algorithm. It drives the **real shipped
engine** (`fetchExploreCandidates` → `selectNext` → `buildEngineContext`) over live
Wikipedia, replicating the web client's traversal (`feedState.more` / `#context` /
`#effectiveTip`) and the engagement-profile update logic (`profile.svelte.ts`), so the
numbers reflect production behaviour rather than a reimplementation.

It answers two questions:

1. **Does selective engagement shape the feed toward what the user reads?** — runs an
   _adaptive_ arm (a synthetic reader dwells on / likes on-topic cards, skips off-topic)
   against a no-learning _control_ arm; the lift is `adaptive − control`, which nets out
   topical locality (both arms share it and the same classifier).
2. **How often does a walk drift into the Hitler / Nazi cluster, and why?** — tallies
   cluster landings and logs the full `scoreCandidate` term breakdown at each, so you can
   see exactly which signal pulled it there and whether `isPolitical` fired.

## Run

Requires [bun](https://bun.sh). From this directory:

```sh
bun run sim.ts validate          # ~15 walks from German-history seeds — sanity check the cluster is reachable
bun run sim.ts main 30           # full grid: 660 walks (cold-start + 5 personas × adaptive/control), maxLen 30
bun run analyze.ts main          # aggregate results-main.json → report-main.md (+ stdout)
bun run jumpdist.ts main         # consecutive-card jump-distance report → report-jumpdist-main.md
bun run compare.ts               # diff results-baseline.json vs results-main.json (save a baseline first: cp results-main.json results-baseline.json)
bun run diag.ts "Adolf Hitler"   # inspect how the scorer sees specific cached pages
bun run directions-report.ts main       # direction mix, healed-by-label, drift framing coverage
bun run drift-coverage.ts baseline main # drift nameability across two runs (+ two-proportion CI)
```

## Notes

- **Live Wikipedia.** First run is slow (one Action-API round trip per new article,
  with retry+backoff for 429s). Results are memoized to `cache.json` (gitignored) keyed
  by title and independent of scoring, so re-runs after a config change are fast — only
  newly-reached titles fetch. Delete `cache.json` to force a cold rebuild.
- **Deterministic.** Each journey seeds two `mulberry32` streams (engine + behaviour)
  from `seed|persona|arm|rngSeed`, so runs reproduce. Tune the seed list / personas /
  engagement probabilities at the bottom of `sim.ts`.
- **Imports the engine by relative path** (`../../src/lib/...`) so it runs under plain
  `bun` without a `svelte-kit sync` / `$lib` alias step. It lives outside the tsconfig
  `include` globs, so `bun run check` and the test suite ignore it.
- **Caveat:** the engagement probabilities and the `tasteAffinity`-based on-interest
  classifier are modelling assumptions — read the adaptive-vs-control _lift_ (with its
  CI and n), not the absolute on-interest rate, as the robust signal.

## What it found (2026-07-26): framing the drift break

The previous entry's "next lever" shipped: the drift pick (thin-pool
fall-through) now gets a `driftDirectionBonus` toward candidates holding one
nameable dimension of the broken run, and drift cards render the tangent
divider. Full grid, 660 journeys, against the 0.15 run as baseline:

- **Drift breaks are nameable far more often: 48.0% → 71.9%, +23.9 pp
  (95% CI 21.0–26.8).** Measured by `drift-coverage.ts`, which reconstructs
  each run's era/place context from the stored path and classifies the drift
  pick — the same reconstruction on both files, so the delta is apples to
  apples (the engine records 73.5% on the new run; the 1.6 pp gap is
  reconstruction noise, not a second result). About half of the previously
  unframed far jumps can now be named by the divider.
- **It did NOT shrink the jump.** Drift felt-distance is unchanged on all
  three lenses: cat-token 0.093 → 0.100 (CIs 0.088–0.098 vs 0.096–0.106,
  overlapping), exact-cat 0.028 → 0.029, lexical 0.057 → 0.055. The bonus
  moves the pick far enough to make it *explainable*, not far enough to make
  it *closer*. Naming a leap and shortening one are separate levers; only the
  first shipped.
- **Whether framing reduces skips is UNMEASURED, not zero.** The harness gates
  `healed` on `surprised` (only tangents can heal, matching the client, where
  only surprises are detours), so every drift break reports healed=false by
  construction. Any framed-vs-unframed skip comparison needs the raw per-step
  reaction recorded first — that's the next instrumentation task, and until
  then the reader-facing benefit is a design argument, not a measurement.
- **No invariant moved**: pooled learning lift +4.9% (baseline +5.2%, within
  noise), bimodality preserved (in-run 0.189 [0.185–0.193] vs tangent 0.113
  [0.109–0.117], CIs disjoint), cluster landings 0.0% core / 1.7% any by step
  30, tangent direction mix unchanged (directed 59.1% vs 59.9% — the tangent
  path wasn't touched).
- **Dead ends 43 → 133/660 is a fetch artifact, confirmed by instrumentation
  rather than assumed**: `deadEndKind` is `fetch-failed` for 100% of them in
  both runs (zero `engine-exhausted`, zero `no-links`), and this run made
  2,413 live fetches against the baseline's 798.

## What it found (2026-07-25): directional share tuning

Full grid on the directional-tangent engine, baseline (directionWildShare 0.25)
vs tuned (0.15), same night, same harness, 660 journeys each:

- **Wild tangents are the worst-received class.** Baseline healed (fast-skip)
  rates: era 39.2% (n=222), place 40.1% (n=725), theme 37.6% (n=1012), wild
  43.1% (n=1621) — the direction labels aren't lying, and unframed jumps get
  skipped most. Wild also held 45.3% of tangents against the 25% deliberate
  share: thin directional pools force it (era starved at 6.2%).
- **Lowering the deliberate wild roll 0.25 → 0.15 shifted share to the better
  classes**: directed 54.7% → 59.9%, healed-rate gap directed-vs-wild widened
  (34.2–38.4% vs 44.9%). Overall tangent healed rate 40.7% → 39.8% (direction
  right, size within noise).
- **No invariant moved**: bimodality identical (in-run 0.191 vs tangent 0.116,
  CIs disjoint), zero cluster landings by step 5, pooled learning lift +5.2%
  vs baseline's +4.9% (within noise). Dead-ends fell 142 → 43/660, but the
  baseline run fought live-fetch throttling (2,573 fetches vs 798) — a fetch
  artifact, not the config change.
- **Untouched gap, next lever:** drift breaks (thin-pool fall-throughs) are
  37.6% of all run breaks, jump the farthest (cat-token 0.094 vs 0.115 for
  deliberate tangents), and render unframed. Framing or direction-biasing the
  drift pick is the highest-value remaining leap-feel work.

## What it found (2026-07-17): run-based engine validation

Full grid on the run-based engine (complete categories in cache; both engines
measured the same night, same harness):

- **Bimodal jump distance achieved.** In-run picks vs tangents, non-overlapping
  CIs on all three lenses (cat-token 0.187 [0.184–0.191] vs 0.117 [0.113–0.122];
  lexical 0.170 vs 0.070; exact-cat 0.073 vs 0.027). Old engine: no separation
  (0.113 vs 0.124, inverted). The post-tangent snap-back class is gone — the card
  after a tangent is now as coherent with it as any in-run pick (cat-token 0.166
  vs the old 0.082).
- **Attractor safety improved.** Cold-start WWII/authoritarian cluster drift 0.0%
  (was 1.7%); zero core-cluster landings in 660 journeys, 7 broad-tier total.
- **No walk-length regression.** Excluding fetch-failure artifacts (instrumented
  via `deadEndKind` after a 429-heavy cold run read as 75% dead ends), real
  engine dead ends: 0 of 562; walks run to the 30-card cap.
- **Learning lift did not regress**: pooled adaptive−control +3.5% ±~3 (old
  engine same-night baseline: +1.7% ±~2.7 — difference within noise). Absolute
  on-interest rose in both arms (control 18.2% → 22.0%): coherent runs improve
  topical locality independent of learning.
- **Honest gaps:** (1) tangent jump size is bounded by candidate generation (one
  link hop from the tip) — a "farther tangent source" is future work if felt
  bigness matters; (2) cold-start first breaks are guaranteed (100% within 5
  cards) but only 48% clear the hook gate (rest drift) — mainstream seed pools
  are intrigue-poor, so the first break often lands unframed.

## What it found (2026-07-16): jump distance

`jumpdist.ts` measures reader-felt topical jump between consecutively shown cards
(category Jaccard, era/region-aware category-token Jaccard, lexical Jaccard), run
against the full grid (660 journeys, 18,379 transitions) as the diagnosis gate for
`docs/specs/2026-07-16-run-based-feed-design.md`:

- **The felt-jump distribution is unimodal with no close/far separation.** A normal
  top-K pick and a deliberate surprise are the same felt size on every lens
  (cat-token mean 0.113 [CI 0.109–0.116] vs 0.124 [0.113–0.135]; lexical 0.102
  [0.100–0.104] vs 0.093 [0.087–0.099]; direction inconsistent across lenses).
  Median exact-category overlap between consecutive cards is **zero** — "one link
  hop" is not topical closeness. This confirms the spec's premise directly.
- **The single farthest jump in the system is the unframed snap-back after a
  detour.** Post-surprise transitions (next card built from the pre-surprise tip)
  are the most distant on all three lenses (lexical 0.049 [0.044–0.054] vs 0.102
  normal) and nothing in the UI explains them. At the steady 18% epsilon, ~1 in 6
  cards is followed by one. The run model's re-root-at-boundary design removes
  this class of jump entirely (heals excepted).
- **Candidate categories are truncated at fetch.** Only 63% of served cards carry
  a non-hidden category; cache-wide, empty-category rate climbs from 18% at
  candidate index 0 to 67% at index 49 (0 of 10,336 parents all-empty — a
  per-request membership budget exhausting mid-batch, not a schema artifact).
  Root cause, verified live: with `clshow=!hidden`, an exhausted category scan
  reports `batchcomplete` and offers NO continuation — silent truncation. Fixed
  in `action.ts` (2026-07-16) with a dedicated chunked category pass using
  `clprop=hidden` + client-side filtering; `enrich-categories.ts` backfills the
  sim cache to match.

## What it found (2026-06-13)

Diagnosed two issues, both fixed in `e227f39`:

- The `−500` political penalty was **~0% effective** against the WWII/Nazi attractor
  (fired on 0 of 337 cluster landings — real candidates carry no electoral stem). Adding
  `AUTHORITARIAN_STEMS` cut cold-start any-cluster drift **20% → 1.7%** and the Hitler/Nazi
  core **3.3% → 0%**.
- Implicit engagement learning shaped the feed only weakly at `relevanceWeight 2.5`
  (pooled lift +1.2%, within noise). Raising it to `4.0` lifted it to **+6.5%** (now
  separated from control) with healthier, longer walks. science/tech stay flat — a
  link-graph topology limit, not a scoring one.
