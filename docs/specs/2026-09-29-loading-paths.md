# Loading paths

The visible delay should come from the content a navigation needs. Optional card imagery and duplicate work should not add to that delay.

## Verified request ordering

- Start page: daily Wikipedia picks already stream after the search shell. No change to that behavior.
- Seed card before: summary, then a full article download and sanitization if the summary has no thumbnail, then render the summary card. After: summary, then render. Seed and deliberate dive requests use `image=summary`; Wikipedia's existing summary thumbnail is retained. An article without one appears without a card image. The full reader and automatic buffered cards retain richer imagery.
- In-article dive before: drain queued old feed acquisition, then request the known destination card. After: request and display the destination as soon as its summary resolves. Builds and refills carry a generation token so old work cannot change the buffer or loading status. New prefetch remains serialized behind old I/O, but the visible card does not wait for it. A removed placeholder cannot repopulate a replacement seed.
- Next-card acquisition before: lead parse, metadata, lead categories, related search and its categories. After: lead parse, metadata, then lead categories and related acquisition in parallel. Broad-lead optional acquisition still has the same 1.5-second cancellation budget, starting earlier. Candidate caps, filtering and ranking are unchanged.
- Concurrent cache misses before: each caller independently acquires the same resource. After: callers in the same Worker isolate share one promise. This also shares full article acquisition between the reader and card-image fallback. Cache TTL begins when acquisition completes. Failure clears the shared promise for retry; invalidation prevents an obsolete fetch from repopulating the cache.

## Evidence and limits

Controlled tests verify that eight concurrent cold cache callers issue one acquisition, that a missing-thumbnail seed performs no full-article request even when that request would never finish, and that related search starts while lead categories remain blocked. The actual feed controller is also tested with a blocked old prefetch: the destination becomes readable before that request is released, its stale result is discarded, and subsequent prefetch uses the new destination. Other tests cover retry, TTL, invalidation, placeholder removal and preserving richer automatic-card imagery.

Local HTTP observations (four sequential `/api/card` requests per title) were Quantum mechanics: 15, 2, 2, 2 ms; Coffee: 2, 2, 2, 2 ms; Mathematics: 91, 3, 3, 2 ms. The dev server already had cached content. These observations are not a cold-loading baseline, a production benchmark or evidence of a measured speedup. No comparative latency or engagement gain is claimed.

The cache remains per isolate; it does not share content across Cloudflare instances. The first summary and first full reader load still depend on Wikimedia. A shared edge cache is a possible later step if representative production measurements show isolate misses dominate. It adds invalidation and content-version concerns, so this change removes verified blocking and redundant work first.
