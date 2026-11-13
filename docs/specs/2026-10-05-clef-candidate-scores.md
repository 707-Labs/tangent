# Clef candidate scores

2026-10-05 · Status: draft

## Premise

The feed's judgement of whether an article is interesting comes from regexes. `intrigue()` and
`tasteAffinity()` in `src/lib/feed/taste.ts` and `specificity()` in `src/lib/feed/score.ts`
pattern-match the title, the Wikipedia short description and the categories. The known weak
spots are all judgement calls those regexes approximate:

- Cold-start mainstream seeds are intrigue-poor: only 48% of first breaks clear the hook gate
  (sim README, 07-17).
- The feed climbs toward abstraction, patched with regex specificity penalties.
- Wild tangents are the worst received: 43.1% healed vs 37.6–40.1% for directed ones (07-25).

**What would disconfirm it.** There is no real-user evidence that ranking quality is a problem.
Analytics carries no per-pick or per-variant attribution. So this is an experiment with a cheap
early exit. If Clef's scores don't track Tanner's own ratings better than `intrigue()` does on a
gold set (stage 1), stop there and ship nothing.

**Input is thin.** A candidate carries only title, short description (often three words) and
categories. Clef may not beat the regexes on that. Stage 1 is what tests this.

## Overview

Ask Clef-flash a small, user-independent set of questions about each candidate article, and
cache the answers per title. When a candidate has scores, the engine uses them in place of the
regex heuristics; when it doesn't, the regexes still apply. Scores attach on the server, in the
one place both clients get their candidates from, so web and iOS stay in parity. `selectNext`
stays pure and synchronous.

## Goals

- A per-article score that beats the regex `intrigue()` against human judgement, or a clean
  "no".
- Identical ranking inputs for web (browser-side `selectNext`) and iOS (`/api/next`).
- A live comparison with real attribution, when traffic allows.

## Non-goals

- Per-user or per-session model calls. Personalisation stays in the engine.
- Moving web ranking to the server.
- Fetching article extracts to give Clef more text. That is a follow-up only if stage 1 fails
  narrowly.
- Replacing `politics.ts` or the cluster regexes.

## Approach

**Questions.** One request per article, with a state of `{title, description, categories}`.

- `intrigue`: `score`, 1–5. "Would a curious generalist stop scrolling to read this article?"
  The rubric runs from "dry reference or list" to "strange, surprising, story-shaped".
- `specificity`: `score`, 1–5. "A concrete thing, person, event or place, versus a broad
  abstract topic."
- `meta`: `noul` (yes/no). "Is this a list, index, outline, disambiguation-like or
  housekeeping page?"

**Cache.** Add a D1 table, `article_scores`, with columns `title` (PK), `intrigue`,
`specificity`, `meta_p`, `model`, `scored_at`. Wikipedia articles change slowly, so a row lives
until the model id changes.

**Attach point.** `fetchExploreCandidates` in `src/lib/wikipedia/action.ts` already feeds both
`/api/links` (web) and `/api/next` (iOS). After candidates resolve:

1. Batch-read their scores from D1.
2. Score the misses with `env.AI.run` in parallel, under a 400 ms budget.
3. Write new scores back through `waitUntil`.

A miss beyond the budget ships without scores and is cached for the next request.
`/api/links` stays `public, max-age=3600`, which is safe because the scores are per-article.

**Wire.** Add `scores?: { intrigue: number; specificity: number; meta: number }` to `Candidate`.
It is optional, so `ios/TangentTests/WireModelTests.swift` keeps passing. iOS never reads it,
because ranking happens server-side for iOS.

**Engine.** In `scoreCandidate`, when `config.clefScores` is on and a candidate has `scores`:

- `intrigue(c)` becomes a linear map of `scores.intrigue` onto the regex's existing 0–2.6 range.
- `specificity` becomes the same kind of map onto its existing range.
- `meta` > 0.7 means −∞, the same treatment disambiguation pages get.

Weights are unchanged, so the only thing being tested is the signal. `selectNext` stays
synchronous, and `tests/feed.test.ts` is unchanged when the flag is off.

**Binding.** Add `"ai": { "binding": "AI" }` to `wrangler.jsonc`, and `AI` to
`App.Platform.env` in `src/app.d.ts`.

## Evaluation: three stages, each a gate

1. **Gold set (go or no-go).**
   - Sample 200 candidates from fresh link sets across the sim's 12 seeds.
   - Tanner rates intrigue from 1 to 5 in a CSV, blind to both scores.
   - Compare Spearman ρ of Clef's `intrigue` vs regex `intrigue()` against the ratings, with a
     bootstrap 95% CI on the difference.
   - **Go** only if the CI excludes zero in Clef's favour.
   - Do the same for specificity, as a secondary result.
2. **Sim (does it break anything).**
   - First, a fresh baseline. The engine changed on 09-29 and 09-30 and has not been re-simmed
     since 07-26.
   - Then a run with `clefScores` on. A node prefill script (`scripts/feed-sim/clef-prefill.mts`)
     scores every title in `cache.json` once into `clef-scores.json`, and the sim reads that
     file. This keeps runs deterministic, and the sim never calls the model.
   - The prefill runs under node via `getPlatformProxy` and the OAuth login (mulligan-labs found
     it hangs under bun 1.3).
   - If it touches Wikipedia, `sim-ua.ts` is its first import.
   - Checks are structural, with no quality claims, since the sim's quality metrics are the
     incumbent heuristics:
     - dead-end rate
     - cluster drift and attractor share
     - jump distance in-run vs tangent
     - first-break hook-gate pass rate
   - Pass means no structural metric regresses beyond run-to-run noise. Report n=660 journeys
     and the CI from `drift-coverage.ts`.
3. **Live.**
   - The flag is assigned per session, 50/50, and a `variant` blob is added to every metrics
     event in `src/lib/server/metrics.ts`.
   - Read skip and like rates per card by variant.
   - Report n and CI. Below about 2,000 cards per arm, call it inconclusive and leave the flag
     off.

## Open questions (defaults chosen)

| Question | Default |
|---|---|
| Score `tasteAffinity` too? | No. Taste is per-user, and this spec keeps model calls user-independent. |
| Clef-flash or Clef? | Flash. Use Clef only if stage 1 is a near miss on Flash; rerun stage 1 on Clef before giving up. |
| Thumbnails as images? | No. Most candidates have one, but intrigue is about the topic, not the picture. One extra stage-1 arm can test it cheaply if the text-only arm is a near miss. |
| Cache invalidation | By `model` column only. |
| Explore panel and seeds (`exploreChoices`, `rankSeeds`) | Out of scope until stage 3 shows a lift. |

## Acceptance

1. Stage 1 result in the sim README format: n, ρ for each scorer, CI on the difference, and
   go/no-go. On no-go, only the gold-set script and the result are committed.
2. On go:
   - Unit tests cover the score-to-range maps and the `meta` cutoff.
   - `tests/feed.test.ts` passes with the flag off.
   - A new test confirms a candidate with `scores` and one without produce the same ranking
     when the flag is off.
3. A fresh-baseline sim and a `clefScores` sim are both recorded in `scripts/feed-sim/README.md`.
4. **Positive control on deploy:** a known title returns `scores` from `/api/links` on a second
   (cache-warm) cold request, and `article_scores` has its row.
5. Stage 3 report with n per arm, or "inconclusive" and the flag left off.
