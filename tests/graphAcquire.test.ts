import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcquisitionCache, graphAcquisitions } from '../src/lib/graph/acquire';

describe('graph acquisition cache', () => {
	it('shares foreground and speculative requests, then reuses the completed result', async () => {
		let resolve!: (value: string[]) => void;
		const acquire = vi.fn(() => new Promise<string[]>((done) => { resolve = done; }));
		const cache = new AcquisitionCache(acquire);
		const first = cache.get('Earth');
		const second = cache.get('Earth');
		await Promise.resolve();
		expect(acquire).toHaveBeenCalledOnce();
		resolve(['Moon']);
		expect(await first).toEqual(['Moon']);
		expect(await second).toEqual(['Moon']);
		expect(cache.peek('Earth')).toEqual(['Moon']);
		await cache.get('Earth');
		expect(acquire).toHaveBeenCalledOnce();
	});
	it('retries failures and bounds retained neighborhoods', async () => {
		const acquire = vi.fn().mockRejectedValueOnce(new Error('upstream')).mockImplementation(async (title: string) => [title]);
		const cache = new AcquisitionCache<string[]>(acquire, 2);
		await expect(cache.get('Earth')).rejects.toThrow('upstream');
		expect(await cache.get('Earth')).toEqual(['Earth']);
		await cache.get('Moon');
		await cache.get('Sun');
		expect(cache.peek('Earth')).toBeUndefined();
		expect(cache.peek('Sun')).toEqual(['Sun']);
	});
});

function deferredFetch() {
	let active = 0;
	let peak = 0;
	const pending: { url: string; complete: (status?: number) => void }[] = [];
	const fetchMock = vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
		active++;
		peak = Math.max(peak, active);
		let settled = false;
		const finish = (status = 200) => {
			if (settled) return;
			settled = true;
			active--;
			const title = new URL(url, 'http://localhost').searchParams.get(url.includes('/links') ? 'from' : 'title')!;
			const body = url.includes('/links') ? { candidates: [{ title: `${title} neighbor`,
				description: null, thumbnail: null, isDisambiguation: false, relation: 'link', categories: [] }] }
				: { article: { title, description: null, extract: 'Summary', thumbnail: null,
					wikiUrl: `https://en.wikipedia.org/wiki/${title}`, lang: 'en', tokens: [title] } };
			resolve(Response.json(body, { status }));
		};
		options.signal?.addEventListener('abort', () => {
			if (settled) return;
			settled = true;
			active--;
			reject(new DOMException('Aborted', 'AbortError'));
		}, { once: true });
		pending.push({ url, complete: finish });
	}));
	vi.stubGlobal('fetch', fetchMock);
	return { fetchMock, pending, peak: () => peak };
}

describe('shared graph request budget', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('bounds card and neighborhood requests together and drains queued work in order', async () => {
		const upstream = deferredFetch();
		const acquisitions = graphAcquisitions();
		const requests = Array.from({ length: 10 }, (_, i) => i % 2
			? acquisitions.cards.get(`Title${i}`) : acquisitions.links.get(`Title${i}`));
		await vi.waitFor(() => expect(upstream.fetchMock).toHaveBeenCalledTimes(4));
		expect(upstream.peak()).toBe(4);
		for (let i = 0; i < 10; i++) {
			await vi.waitFor(() => expect(upstream.pending.length).toBeGreaterThan(i));
			expect(upstream.pending[i].url).toContain(`Title${i}`);
			upstream.pending[i].complete();
		}
		await Promise.all(requests);
		expect(upstream.peak()).toBe(4);
		expect(upstream.fetchMock).toHaveBeenCalledTimes(10);
		acquisitions.dispose();
	});

	it('rejects queued work on teardown without starting it and aborts active requests', async () => {
		const upstream = deferredFetch();
		const acquisitions = graphAcquisitions();
		const requests = Array.from({ length: 8 }, (_, i) => acquisitions.links.get(`Title${i}`));
		const settled = Promise.allSettled(requests);
		await vi.waitFor(() => expect(upstream.fetchMock).toHaveBeenCalledTimes(4));
		acquisitions.dispose();
		expect((await settled).map((result) => result.status)).toEqual(Array(8).fill('rejected'));
		expect(upstream.fetchMock).toHaveBeenCalledTimes(4);
		await expect(acquisitions.cards.get('Later')).rejects.toThrow('Map closed.');
		expect(upstream.fetchMock).toHaveBeenCalledTimes(4);
	});

	it('preserves single-flight and frees a failed slot for a retry', async () => {
		const upstream = deferredFetch();
		const acquisitions = graphAcquisitions();
		const first = acquisitions.links.get('Earth');
		const second = acquisitions.links.get('Earth');
		expect(first).toBe(second);
		const failures = Promise.allSettled([first, second]);
		await vi.waitFor(() => expect(upstream.fetchMock).toHaveBeenCalledTimes(1));
		upstream.pending[0].complete(502);
		expect((await failures).map((result) => result.status)).toEqual(['rejected', 'rejected']);
		const retry = acquisitions.links.get('Earth');
		await vi.waitFor(() => expect(upstream.fetchMock).toHaveBeenCalledTimes(2));
		upstream.pending[1].complete();
		expect((await retry)[0].title).toBe('Earth neighbor');
		await acquisitions.links.get('Earth');
		expect(upstream.fetchMock).toHaveBeenCalledTimes(2);
		acquisitions.dispose();
	});
});
