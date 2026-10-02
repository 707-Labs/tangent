import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordEvent } from '$lib/server/metrics';
import { drawable } from '$lib/share/glyphs';
import { cardLayout } from '$lib/share/layout';
import { cardImageUrl } from '$lib/share/meta';
import { renderCardPng } from '$lib/share/render.server';
import { loadCardSource, type CardImageData } from '$lib/share/source.server';
import { normalizeTitle } from '$lib/share/subject';

/** The adapter passes the Workers CacheStorage on `platform`; App.Platform doesn't declare it. */
type EdgePlatform = App.Platform & { caches?: { default?: Cache } };

/** A finished card only changes when the article does; CARD_VERSION handles redesigns. */
const COMPLETE = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';
/** A card missing its summary or photo after an upstream or decode failure; retry soon. */
const DEGRADED = 'public, max-age=300, s-maxage=300';

/**
 * GET /og?title=Elephant%20Island&v=1 -> the article's 1200×630 PNG share card.
 * Anything that can't become a card redirects to the site card, /og.png.
 *
 * The adapter's worker already caches responses under the exact request URL. This
 * handler also caches under the normalized card URL (the one share metadata points at),
 * so variant spellings of a title share one render.
 */
export const GET: RequestHandler = async ({ url, platform }) => {
	const title = normalizeTitle(url.searchParams.get('title'));
	if (!title) {
		recordEvent(platform, 'share_card', ['invalid']);
		redirect(302, '/og.png');
	}

	const cache = (platform as EdgePlatform | undefined)?.caches?.default;
	const key = new Request(cardImageUrl(url.origin, title));
	const hit = await cache?.match(key);
	if (hit) return hit;

	const source = await loadCardSource(title);
	if (source.kind === 'missing') {
		recordEvent(platform, 'share_card', ['missing', title]);
		redirect(302, '/og.png');
	}
	if (!drawable(source.title)) {
		// A title in a script the card's fonts lack: the site card beats missing-glyph boxes.
		recordEvent(platform, 'share_card', ['undrawable', title]);
		redirect(302, '/og.png');
	}

	let image = source.image;
	let png = await renderCard(source.title, source.description, image);
	if (!png && image) {
		// Takumi rejects some files (unusual encodings, oversized frames); the card still works.
		image = null;
		png = await renderCard(source.title, source.description, null);
	}
	if (!png) {
		recordEvent(platform, 'share_card', ['render_failed', title]);
		redirect(302, '/og.png');
	}

	const complete = source.complete && image === source.image;
	const response = new Response(png, {
		headers: {
			'content-type': 'image/png',
			'cache-control': complete ? COMPLETE : DEGRADED
		}
	});
	if (cache) platform?.ctx.waitUntil(cache.put(key, response.clone()));
	recordEvent(platform, 'share_card', [complete ? (image ? 'photo' : 'text') : 'degraded', title]);
	return response;
};

/** The card as a PNG, or null when rendering fails. */
async function renderCard(
	title: string,
	description: string | null,
	image: CardImageData | null
): Promise<Uint8Array<ArrayBuffer> | null> {
	try {
		return await renderCardPng(
			cardLayout({
				title,
				description,
				image: image && { src: image.src, width: image.width, height: image.height, fit: image.fit }
			}),
			image ? [{ src: image.src, data: image.data }] : []
		);
	} catch {
		return null;
	}
}
