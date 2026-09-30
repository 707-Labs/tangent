# Feed relevance and honest connections

## Problem

The feed has run-based pacing, but its inputs can mislead the ranking. Generic
category words such as `births`, `deaths`, and `people` connect unrelated
biographies. A large lead-link pool can exclude every related alternative.
Direction labels can also promise an era or place contrast when the run lacks
the metadata needed to establish that contrast.

## Approach

- Remove a narrow set of category housekeeping terms from affinity. Preserve
  actual era, place, and subject tokens; keep existing weights and run cadence.
- Reserve up to six related alternatives within the existing 50-candidate limit
  for broad lead pools. Keep the most prominent lead links and their original
  positions. Related results stay behind them and retain their score penalty.
- Require known contrasting dimensions on both the candidate and the run before
  labeling a tangent "same place, another time" or "meanwhile, elsewhere".
- Learn dwell only while a card is in view and the document is visible. Hiding
  or removing a card must not count as rejection; a quick scroll-away can emit
  one skip per card.

Related acquisition is optional once a substantial lead pool is ready. It gets
a 1.5-second deadline with request cancellation, and failure preserves the lead
pool. This is an additional-wait budget, not a measured latency threshold.
It adds upstream work on cache misses; it does not add a service or
persisted data model.

## Acceptance

Deterministic regressions must distinguish unrelated biography housekeeping
from meaningful continuity, reject unsupported direction labels, preserve lead
ordering and pool limits, and cover supplemental request failure and delay.
Visibility tests must exclude background time while preserving foreground dwell
and intentional skip signals.

These are correctness improvements. Synthetic selection tests do not establish
better reader satisfaction or retention; that requires observed usage.
