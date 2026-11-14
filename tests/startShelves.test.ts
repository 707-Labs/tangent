import { describe, expect, it, vi } from 'vitest';

const { restGet } = vi.hoisted(() => ({ restGet: vi.fn() }));
vi.mock('../src/lib/wikipedia/client', () => ({ restGet, actionGet: vi.fn() }));
vi.mock('../src/lib/wikipedia/action', () => ({ enrichByTitles: vi.fn(async () => []) }));

import { fetchToday } from '../src/lib/wikipedia/featured';

const summary = (title: string) => ({ title, description: 'a thing' });

describe('start page shelves under a crafted model answer', () => {
	it('never lets the model alone remove the only featured article', async () => {
		// 150 seeds in the pool; the model flags 40 (27%, under the pool-wide 50% guard),
		// including the featured article, which the word rules do not flag.
		const trending = Array.from({ length: 149 }, (_, i) => summary(`Mollusc ${i}`));
		restGet.mockResolvedValue({ tfa: summary('Octopus'), mostread: { articles: trending } });
		const flagged = new Set(['Octopus', ...trending.slice(0, 39).map((t) => t.title)]);
		const classify = vi.fn(async (cs: { title: string }[]) => new Map(cs.map((c) => [c.title, flagged.has(c.title)])));

		const feed = await fetchToday(new Date('2026-11-13T12:00:00Z'), classify);
		const featured = feed.sections.find((s) => s.id === 'featured');
		expect(featured?.picks.map((p) => p.title)).toEqual(['Octopus']);
		// A shelf where the model flags a minority still uses the flags.
		const trendingTitles = feed.sections.find((s) => s.id === 'trending')!.picks.map((p) => p.title);
		expect(trendingTitles.some((t) => flagged.has(t))).toBe(false);
	});

	it('does not let one model-only flag empty a shelf the word rules already halve', async () => {
		restGet.mockResolvedValue({
			mostread: { articles: [{ title: '2024 United States presidential election', description: 'election' }, summary('Octopus')] }
		});
		const classify = vi.fn(async () => new Map([['Octopus', true]]));
		const feed = await fetchToday(new Date('2026-11-13T12:00:00Z'), classify);
		expect(feed.sections.find((s) => s.id === 'trending')?.picks.map((p) => p.title)).toEqual(['Octopus']);
	});

	it('still drops a featured article the word rules flag', async () => {
		restGet.mockResolvedValue({ tfa: { title: '2024 United States presidential election', description: 'election' } });
		const feed = await fetchToday(new Date('2026-11-13T12:00:00Z'), async () => new Map());
		expect(feed.sections.find((s) => s.id === 'featured')).toBeUndefined();
	});
});
