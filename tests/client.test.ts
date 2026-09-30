import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionGet } from '../src/lib/wikipedia/client';

describe('actionGet cancellation', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('forwards the caller signal to fetch and propagates cancellation', async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn((_url: string, options: RequestInit) =>
			new Promise<Response>((_, reject) => {
				options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
			}));
		vi.stubGlobal('fetch', fetchMock);
		const result = actionGet({ action: 'query' }, controller.signal);
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
		controller.abort();
		await rejected;
	});

	it('still supports callers without a cancellation signal', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"query":{}}')));
		expect(await actionGet({ action: 'query' })).toEqual({ query: {} });
	});
});
