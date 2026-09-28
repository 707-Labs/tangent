# Three-lever cold-start simulation — findings

Tested the three "high-ROI" feed levers from the deep-dive against the real shipped engine
(`fetchExploreCandidates` + `selectNext`) over live Wikipedia, via the `feed-sim` harness.
Grid: 6 seeds (Octopus, Coffee, Jazz, Volcano, Chess, Bioluminescence) × 3 personas
(nature, history, culture) × 4 RNG seeds, maxLen 25 → 168 journeys/config (72 adaptive tuples).

## Headline

| Lever | Change | Adaptive ΔOI | Adaptive ΔTTR (diversity) | Verdict |
|---|---|---|---|---|
| (c) relevance | rw 4.0→5.0, ÷2→÷1.5 | **+4.55pp ± 3.83** | **−2.47 ± 1.75** | relevance↔serendipity trade |
| (c) relevance | rw 4.0→6.0, ÷2→÷1.0 | **+7.05pp ± 4.65** | **−3.66 ± 1.70** | same trade, pushed harder |
| (b) TARGET_EXPLORE | 14 → 20 | +0.44pp ± 3.73 | — | minimal — null |
| (a) stemming | Porter stem in tokenize | −4.22pp ± 5.59 | — | does not help; leans negative |

ΔOI = paired per-tuple (variant − baseline) on-interest rate, adaptive arm. CI = 95%.
ΔTTR = paired change in type-token ratio of served descriptions (topical diversity; lower = more bubble).
Control-arm placebo (no engagement): exactly **0.00pp** for (c) — proves the OI effect is entirely
through the learned vector — and −1.45pp for (a) (stemming isn't relevance-only; it perturbs DF
and variety even with no learning, so the learning-specific effect is ≈ −2.8pp, still within noise).

**No lever is an unqualified win.** (c) is the only one that moves on-interest, but it does so by
trading topical diversity 1:~1.9 (both effects dose-dependent and CI-clean) — it's a *focus-vs-wander
dial*, not a strict improvement. (a) and (b) don't help. The two "cheap wins" from the deep-dive
((a) stemming, (b) pool width) were both wrong; the relevance lever works but isn't free.

## Method notes / the one big gotcha

- **Metric of record = paired per-tuple ΔOI** (not independent-sample lift). The harness is
  seed-matched, so the same `(seed,persona,arm,rng)` tuple starts identically across configs;
  pairing strips between-walk variance that otherwise buries a few-pp effect. `paired.ts`.
- **Cold-cache rate-limit artifact (severe).** First-pass cold runs hammer Wikipedia; 429s make
  `fetchExploreCandidates` return empty → walks falsely "dead-end". Cold baseline: 93/168
  dead-ends, mean len 15.3. Identical config on a **warm** cache: 15/168, mean len 24.2. All
  numbers above are from warm-cache re-runs. `COMPLETED_ONLY=1` (tuples where neither walk
  dead-ended) corroborates each sign.
- **On-interest classifier = `tasteAffinity>0`** (regex on raw text) — invariant to all three
  levers, so lifts are comparable. It's a modeling assumption; read ΔOI directionally vs the
  control placebo, not as an absolute.

## Per-lever detail

### (c) relevance weight × tanh divisor — a focus↔serendipity dial
On-interest: clean monotonic dose-response (+4.55pp → +7.05pp), CIs exclude zero, control placebo
exactly 0.00 / 0 tuples changed — byte-for-byte identical with no engagement, confirming relevance
is inert at literal cold start since tanh(0)=0.

Diversity (the counterweight, `diversity.ts`): higher relevance measurably *lowers* topical
type-token ratio of served descriptions — ΔTTR −2.47 (rw5) → −3.66 (rw6), both CI-excludes-zero
and dose-dependent. So the OI gain is bought at a serendipity cost of roughly 1:1.9 (OI-pp gained
per TTR-point lost), constant across the two settings → a linear trade, no free lunch. This is the
exact axis the config comment balances relevance against (position + specificity).

Recommendation: treat rw as a tunable dial, not a default bump. The smaller setting (rw5/÷1.5) is
the conservative point; if pushed, pair with a variety/novelty guard, or expose it as a user-facing
"focus vs wander" control. For Tangent's rabbit-hole ethos, the diversity cost is not incidental.

### (b) TARGET_EXPLORE 14→20 — refuted premise
The original rationale ("widen the pool, unstarve surprise") was based on a misread: TARGET_EXPLORE
is a **switch, not a pool size**. Measured pool: median **42**, cap(50) hit 10% of the time. The
lever only adds related top-ups to articles with 14–19 lead links — the `<20` pool fraction drops
12%→1%, but median and cap-rate are unchanged. Cold-start cluster drift identical (4.2%→4.2%).
Adaptive ΔOI null (+0.44pp). The pool was never starved.

### (a) Porter stemming — does not help
Vendored Martin Porter reference stemmer (`porter.ts`, validated 79/80 canonical pairs).
Adaptive ΔOI −4.22pp (all) / −3.20pp (completed-only), CI crosses zero → no help, leans negative.
Hypothesised mechanism (unverified): collapsing the vocabulary raises per-stem document frequency,
and DF-discounting `w/(1+ln(1+df))` then *weakens* each token's relevance contribution.

## Follow-up: positionWeight (a cold-start lever — the rare one that works without engagement)

Position (2.4) is the dominant cold-start signal and competes directly with specificity (the
earliest lead links are the broad "X is a category" parents). Lowered it on the no-learning
control arm (n=96 cold-start walks); warm-cache, dose-response:

| positionWeight | mean position served | mean specificity served | TTR | dead-ends | cluster |
|---|---|---|---|---|---|
| 2.4 (base) | 7.64 | +0.55 | — | 0/96, len 25.0 | 4.2% |
| 1.8 | 10.04 (Δ+2.40) | +0.66 (Δ+0.115 ± 0.047) | −0.97 ± 1.38 | 15/96, len 23.0 | 6.3% |
| 1.4 | 11.40 (Δ+3.77) | +0.70 (Δ+0.155 ± 0.045) | −0.69 ± 1.35 | 10/96, len 23.5 | 5.2% |

Lowering position reaches deeper lead links AND serves modestly more concrete cards (specificity
Δ CI excludes zero, dose-dependent) — it does climb slightly out of abstraction sinks, *and it
works at literal cold start* (no engagement needed), unlike the relevance lever. Diversity neutral.
Costs are small: walks ~2 cards shorter, a few more dead-ends (partly residual cold-frontier
artifact), and possibly a hair more cluster drift (4.2%→6.3% at 1.8, small-n / likely noise).
NOTE: the pass-1 (cold) read showed specificity flat (+0.05) — that was contaminated by truncated
walks dying before reaching the deeper specific cards; the warm number (+0.115) is correct.

Verdict: a real but modest cold-start improvement. It's an indirect way to let the existing
specificity term express more; raising `specificityWeight` directly is the more legible knob for
the same goal — tested next, and it wins the head-to-head (see below). Conservative position setting
(1.8) is the sweet spot if you tune position instead. Position is the most promising lever for the
new-user feed *among the un-tapered signals*, precisely because relevance is inert there.

## Follow-up: specificityWeight (the cleaner knob — chosen, shipped to config at 2.0)

Direct test of the "raise specificity instead of lowering position" hypothesis. Same n=96 cold-start
control grid, same warm cache (specificity only reorders the title-keyed pool, so `results-pos24`
is a valid shared baseline; reused). Swept `specificityWeight` 1.5 -> {2.0, 2.25, 3.0}.

Cold-start control walks (n=96 paired vs pos24 baseline = position 2.4 / specificity 1.5):

| lever | Δ concreteness (specServed) | Δ lead-depth (posServed) | ΔTTR×100 (diversity) | dead-ends | cluster |
|---|---|---|---|---|---|
| **spec 1.5→2.0** (shipped) | **+0.141 ± 0.042** | **+1.07 ± 0.61** | −2.77 ± 1.39 | 7/96 | 5.2% |
| spec 1.5→2.25 | +0.184 ± 0.044 | +1.45 ± 0.55 | −3.44 ± 1.39 | 8/96 | 5.2% |
| spec 1.5→3.0 | +0.327 ± 0.047 | +3.06 ± 0.63 | −5.42 ± 1.47 | 11/96 | 8.3% |
| *(pos 2.4→1.8, for compare)* | *+0.115 ± 0.047* | *+2.40 ± 0.54* | *−0.97 ± 1.38* | *15/96* | *6.3%* |

**Matched-dose head-to-head (the discriminating result).** At essentially equal concreteness gain
(spec2.0 +0.141 vs pos1.8 +0.115), raising specificity displaces lead-depth **less than half** as
much (+1.07 vs +2.40) and produces **half** the dead-ends (7 vs 15). It targets concreteness
*directly* instead of buying it as a side effect of going deeper. But it is **not free**: it costs
~3× the cold-start topical diversity (ΔTTR −2.77 vs −0.97). The two levers buy concreteness in
different currencies:
- **Position is content-blind** — reweights by lead-position only. Lowering it lets *any* deeper
  link win → topically varied (no diversity loss) but drags in thin/listy links → dead-ends.
- **Specificity is content-aware** — rewards HAS_YEAR/NAMED, penalizes ABSTRACT/LISTY/continental.
  → fewer dead-ends, far less depth-shift, but narrows toward a *kind* of card (dated/named, which
  skews history/biography) → a mild topical bubble.

So the "cleaner knob" hypothesis is **half right**: specificity is more *surgical* (less depth, fewer
dead-ends, hits the target directly), but it has its *own* cold-start cost (diversity) rather than no
cost. Dose-dependent and CI-clean — a contained trade at 2.0, the relevance-lever bubble failure mode
at 3.0.

**Engaged-user safety (adaptive arm, n=72).** The diversity cost is **cold-start-only**: adaptive
ΔTTR ≈ 0 (spec2.0 −0.59 ± 1.89, spec2.25 +0.15, spec3.0 −2.02 ± 2.21) vs control −2.77/−3.44/−5.42.
The relevance taper `1/(1+r)` (score.ts) plus the relevance term's own topical spread absorb the
narrowing once a user engages. On-interest is unharmed (pooled ΔOI ~−4pp, CI spans zero, dose-
insensitive) — except the **culture** persona (−11 to −12pp): specificity's dated/named bias pulls
culture-interested readers toward history/biography. Note: the taper does *not* null Δspecificity on
the adaptive arm (+0.124 → +0.333) — simulated engagement builds only mild relevance, so the taper
attenuates but doesn't zero the term. Contrast position: pos1.8 *also* shifts the engaged feed
(adaptive Δposition +1.80 ± 0.67, CI excludes zero) because it is un-tapered — it changes everyone's
feed, not just the cold-start one.

**Decision: ship `specificityWeight` 1.5 → 2.0.** Better knob than lowering position for the cold-
start concreteness goal — same concreteness, fewer dead-ends, less depth-shift, and the one cost
(diversity) self-confines to cold start via the taper, leaving engaged users untouched. Held at 2.0,
not pushed: 3.0 reintroduces the diversity/cluster-drift bubble. A future split (e.g. spec 1.9 +
position 2.1) could share the cost across both currencies, but isn't needed.

## Caveats
- Small grid (72 adaptive tuples / 96 control); CIs ±4–7pp on OI, ±0.04–0.06 on specServed. The
  specificity dose-response (concreteness up, diversity down, both monotonic and CI-clean across
  2.0/2.25/3.0) and the matched-dose depth/dead-end gap vs pos1.8 are the most robust results.
- The relevance-tapered diversity result depends on the sim's engagement model (dwell 0.2 / occasional
  like) producing only mild relevance; a heavier-engaging real user would see the taper bite harder
  (smaller Δspec, smaller diversity cost) — directionally the same, magnitude uncertain.
- `porter.ts` is vendored but NOT wired into the engine (tokens.ts reverted to baseline).
- Only change to engine source: `specificityWeight` 1.5 → 2.0 in config.ts (the shipped decision).
  All other levers reverted to pristine; harness files changed (`sim.ts`, `paired.ts`, `posanalyze.ts`).
