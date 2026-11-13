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

- **Definition and ten examples:** in the design doc, marked as an agent proposal.
- **Prompt v2:** in `src/lib/server/politicsModel.ts`, with `POLITICS_PROMPT_VERSION = 'v2'`
  so cached v1 flags expire. Option 1 and the failure behaviour are unchanged: on a
  timeout (800 ms) or an error, the word rules alone decide.
- **feed-sim:** caches model flags per prompt version (`politics-cache.<version>.json`).
- **Labelled set:** `scripts/politics-eval/`, 180 articles from 28 real pools.
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

## Running (started about 13:55 local, 2026-11-13; stops by itself after 660 journeys per arm)

Both arms run in the worktree `/Users/tanner/Developer/tangent/.claude/worktrees/zealous-curran-287dd7`:

- **Option 1 + v2:** `scripts/feed-sim/run-v2.log` → `scripts/feed-sim/results-v2.json`.
  Model flags go to `scripts/feed-sim/politics-cache.v2.json`.
- **Word rules only:** `scripts/feed-sim-regex/run-regex2.log` →
  `scripts/feed-sim-regex/results-regex2.json`. `feed-sim-regex` is an untracked copy of
  `feed-sim`; delete it when done.
- **Model relay:** a local `wrangler dev` (Workers AI binding, port 8787, nothing
  deployed) sits behind a logging proxy on port 18787. The proxy refuses calls once $4.00
  of tokens are logged. Per-call latency and tokens are in
  `/private/tmp/claude-501/-Users-tanner-Developer-tangent--claude-worktrees-zealous-curran-287dd7/2138be87-5cc4-4e85-9189-8f7a753d98ee/scratchpad/aiw/calls.jsonl`.
  The relay and proxy keep running after the sim ends. Stop them with
  `kill $(lsof -ti tcp:18787 -sTCP:LISTEN) $(lsof -ti tcp:8787 -sTCP:LISTEN)`.
- **Done check:** each log ends with `exit 0`.

## How to read the results

From `scripts/feed-sim`:

```sh
cp ../feed-sim-regex/results-regex2.json .
bun run analyze.ts regex2 && bun run analyze.ts v2      # report-regex2.md, report-v2.md
cd ../politics-eval && bun run compare-arms.ts regex2 v2 politics-cache.v2.json
```

- `compare-arms.ts` prints the paired per-journey difference (95% CI) in cards the model
  calls political. It also prints any-cluster and core-cluster reach with Wilson
  intervals.
- **Caveat on that measure:** it is judged by the model under test (v2), so it is
  circular. The labelled-set numbers above are the independent check.
- **History reader:** compute the paired on-interest difference for persona `history`,
  arm `control` and arm `adaptive`. Use the per-journey share of cards with
  `onInterest`, path minus the seed, matched on seed|persona|arm|rngSeed, with a 95% CI
  of the paired difference.
- **First-round baseline** (regex vs option 1 + v1, 660 paired journeys):
  - History control: −9.3 pp ± 5.0.
  - History adaptive: −2.8 pp ± 4.7.
  - Tangent share: −1.9 pp ± 0.8.
  - Cluster reach: 6 of 660 in both arms.
- **Answer to give:** is the history loss gone (interval includes 0) or only smaller?
- **Timeout rate:** the share of `calls.jsonl` entries with `ms > 800`, or with
  `ok: false`. This is Mac → `wrangler dev` latency, not production. The sim's own
  "regex fallbacks" count is at the end of `run-v2.log`.

## Not done

- The simulation result and its write-up.
- The timeout rate for this round.
- Updating PR 15 with the final numbers.
- Tanner has not confirmed the definition.
- Deployed latency and real Cloudflare billing were never checked.

## Spend

- First round: about $0.15 (at most $0.27).
- This round so far: $0.03 for the eval.
- The v2 simulation is expected to cost about $2.6 (about 11,900 pools × about 5,800
  tokens × $0.038 per million). It is capped at $4.00 by the proxy.
- The true total is the sum of `tokens` in `calls.jsonl` × $0.038 per million, plus the
  first round.

## Simulation result, round 2 (finished 2026-11-13, after the note above was written)

Word rules only vs option 1 with prompt v2. 660 paired journeys per arm. ± is the 95% CI
of the paired difference.

| measure | word rules | option 1 + v2 | paired diff |
|---|---|---|---|
| history reader, control, on-interest | 64.2% | 62.7% | −1.5 pp ± 3.0 (n=60) |
| history reader, adaptive, on-interest | 60.4% | 59.8% | −0.6 pp ± 3.6 (n=60) |
| all personas, on-interest | 24.2% | 24.1% | −0.0 pp ± 0.7 (n=600) |
| tangent share of served cards | 20.9% | 20.7% | −0.2 pp ± 0.5 |
| served cards v2 calls political (circular measure) | 1.08% | 0.23% | −0.85 pp ± 0.20 |
| journeys reaching any cluster page | 6/660 (Wilson 0.4–2.0%) | 7/660 (0.5–2.2%) | none detected |
| journeys reaching the core cluster | 0/660 | 0/660 | none |

- **The history loss is gone within this run's resolution.** The interval includes zero.
  Round 1 (v1) was −9.3 ± 5.0.
- v2 also no longer cuts tangents (round 1: −1.9 ± 0.8).
- What v2 removes is small: about 0.85% of served cards, as judged by v2 itself.
- **Model calls:** 8,125 through the proxy. 4 failed outright. 212 (2.6%) took over
  800 ms, measured Mac → `wrangler dev`, not production. p50 325 ms, p95 666 ms.
- The sim reported 138 regex fallbacks out of 7,990 pools flagged.
- **Spend this round:** $1.58 by the proxy's token log (eval included). Round 1 was
  about $0.15. Not checked against Cloudflare billing.
- The relay and proxy are stopped, and `feed-sim-regex` is deleted.
- **Left to do:**
  - Tanner confirms or changes the definition.
  - Independent review.
  - Copy these numbers into the PR body (done in the PR note).
