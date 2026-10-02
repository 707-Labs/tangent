import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedImageUrl, leadImage, loadCardSource } from '../src/lib/share/source.server';
import { pngHeader } from './fixtures/imageHeaders';

const THUMB = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4a/Elephant_Island.jpg';
const PHOTO = {
	thumbnail: { source: `${THUMB}/330px-Elephant_Island.jpg`, width: 330, height: 220 },
	originalimage: {
		source: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Elephant_Island.jpg',
		width: 3000,
		height: 2000
	}
};
const PNG_BYTES = pngHeader(960, 640);

function summary(fields: Record<string, unknown> = {}) {
	return new Response(
		JSON.stringify({ title: 'Elephant Island', description: 'Island off the coast of Antarctica', ...fields }),
		{ headers: { 'content-type': 'application/json' } }
	);
}

/** Answer Wikipedia's REST API with `rest`, and everything else via `media`. */
function stubFetch(rest: () => Response | Promise<Response>, media: (url: URL) => Response = imageResponse) {
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL) => {
			const url = new URL(input);
			calls.push(url.href);
			return url.hostname === 'en.wikipedia.org' ? rest() : media(url);
		})
	);
	return calls;
}

function imageResponse(): Response {
	return new Response(PNG_BYTES, { headers: { 'content-type': 'image/jpeg' } });
}

describe('leadImage', () => {
	it("asks for Wikimedia's standard 960px rendition of a large original", () => {
		expect(leadImage(PHOTO)).toEqual({ source: `${THUMB}/960px-Elephant_Island.jpg`, width: 960, height: 640 });
	});

	it('uses a smaller original as it is, since Wikimedia never upscales', () => {
		const original = { ...PHOTO.originalimage, width: 800, height: 600 };
		expect(leadImage({ ...PHOTO, originalimage: original })).toEqual(original);
	});

	it('renders vectors at 960px, whatever their nominal size', () => {
		const svg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Flag.svg';
		const image = leadImage({
			thumbnail: { source: `${svg}/330px-Flag.svg.png`, width: 330, height: 220 },
			originalimage: { source: `${svg}/960px-Flag.svg.png`, width: 900, height: 600 }
		});
		expect(image).toEqual({ source: `${svg}/960px-Flag.svg.png`, width: 960, height: 640 });
	});

	it("falls back to the summary's thumbnail for originals that aren't web images", () => {
		const tiff = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Scan.tif';
		const thumbnail = { source: `${tiff}/lossy-page1-330px-Scan.tif.jpg`, width: 330, height: 400 };
		const original = { source: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Scan.tif', width: 800, height: 970 };
		expect(leadImage({ thumbnail, originalimage: original })).toEqual(thumbnail);
	});

	it("uses the summary's thumbnail, never a large original, when no rendition URL can be derived", () => {
		const thumbnail = { source: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Island.jpg', width: 330, height: 220 };
		expect(leadImage({ thumbnail, originalimage: PHOTO.originalimage })).toEqual(thumbnail);
	});

	it('finds nothing when the summary has no image', () => {
		expect(leadImage({})).toBeNull();
	});
});

describe('isAllowedImageUrl', () => {
	it('allows https Wikimedia media hosts only', () => {
		expect(isAllowedImageUrl(new URL(`${THUMB}/960px-Elephant_Island.jpg`))).toBe(true);
		expect(isAllowedImageUrl(new URL(PHOTO.originalimage.source))).toBe(true);
		for (const url of [
			'http://upload.wikimedia.org/a.jpg',
			'https://upload.wikimedia.org.example.com/a.jpg',
			'https://example.com/upload.wikimedia.org/a.jpg',
			'https://user@upload.wikimedia.org/a.jpg',
			'https://upload.wikimedia.org:8443/a.jpg',
			'https://en.wikipedia.org/a.jpg'
		]) {
			expect(isAllowedImageUrl(new URL(url))).toBe(false);
		}
	});
});

describe('loadCardSource', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('loads the description and the lead image bytes', async () => {
		const calls = stubFetch(() => summary(PHOTO));
		const source = await loadCardSource('Elephant island');
		expect(source).toMatchObject({
			kind: 'article',
			title: 'Elephant Island',
			description: 'Island off the coast of Antarctica',
			image: { width: 960, height: 640, fit: 'cover' },
			complete: true
		});
		expect(source.kind === 'article' && new Uint8Array(source.image!.data)).toEqual(PNG_BYTES);
		expect(calls).toContain(`${THUMB}/960px-Elephant_Island.jpg`);
	});

	it('reports a missing article', async () => {
		stubFetch(() => new Response('{}', { status: 404 }));
		expect(await loadCardSource('Zzqxv')).toEqual({ kind: 'missing' });
	});

	it('reports Wikipedia failures as unavailable rather than trusting the requested title', async () => {
		stubFetch(() => new Response('', { status: 503 }));
		expect(await loadCardSource('Elephant Island')).toEqual({ kind: 'unavailable' });
	});

	it('never follows an image redirect off Wikimedia', async () => {
		const calls = stubFetch(
			() => summary(PHOTO),
			(url) =>
				url.hostname === 'evil.example'
					? imageResponse()
					: new Response(null, { status: 302, headers: { location: 'https://evil.example/a.jpg' } })
		);
		const source = await loadCardSource('Elephant Island');
		expect(source).toMatchObject({ kind: 'article', image: null, complete: false });
		expect(calls.some((url) => url.includes('evil.example'))).toBe(false);
	});

	it('follows a redirect that stays on Wikimedia', async () => {
		const moved = 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Elephant_Island.jpg';
		stubFetch(
			() => summary(PHOTO),
			(url) =>
				url.href === moved ? imageResponse() : new Response(null, { status: 301, headers: { location: moved } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: { fit: 'cover' }, complete: true });
	});

	it('gives up after two redirects', async () => {
		let hops = 0;
		stubFetch(
			() => summary(PHOTO),
			(url) => new Response(null, { status: 302, headers: { location: `${url.origin}${url.pathname}?hop=${++hops}` } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: false });
		expect(hops).toBe(3);
	});

	it('rejects responses that are not images', async () => {
		stubFetch(
			() => summary(PHOTO),
			() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: false });
	});

	it('rejects oversized images, declared or streamed', async () => {
		const huge = new Uint8Array(4 * 1024 * 1024 + 1);
		stubFetch(
			() => summary(PHOTO),
			() => new Response(huge, { headers: { 'content-type': 'image/jpeg' } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: false });
	});

	it('skips images too small to show without fetching them', async () => {
		const tiny = { source: `${THUMB}/120px-Elephant_Island.jpg`, width: 120, height: 80 };
		const calls = stubFetch(() => summary({ thumbnail: tiny, originalimage: tiny }));
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: true });
		expect(calls).toHaveLength(1);
	});

	it('skips images too large to decode without fetching them', async () => {
		const scroll = { ...PHOTO.originalimage, width: 1000, height: 40000 };
		const calls = stubFetch(() => summary({ ...PHOTO, originalimage: scroll }));
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: true });
		expect(calls).toHaveLength(1);
	});

	it('refuses a file larger than the summary said, or one with no readable header', async () => {
		stubFetch(
			() => summary(PHOTO),
			() => new Response(pngHeader(960, 20000), { headers: { 'content-type': 'image/png' } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: false });

		stubFetch(
			() => summary(PHOTO),
			() => new Response('GIF but not really', { headers: { 'content-type': 'image/gif' } })
		);
		expect(await loadCardSource('Elephant Island')).toMatchObject({ image: null, complete: false });
	});

	it("leaves off descriptions that don't describe or can't be drawn", async () => {
		stubFetch(() => summary({ type: 'disambiguation', description: 'Topics referred to by the same term' }));
		expect(await loadCardSource('Mercury')).toMatchObject({ description: null });

		stubFetch(() => summary({ description: 'Столица России' }));
		expect(await loadCardSource('Moscow')).toMatchObject({ description: null });
	});

	it("uses the extract's first sentence when there is no short description", async () => {
		stubFetch(() => summary({ description: undefined, extract: 'Apophenia is a tendency. It has kin.' }));
		expect(await loadCardSource('Apophenia')).toMatchObject({ description: 'Apophenia is a tendency.' });
	});
});
