# Handoff: politics flag (option 1, then B) — 2026-11-13

Branch `feat/politics-model`, pull request https://github.com/707-Labs/tangent/pull/15.
**No merge or deploy is authorized.** Each needs Tanner's own words. An independent
review is owed before merge.

## Tanner's decisions (his words)

1. "tangent option 1 and no LLM rule may change." Option 1: an article is political when
   the Workers AI model OR the old word rules (stem regex) say so. Recorded in
   `docs/specs/2026-07-16-run-based-feed-design.md` (Goals).
2. "B": after the first simulation showed the model flags history (for example "Roman
   Empire" in 177 of 250 pools), narrow the model to current politics and test again.

## What B asks for

- A definition of "current politics", written down as an **agent proposal for Tanner to
  confirm**, with ten borderline examples.
- Keep option 1 (model OR word rules) and the failure behaviour exactly.
- At least 150 articles from real candidate pools, labelled by the definition
  independently of the model, plus a blind second labeller. Report agreement, and the
  precision and recall of the word rules, the first prompt (v1) and the new prompt (v2).
- Re-run the 660-journey paired feed simulation. Report the same measures with
  intervals, plus the history reader's on-interest rate, and say whether the history loss
  is gone (its interval includes zero) or only smaller.
- Spend under $5 for this round.

## Done

- **Definition and ten examples:** in the design doc. Drafted as an agent proposal;
  Tanner confirmed it on 2026-11-13 ("Yes, confirm it").
- **Prompt v2:** in `src/lib/server/politicsModel.ts`, with `POLITICS_PROMPT_VERSION = 'v2'`
  so cached v1 flags expire. Option 1 and the failure behaviour are unchanged: on a
  timeout (800 ms) or an error, the word rules alone decide.
- **feed-sim:** caches model flags per prompt version (`politics-cache.<version>.json`).
- **Labelled set:** `scripts/politics-eval/`, 180 articles from 30 real pools (an earlier commit message says 28; the two contemporary pools were left out of that count).
  - Strata: history 48, politics-heavy 60, random 60, contemporary 12. Sampled with a
    fixed seed (`sample.ts`).
  - Labeller A (this session) labelled first (`labels-a.tsv`). Labeller B, a separate
    agent, labelled blind from the definition only (`labels-b.tsv`).
  - Agreement 177 of 180, Cohen's kappa 0.90. The three disagreements were resolved by
    the definition: Anti-communism → 1, Armenian nationalism → 1, Crown Dependencies → 0.
    Gold labels (`gold.json`): 17 positive, 163 negative.
  - The labels were fixed before any v2 output was seen. v2 was not tuned on this set.
- **Eval** (`eval.ts`; each item judged inside its full real pool, two runs per prompt;
  raw verdicts in `verdicts.json`):

  | classifier (n=180, 17 positive) | TP | FP | FN | precision | recall |
  |---|---|---|---|---|---|
  | word rules | 10 | 30 | 7 | 0.250 | 0.588 |
  | v1 model alone | 17 | 37 | 0 | 0.315 | 1.000 |
  | v2 model alone | 15 | 16 | 2 | 0.484 | 0.882 |
  | option 1 with v1 | 17 | 47 | 0 | 0.266 | 1.000 |
  | option 1 with v2 | 15 | 36 | 2 | 0.294 | 0.882 |

  - History stratum (n=48, 2 positive): v1 alone has 12 false positives, v2 alone has 5,
    and option 1 with v2 has 9. The word rules alone have 6.
  - Run-to-run flips: v1 3 of 180, v2 6 of 180. v2's numbers were identical across runs.
  - v2 still flags some dead rulers and ended topics: Constantine the Great, Nikephoros
    II Phokas, Cold War espionage, Western Bloc, Slave states and free states.
  - It misses Taiwan–Africa relations and the Constitutional Court of Korea.
  - **Under option 1, most of the remaining false positives come from the word rules.**
    They target history (the WWII / authoritarian cluster) by design, so against this
    current-politics definition they count as false positives.
  - Limits: only 17 positives, so recall has wide uncertainty. Both labellers are Claude
    models. The set is stratified, so it does not represent feed traffic.

## Simulation result, round 2 (word rules only vs option 1 with prompt v2)

660 paired journeys per arm, maxLen 30, same cache, run together on 2026-11-13. ± is the 95%
CI of the paired difference across journeys. Every served card counts (`path` holds only
served cards; the seed is not in it). Recompute with
`cd scripts/politics-eval && bun run compare-arms.ts regex2 v2 politics-cache.v2.json`, which
needs the untracked feed-sim result and cache files.

| measure | word rules | option 1 + v2 | paired diff |
|---|---|---|---|
| history reader, control, on-interest | 62.95% | 61.63% | −1.32 pp ± 2.88 (n=60) |
| history reader, adaptive, on-interest | 59.48% | 58.84% | −0.64 pp ± 3.43 (n=60) |
| all personas, on-interest | 24.05% | 24.05% | 0.00 pp ± 0.70 (n=600) |
| tangent share of served cards | 20.15% | 19.93% | −0.22 pp ± 0.44 |
| served cards v2 calls political (circular measure) | 1.04% | 0.22% | −0.82 pp ± 0.19 |
| journeys reaching any cluster page | 6/660 (Wilson 0.4–2.0%) | 7/660 (0.5–2.2%) | none detected |
| journeys reaching the core cluster | 0/660 | 0/660 | none |

- **The history loss is gone within this run's resolution.** Both intervals include zero.
  Round 1 (v1), recomputed the same way, was −8.74 ± 4.85 (control) and −2.77 ± 4.53
  (adaptive), with tangent share −1.78 ± 0.76.
- Earlier figures in PR 15 left out each journey's first card (−1.5 ± 3.0 and −9.3 ± 5.0).
  The conclusions do not change.
- **Model calls:** 8,125 through a local `wrangler dev` relay. 4 failed outright, and 212
  (2.6%) took over 800 ms. p50 was 325 ms, p95 666 ms. This is Mac → `wrangler dev`
  latency, not production. The sim reported 138 word-rule fallbacks out of 7,990 pools.

## After the review (2026-11-13)

- **Prompt v3:** v2's rule text, with each candidate quoted as one JSON object inside an
  `<articles>` block marked as untrusted data. The definition is unchanged. v3 was not
  re-evaluated, because no model calls were allowed; the numbers above are v2's.
- **Guards** (`src/lib/server/politicsModel.ts`):
  - A per-isolate circuit breaker.
  - A per-isolate daily call cap.
  - A flood guard that discards an answer flagging more than half of a pool (of at least
    8 items) that the word rules left alone.
  - Model flags in their own cache store.
- **Start page:** if the model fails, the word-rules-only page is cached for 10 minutes,
  not a day, and `politics_fallback` is recorded.

## After the re-review (2026-11-13)

- **v3 evaluated** on the labelled set (`bun run eval.ts`): 60 direct model calls, $0.015.
  Guards were bypassed, and each pool's model-only share is stored separately.

  | classifier (n=180, 17 positive) | precision | recall |
  |---|---|---|
  | v2 model alone (run 1 / run 2) | 0.484 / 0.484 | 0.882 / 0.882 |
  | v3 model alone (run 1 / run 2) | 0.516 / 0.485 | 0.941 / 0.941 |
  | option 1 with v2 | 0.294 | 0.882 |
  | option 1 with v3 | 0.302 | 0.941 |

  - Run-to-run flips: v3 2 of 180, v2 6 of 180.
  - Highest share of a pool flagged by v3 but not by the word rules: 0.261 (30 pools), so
    the 50% guard rejected none.
  - On the 14 of those pools that also have v2 flags, v3 flags no more than v2 (max 0.143
    vs 0.163).
  - The difference between v2 and v3 is one or two items out of 17 positives, which is
    within noise.
- **Start page:** each shelf repeats the 50% share test on its own candidates, so the
  model alone can never remove the single featured article. The word rules still can.
- **Escaping:** U+2028 and U+2029 are escaped in the quoted fields, as `<` is.
- **Breaker:**
  - After the cool-down, a single trial request goes through, and only its success
    closes the breaker.
  - At most 8 pools are classified at once per isolate; the rest use the word rules.
  - When calls fail, the breaker opens after at most 13 pool classifications (8 in
    flight + 5 failures), then allows one trial per 5-minute cool-down.
  - Worst case: requests cancelled mid-call free their slots after 1.6 s and never count
    as failures, so the breaker does not trip. Up to 8 calls can then start every 1.6 s
    (about 5 per second), until the daily cap of 20,000 calls per isolate is reached, in
    about 67 minutes. That is about $4.30 per isolate per day at 5,600 tokens a call.
  - There is no account-wide limit without the WAF rule.

## After approval (2026-11-13)

- **Tickets expire.** In-flight slots and the trial now expire at twice the call's timeout.
  A request cancelled mid-call (so `settle` never runs) can no longer stop the model in an
  isolate for good.
- **Shelf test counts word-rule hits.** A shelf drops the model flags when model OR word
  rules would remove more than half of it. One model-only flag can no longer empty a
  shelf the word rules already halve.
- **Post-deploy check:** watch for an isolate where the model stops being called while
  traffic continues.
- **The feed simulation's history result is from v2, not v3.**

## Not done

- The definition is confirmed (Tanner, 2026-11-13: "Yes, confirm it").
- Deployed latency, timeout rate and real Cloudflare billing were never checked.
- The rate limit for `/api/next` and `/api/links` is a proposal for Tanner (see PR 15).

## Spend

- Round 1: about $0.15 (at most $0.27).
- Round 2: $1.58 by the token log, eval included.
- Neither was checked against Cloudflare billing.
