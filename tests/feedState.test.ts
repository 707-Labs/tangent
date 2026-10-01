import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../src/lib/wikipedia/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/engagement/profile.svelte', () => ({ profile: {
	recordSeen: vi.fn(), recordClickthrough: vi.fn(), tokenWeights: {},
	tokenAvoidWeights: {}, tokenDocFreq: {}, taste: 'balanced'
} }));

function article(title: string): Article {
	return { title, extract: `Resolved ${title}`, description: null, thumbnail: null,
		wikiUrl: `https://en.wikipedia.org/wiki/${title}`, lang: 'en', tokens: [title] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => { resolve = yes; });
	return { promise, resolve };
}

describe('dive loading', () => {
	afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

	it.each(['success', 'failure'] as const)('ignores a stale seed %s after a newer seed resolves', async (outcome) => {
		vi.stubGlobal('$state', <T>(value: T) => value);
		const stale = deferred<Response>();
		const links = deferred<Response>();
		vi.stubGlobal('fetch', vi.fn((url: string) => {
			if (url.startsWith('/api/links')) return links.promise;
			const title = new URL(url, 'http://localhost').searchParams.get('title')!;
			return title === 'Black hole' ? stale.promise : Promise.resolve(Response.json({ article: article(title) }));
		}));
		const { feed } = await import('../src/lib/feed/feedState.svelte');
		const oldStart = feed.start('Black hole');
		await feed.start('Coffee');
		const originalTrail = [...feed.trail];
		stale.resolve(outcome === 'success' ? Response.json({ article: article('Black hole') }) : new Response('', { status: 500 }));
		await oldStart;
		expect(feed.seedTitle).toBe('Coffee');
		expect(feed.displayTitle).toBe('Coffee');
		expect(feed.cards.map((card) => card.article.title)).toEqual(['Coffee']);
		expect(feed.trail).toEqual(originalTrail);
		expect(feed.status).toBe('ready');
		expect(feed.error).toBeNull();
		links.resolve(Response.json({ candidates: [] }));
	});

	it('displays a resolved dive while an old prefetch is blocked, then discards its result', async () => {
		// Test actual FeedState methods without DOM subscriptions: $state fields
		// behave as ordinary mutable fields for this request-ordering regression.
		vi.stubGlobal('$state', <T>(value: T) => value);
		const oldLinks = deferred<Response>();
		const fetchMock = vi.fn((url: string) => {
			if (url.startsWith('/api/links?from=Seed')) return oldLinks.promise;
			if (url.startsWith('/api/links')) return Promise.resolve(Response.json({ candidates: [] }));
			const title = new URL(url, 'http://localhost').searchParams.get('title')!;
			return Promise.resolve(Response.json({ article: article(title) }));
		});
		vi.stubGlobal('fetch', fetchMock);
		const { feed } = await import('../src/lib/feed/feedState.svelte');
		await feed.start('Seed');
		await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/links?from=Seed'))).toBe(true));
		const id = feed.beginDive('Destination', 'Seed');
		await vi.waitFor(() => {
			expect(feed.cards.find((c) => c.id === id)?.pending).toBe(false);
			expect(feed.cards.find((c) => c.id === id)?.article.extract).toBe('Resolved Destination');
		});
		expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/links?from=Destination'))).toBe(false);
		oldLinks.resolve(Response.json({ candidates: [{ title: 'Stale', description: 'old pick',
			thumbnail: null, categories: [], relation: 'link', isDisambiguation: false, position: 0 }] }));
		await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/links?from=Destination'))).toBe(true));
		expect(fetchMock.mock.calls.some(([url]) => url.includes('title=Stale'))).toBe(false);
		expect(feed.cards.map((c) => c.article.title)).toEqual(['Seed', 'Destination']);
	});

	it('ignores a destination that resolves after another seed replaces its placeholder', async () => {
		vi.stubGlobal('$state', <T>(value: T) => value);
		const destination = deferred<Response>();
		vi.stubGlobal('fetch', vi.fn((url: string) => {
			if (url.startsWith('/api/links')) return Promise.resolve(Response.json({ candidates: [] }));
			const title = new URL(url, 'http://localhost').searchParams.get('title')!;
			return title === 'Destination' ? destination.promise : Promise.resolve(Response.json({ article: article(title) }));
		}));
		const { feed } = await import('../src/lib/feed/feedState.svelte');
		await feed.start('Seed');
		feed.beginDive('Destination', 'Seed');
		await feed.start('Replacement');
		destination.resolve(Response.json({ article: article('Destination') }));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(feed.cards.map((c) => c.article.title)).toEqual(['Replacement']);
	});

	it('does not let a waiting more call exhaust a new dive when its stale build completes', async () => {
		vi.stubGlobal('$state', <T>(value: T) => value);
		const oldLinks = deferred<Response>();
		const newLinks = deferred<Response>();
		vi.stubGlobal('fetch', vi.fn((url: string) => {
			if (url.startsWith('/api/links?from=Seed')) return oldLinks.promise;
			if (url.startsWith('/api/links')) return newLinks.promise;
			const title = new URL(url, 'http://localhost').searchParams.get('title')!;
			return Promise.resolve(Response.json({ article: article(title) }));
		}));
		const { feed } = await import('../src/lib/feed/feedState.svelte');
		await feed.start('Seed');
		// more queues behind the blocked refill while its buffer is still empty.
		const revealing = feed.more();
		const id = feed.beginDive('Destination', 'Seed');
		await vi.waitFor(() => expect(feed.cards.find((c) => c.id === id)?.pending).toBe(false));
		oldLinks.resolve(Response.json({ candidates: [] }));
		await revealing;
		expect(feed.status).toBe('ready');
		expect(feed.cards.map((c) => c.article.title)).toEqual(['Seed', 'Destination']);
		newLinks.resolve(Response.json({ candidates: [] }));
	});
});
