import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../src/lib/wikipedia/types';
import type { PoliticsClassifier, TodayFeed } from '../src/lib/wikipedia/featured';

const { fetchToday, fetchExploreCandidates, fetchRelated, recordEvent } = vi.hoisted(() => ({
	fetchToday: vi.fn(),
	fetchExploreCandidates: vi.fn(),
	fetchRelated: vi.fn(),
	recordEvent: vi.fn()
}));
vi.mock('../src/lib/wikipedia/featured', () => ({ fetchToday }));
vi.mock('../src/lib/wikipedia/action', () => ({ fetchExploreCandidates, fetchRelated }));
vi.mock('../src/lib/server/metrics', () => ({ recordEvent }));

import { todayFeed, POLITICS_RETRY_TTL_MS } from '../src/lib/server/today';
import { GET } from '../src/routes/api/links/+server';
import { cacheDelete } from '../src/lib/server/cache';
import { resetPoliticsGuards } from '../src/lib/server/politicsModel';

function candidate(title: string): Candidate {
	return { title, description: null, thumbnail: null, isDisambiguation: false, relation: 'link', categories: [], position: 0 };
}

/** A Workers AI stub that flags the titles in `political` and nothing else. */
function ai(political: string[]) {
	return {
		run: vi.fn(async (_m: string, input: unknown) => {
			const { questions } = input as { questions: Record<string, { instructions: string }> };
			const answers: Record<string, { type: 'noul'; noul: number }> = {};
			for (const [id, q] of Object.entries(questions)) {
				const title = JSON.parse(/\((".*")\)/.exec(q.instructions)![1]) as string;
				answers[id] = { type: 'noul', noul: political.includes(title) ? 0.9 : 0.1 };
			}
			return { answers };
		})
	};
}
const failing = () => ({ run: vi.fn(() => Promise.reject(new Error('down'))) });
const platform = (AI: unknown) => ({ env: { AI } }) as unknown as App.Platform;

/** Today's feed as the start page builds it: one section listing the titles the classifier left unflagged. */
function feedFrom(titles: string[]) {
	return async (_date: Date, classify?: PoliticsClassifier): Promise<TodayFeed> => {
		const flags = (await classify?.(titles.map(candidate))) ?? new Map<string, boolean>();
		const kept = titles.filter((t) => !flags.get(t));
		return { date: 'd', sections: [{ id: 'trending', label: 'Trending', picks: kept.map((t) => ({ title: t })) }] } as unknown as TodayFeed;
	};
}

function todayKey(now = new Date()) {
	return `today:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

beforeEach(() => {
	vi.clearAllMocks();
	resetPoliticsGuards();
	cacheDelete(todayKey());
});
afterEach(() => vi.useRealTimers());

describe('start page politics classification', () => {
	it('drops model-flagged seeds and keeps the result for the day', async () => {
		fetchToday.mockImplementation(feedFrom(['Octopus', 'Belovezha Accords']));
		const model = ai(['Belovezha Accords']);
		const feed = await todayFeed(platform(model));
		expect(feed.sections[0].picks.map((p) => p.title)).toEqual(['Octopus']);
		await todayFeed(platform(model));
		expect(fetchToday).toHaveBeenCalledTimes(1);
		expect(recordEvent).not.toHaveBeenCalled();
	});

	it('records a fallback and keeps a word-rules-only page only briefly when the model fails', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
		cacheDelete(todayKey());
		fetchToday.mockImplementation(feedFrom(['Octopus', 'Belovezha Accords']));

		const feed = await todayFeed(platform(failing()));
		expect(feed.sections[0].picks.map((p) => p.title)).toEqual(['Octopus', 'Belovezha Accords']);
		expect(recordEvent).toHaveBeenCalledWith(expect.anything(), 'politics_fallback');

		await todayFeed(platform(ai(['Belovezha Accords'])));
		expect(fetchToday).toHaveBeenCalledTimes(1); // still within the short lifetime

		vi.advanceTimersByTime(POLITICS_RETRY_TTL_MS + 1);
		const retried = await todayFeed(platform(ai(['Belovezha Accords'])));
		expect(fetchToday).toHaveBeenCalledTimes(2);
		expect(retried.sections[0].picks.map((p) => p.title)).toEqual(['Octopus']);
	});
});

describe('/api/links politics classification', () => {
	async function links(from: string, AI: unknown) {
		const res = await GET({
			url: new URL(`http://localhost/api/links?from=${encodeURIComponent(from)}`),
			setHeaders: vi.fn(),
			platform: platform(AI)
		} as unknown as Parameters<typeof GET>[0]);
		return (await res.json()) as { candidates: Candidate[] };
	}

	it('returns the pool with the model flag set', async () => {
		fetchExploreCandidates.mockResolvedValue([candidate('Octopus'), candidate('Belovezha Accords')]);
		const { candidates } = await links('Links flagged', ai(['Belovezha Accords']));
		expect(candidates.map((c) => c.political)).toEqual([false, true]);
	});

	it('returns the pool unflagged and records a fallback when the model fails', async () => {
		fetchExploreCandidates.mockResolvedValue([candidate('Octopus'), candidate('Belovezha Accords')]);
		const { candidates } = await links('Links failing', failing());
		expect(candidates.map((c) => c.political)).toEqual([undefined, undefined]);
		expect(recordEvent).toHaveBeenCalledWith(expect.anything(), 'politics_fallback');
	});
});
