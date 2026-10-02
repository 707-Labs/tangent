import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadCardSource, renderCardPng } = vi.hoisted(() => ({
	loadCardSource: vi.fn(),
	renderCardPng: vi.fn()
}));
vi.mock('../src/lib/share/source.server', () => ({ loadCardSource }));
vi.mock('../src/lib/share/render.server', () => ({ renderCardPng }));

import { GET } from '../src/routes/og/+server';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ARTICLE = { kind: 'article', title: 'Elephant Island', description: 'Island off the coast of Antarctica' };
const PHOTO = { src: 'lead-image', width: 960, height: 640, fit: 'cover', data: new ArrayBuffer(8) };
const SITE_CARD = { status: 302, location: '/og.png' };

/** An in-memory stand-in for the Workers edge cache. */
function edgeCache() {
	const entries = new Map<string, Response>();
	return {
		entries,
		match: async (request: Request) => entries.get(request.url)?.clone(),
		put: async (request: Request, response: Response) => void entries.set(request.url, response)
	};
}

/** GET /og?{query}, as the adapter calls it, optionally with an edge cache on `platform`. */
async function get(query: string, cache?: ReturnType<typeof edgeCache>): Promise<Response> {
	const platform = cache && { caches: { default: cache }, ctx: { waitUntil: () => {} } };
	// The handler reads only `url` and `platform`; a full RequestEvent isn't needed.
	const event = { url: new URL(`https://tangent.page/og?${query}`), platform } as unknown as Parameters<typeof GET>[0];
	return GET(event);
}

describe('GET /og', () => {
	afterEach(() => vi.resetAllMocks());

	it('serves a complete card for a week at the edge', async () => {
		loadCardSource.mockResolvedValue({ ...ARTICLE, image: PHOTO, complete: true });
		renderCardPng.mockResolvedValue(PNG);
		const response = await get('title=Elephant%20Island&v=1');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('cache-control')).toContain('s-maxage=604800');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
	});

	it('drops a lead image that will not decode and serves the typographic card briefly', async () => {
		loadCardSource.mockResolvedValue({ ...ARTICLE, image: PHOTO, complete: true });
		renderCardPng.mockImplementation(async (_node: unknown, images: unknown[]) => {
			if (images.length) throw new Error('An error occurred while decoding the image data');
			return PNG;
		});
		const response = await get('title=Elephant%20Island&v=1');
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		expect(renderCardPng).toHaveBeenLastCalledWith(expect.anything(), []);
	});

	it('redirects to the site card for invalid titles, missing articles and failed renders', async () => {
		await expect(get('title=%3Cscript%3E')).rejects.toMatchObject(SITE_CARD);
		expect(loadCardSource).not.toHaveBeenCalled();

		loadCardSource.mockResolvedValue({ kind: 'missing' });
		await expect(get('title=Zzqxv')).rejects.toMatchObject(SITE_CARD);

		loadCardSource.mockResolvedValue({ ...ARTICLE, image: null, complete: true });
		renderCardPng.mockRejectedValue(new Error('renderer failed to start'));
		await expect(get('title=Elephant%20Island')).rejects.toMatchObject(SITE_CARD);
	});

	it('sends the site card rather than draw a title Wikipedia could not confirm', async () => {
		loadCardSource.mockResolvedValue({ kind: 'unavailable' });
		renderCardPng.mockResolvedValue(PNG);
		await expect(get('title=Any%20text%20at%20all&v=1')).rejects.toMatchObject(SITE_CARD);
		expect(renderCardPng).not.toHaveBeenCalled();
	});

	it('renders variant spellings of a title once, under the normalized card URL', async () => {
		loadCardSource.mockResolvedValue({ ...ARTICLE, image: null, complete: true });
		renderCardPng.mockResolvedValue(PNG);
		const cache = edgeCache();
		await get('title=Elephant_Island&v=1', cache);
		const variant = await get('title=Elephant%20%20Island&v=1&utm_source=feed', cache);
		expect(variant.status).toBe(200);
		expect(new Uint8Array(await variant.arrayBuffer())).toEqual(PNG);
		expect(loadCardSource).toHaveBeenCalledTimes(1);
		expect([...cache.entries.keys()]).toEqual(['https://tangent.page/og?title=Elephant+Island&v=1']);
	});
});
