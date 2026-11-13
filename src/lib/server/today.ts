/**
 * Today's Main Page picks, cached per UTC day: the Main Page rolls over once a day, so a
 * new date is a new cache key and the previous day's entry expires. An empty result (the
 * day's feed not yet published) is evicted immediately so a transient miss self-heals on
 * the next request instead of being memoized for the full day.
 *
 * When the politics model fails (error, timeout, open breaker, daily cap), the feed is
 * ranked by the word rules alone and kept for {@link POLITICS_RETRY_TTL_MS} rather than the
 * full day, so the model is tried again soon; each failure records `politics_fallback`.
 *
 * Never rejects — the start page streams this promise, and an empty feed simply hides
 * the section.
 */
import { cached, cacheDelete, TTL } from '$lib/server/cache';
import { fetchToday, type TodayFeed } from '$lib/wikipedia/featured';
import { classifyPolitics } from '$lib/server/politicsModel';
import { recordEvent } from '$lib/server/metrics';
import type { Candidate } from '$lib/wikipedia/types';

/** How long a start page ranked without the model is kept before the model is retried. */
export const POLITICS_RETRY_TTL_MS = 10 * 60 * 1000;

export async function todayFeed(platform?: App.Platform): Promise<TodayFeed> {
	const now = new Date();
	const key = `today:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;

	const ai = platform?.env?.AI;
	let modelFailed = false;
	const classify = async (candidates: Candidate[]) => {
		const flags = await classifyPolitics(ai, candidates, undefined, (event) =>
			recordEvent(platform, event)
		);
		if (!flags && ai && candidates.length > 0) {
			modelFailed = true;
			recordEvent(platform, 'politics_fallback');
		}
		return flags;
	};

	try {
		const feed = await cached(key, TTL.long, () => fetchToday(now, classify));
		if (feed.sections.length === 0) cacheDelete(key);
		else if (modelFailed) {
			// Re-store the word-rules-only feed with a short lifetime instead of a full day.
			cacheDelete(key);
			await cached(key, POLITICS_RETRY_TTL_MS, async () => feed);
		}
		return feed;
	} catch {
		return { date: '', sections: [] };
	}
}
