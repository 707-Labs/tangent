import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { actionGet } = vi.hoisted(() => ({ actionGet: vi.fn() }));
vi.mock('../src/lib/wikipedia/client', () => ({ actionGet }));

import { fetchExploreCandidates, fetchRelated } from '../src/lib/wikipedia/action';

function page(title: string, index: number, overrides: Record<string, unknown> = {}) {
	return { pageid: index, ns: 0, title, index, description: `about ${title}`, ...overrides };
}

/** Mock: first call answers the page/generator query, later calls answer the
 *  category batch (empty unless a test overrides them). */
function mockPagesThenCategories(pages: unknown[], categoryResponses: unknown[] = [{}]) {
	actionGet.mockResolvedValueOnce({ query: { pages } });
	for (const r of categoryResponses) actionGet.mockResolvedValueOnce(r);
}

describe('fetchRelated', () => {
	beforeEach(() => {
		actionGet.mockReset();
		// Safety net for call counts beyond a test's explicit mocks.
		actionGet.mockResolvedValue({});
	});

	describe('generator ordering', () => {
		// The Action API returns generator results in arbitrary order; the `index`
		// field carries the generator's rank (for morelike:, similarity). Candidate
		// `position` must reflect that rank, not the arbitrary array order, because
		// the engine's position boost treats low positions as prominence.
		it('orders candidates and positions by generator index, not array order', async () => {
			mockPagesThenCategories([
				page('Cephalopod', 5),
				page('Grimpoteuthis', 1),
				page('Umbrella octopus', 3)
			]);

			const out = await fetchRelated('Octopus');

			expect(out.map((c) => c.title)).toEqual(['Grimpoteuthis', 'Umbrella octopus', 'Cephalopod']);
			expect(out.map((c) => c.position)).toEqual([0, 1, 2]);
		});

		it('assigns positions by rank even when the illustrated-first cap reorders the list', async () => {
			mockPagesThenCategories([
				page('Third', 3),
				page('First', 1),
				page('Second', 2, { thumbnail: { source: 'x', width: 1, height: 1 } })
			]);

			const out = await fetchRelated('Octopus');

			// Thumbnailed candidate floats first (cap priority), but its position
			// still records its generator rank.
			expect(out[0].title).toBe('Second');
			expect(out[0].position).toBe(1);
			const byTitle = new Map(out.map((c) => [c.title, c.position]));
			expect(byTitle.get('First')).toBe(0);
			expect(byTitle.get('Third')).toBe(2);
		});
	});

	describe('filtering', () => {
		it('drops missing, non-main-namespace, and substance-free pages', async () => {
			mockPagesThenCategories([
				page('Kept', 1),
				page('Gone', 2, { missing: true }),
				page('Category:Octopuses', 3, { ns: 14 }),
				page('Bare stub', 4, { description: undefined })
			]);

			const out = await fetchRelated('Octopus');
			expect(out.map((c) => c.title)).toEqual(['Kept']);
		});
	});

	describe('category completeness', () => {
		// prop=categories pays out a fixed membership budget per REQUEST (cllimit=max
		// = 500), not per page — a rich batch exhausts it mid-list and later pages
		// silently get nothing unless clcontinue is followed to the end. clshow=!hidden
		// SUPPRESSES that continuation entirely (verified live), so hidden categories
		// are flagged via clprop=hidden and filtered client-side instead.
		it('merges categories across clcontinue continuations and drops hidden ones', async () => {
			const cat = (title: string, hidden = false) => ({ ns: 14, title, hidden });
			mockPagesThenCategories(
				[page('Alpha', 1), page('Beta', 2)],
				[
					{
						query: {
							pages: [
								{
									ns: 0,
									title: 'Alpha',
									categories: [
										cat('Category:Ancient Rome'),
										cat('Category:Articles with short description', true)
									]
								},
								{ ns: 0, title: 'Beta' }
							]
						},
						continue: { clcontinue: 'x', continue: '-||' }
					},
					{
						query: {
							pages: [
								{ ns: 0, title: 'Alpha', categories: [cat('Category:Roman generals')] },
								{ ns: 0, title: 'Beta', categories: [cat('Category:Punic Wars')] }
							]
						}
					}
				]
			);

			const controller = new AbortController();
			const out = await fetchRelated('Octopus', controller.signal);
			expect(actionGet.mock.calls.map((call) => call[1])).toEqual([
				controller.signal, controller.signal, controller.signal
			]);
			const byTitle = new Map(out.map((c) => [c.title, c.categories]));
			expect(byTitle.get('Alpha')).toEqual(['Category:Ancient Rome', 'Category:Roman generals']);
			expect(byTitle.get('Beta')).toEqual(['Category:Punic Wars']);
		});

		it('returns candidates with empty categories when the category fetch fails', async () => {
			actionGet.mockReset();
			actionGet.mockResolvedValueOnce({ query: { pages: [page('Kept', 1)] } });
			actionGet.mockRejectedValueOnce(new Error('boom'));

			const out = await fetchRelated('Octopus');
			expect(out.map((c) => c.title)).toEqual(['Kept']);
			expect(out[0].categories).toEqual([]);
		});
	});
});

describe('fetchExploreCandidates', () => {
	beforeEach(() => {
		actionGet.mockReset();
	});
	afterEach(() => vi.useRealTimers());

	/** Dispatch by request so parallel category chunks cannot consume a search mock. */
	function mockExplore(leadCount: number, related: ReturnType<typeof page>[], failRelated = false) {
		actionGet.mockImplementation(async (params: Record<string, string>) => {
			if (params.action === 'parse') {
				// A metadata-free first link leaves a gap in the original positions.
				return { parse: { text: '<p><a href="/wiki/Bare">bare</a>' +
					Array.from({ length: leadCount }, (_, i) =>
						`<a href="/wiki/Lead_${i}">lead</a>`).join('') + '</p>' } };
			}
			if (params.prop === 'categories') return {};
			if (params.generator === 'search') {
				if (failRelated) throw new Error('search unavailable');
				return { query: { pages: related } };
			}
			if (params.generator === 'links') return { query: { pages: related } };
			return { query: { pages: params.titles.split('|')
				.filter((title) => title !== 'Bare').map((title, i) => page(title, i)) } };
		});
	}

	it('supplements a substantial lead pool with six related alternatives after original positions', async () => {
		mockExplore(20, Array.from({ length: 20 }, (_, i) => page(`Related ${i}`, i)));
		const out = await fetchExploreCandidates('Source');
		expect(out.filter((c) => c.relation === 'link')).toHaveLength(20);
		expect(out.filter((c) => c.relation === 'related')).toHaveLength(6);
		expect(out.slice(0, 20).map((c) => c.position)).toEqual(
			Array.from({ length: 20 }, (_, i) => i + 1)
		);
		expect(out[20].position).toBe(21);
	});

	it('keeps the earliest lead links when reserving related slots at the 50-candidate cap', async () => {
		mockExplore(50, Array.from({ length: 20 }, (_, i) => page(`Related ${i}`, i)));
		const out = await fetchExploreCandidates('Source');
		expect(out).toHaveLength(50);
		expect(out.filter((c) => c.relation === 'related')).toHaveLength(6);
		expect(out[0]).toMatchObject({ title: 'Lead 0', relation: 'link', position: 1 });
		expect(out[43]).toMatchObject({ title: 'Lead 43', relation: 'link', position: 44 });
	});

	it('filters source, disambiguation and duplicate related titles while keeping lead identity', async () => {
		mockExplore(14, [page('Lead 0', 0), page('Source', 1),
			page('Ambiguous', 2, { pageprops: { disambiguation: '' } }),
			page('Lateral', 3), page('Lateral', 4)]);
		const out = await fetchExploreCandidates('Source');
		expect(out).toHaveLength(15);
		expect(out[0]).toMatchObject({ title: 'Lead 0', relation: 'link', position: 1 });
		expect(out[14]).toMatchObject({ title: 'Lateral', relation: 'related', position: 15 });
		expect(new Set(out.map((c) => c.title)).size).toBe(out.length);
	});

	it('returns the full lead pool when the related request fails', async () => {
		mockExplore(50, [], true);
		const out = await fetchExploreCandidates('Source');
		// Bare consumes one of the 50 metadata slots; no related reservation is applied.
		expect(out).toHaveLength(49);
		expect(out.every((c) => c.relation === 'link')).toBe(true);
		expect(out[48]).toMatchObject({ title: 'Lead 48', position: 49 });
	});

	it('retains thin lead pools and caps a large fallback without duplicate titles', async () => {
		mockExplore(2, Array.from({ length: 50 }, (_, i) => page(`Fallback ${i}`, i)));
		const out = await fetchExploreCandidates('Source');
		expect(out).toHaveLength(50);
		expect(out.slice(0, 2).map((c) => c.title)).toEqual(['Lead 0', 'Lead 1']);
		expect(new Set(out.map((c) => c.title)).size).toBe(50);
	});

	it.each(['search', 'categories'])('cancels a stalled optional %s request after 1500ms and keeps the ready lead', async (stage) => {
		vi.useFakeTimers();
		mockExplore(20, [page('Related', 0)]);
		const respond = actionGet.getMockImplementation()!;
		let pendingSignal: AbortSignal | undefined;
		let cancelled = false;
		actionGet.mockImplementation((params: Record<string, string>, signal?: AbortSignal) => {
			const stalled = stage === 'search'
				? params.generator === 'search'
				: params.prop === 'categories' && params.titles === 'Related';
			if (!stalled) return respond(params, signal);
			pendingSignal = signal;
			return new Promise((_, reject) => {
				signal?.addEventListener('abort', () => {
					cancelled = true;
					reject(signal.reason);
				}, { once: true });
			});
		});
		const result = fetchExploreCandidates('Source');
		await vi.advanceTimersByTimeAsync(1499);
		expect(pendingSignal).toBeDefined();
		expect(pendingSignal?.aborted).toBe(false);
		expect(cancelled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const out = await result;
		expect(pendingSignal?.aborted).toBe(true);
		expect(cancelled).toBe(true);
		expect(out).toHaveLength(20);
		expect(out.every((c) => c.relation === 'link')).toBe(true);
		expect(out[19]).toMatchObject({ title: 'Lead 19', position: 20 });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears the optional deadline when search and category enrichment finish', async () => {
		vi.useFakeTimers();
		mockExplore(20, [page('Related', 0)]);
		const out = await fetchExploreCandidates('Source');
		expect(out).toHaveLength(21);
		expect(vi.getTimerCount()).toBe(0);
		const searchCall = actionGet.mock.calls.find(([params]) => params.generator === 'search');
		const relatedCategoryCall = actionGet.mock.calls.find(([params]) =>
			params.prop === 'categories' && params.titles === 'Related');
		expect(searchCall?.[1]).toBeInstanceOf(AbortSignal);
		expect(relatedCategoryCall?.[1]).toBe(searchCall?.[1]);
	});
});
