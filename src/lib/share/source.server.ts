/**
 * Everything a share card shows about an article, from Wikipedia's REST summary plus
 * one lead-image fetch. Each upstream call gets its own deadline, and failures degrade
 * the card instead of failing it.
 */
import type { Thumbnail } from '$lib/wikipedia/types';
import { restGet, restTitlePath, USER_AGENT } from '$lib/wikipedia/client';
import { WIKIMEDIA_HOSTS } from '$lib/feed/images';
import { drawable } from './glyphs';
import { decodedPixels } from './imageSize';
import { cardImageFit, type CardImageRef } from './layout';

const UPSTREAM_TIMEOUT_MS = 3000;
/** A 960px Wikimedia thumbnail is ~100–400 KB; anything near this cap is not a thumbnail. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Wikimedia's standard thumbnail width that covers the card's image panel. */
const PANEL_THUMB_WIDTH = 960;
/**
 * Takumi 2.14 used up to about 11 bytes of wasm memory per decoded pixel when measured,
 * and wasm memory never shrinks within an isolate. This keeps a decode near 30 MB of the
 * isolate's 128 MB; a 960px rendition up to three times as tall as it is wide fits.
 */
const MAX_IMAGE_PIXELS = PANEL_THUMB_WIDTH * 2880;
const MAX_REDIRECTS = 2;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
/** Files that are almost always photographs; other formats are usually diagrams, maps or logos. */
const PHOTO_FILE = /\.(jpe?g|tiff?)$/i;
/** Originals the card can decode as they are; anything else (SVG, TIFF, PDF) needs a rendition. */
const DECODABLE_FILE = /\.(jpe?g|png|gif|webp)$/i;

/** The REST `page/summary` fields a card uses. */
interface SummaryResponse {
	type?: string;
	title: string;
	description?: string;
	extract?: string;
	thumbnail?: Thumbnail;
	originalimage?: Thumbnail;
}

export interface CardImageData extends CardImageRef {
	data: ArrayBuffer;
}

export type CardSource =
	| {
			kind: 'article';
			title: string;
			description: string | null;
			image: CardImageData | null;
			/** False when a failed or unusable upstream response (not the article itself) left something out. */
			complete: boolean;
	  }
	| { kind: 'missing' };

export async function loadCardSource(title: string): Promise<CardSource> {
	let summary: SummaryResponse | null;
	try {
		summary = await restGet<SummaryResponse>(
			`page/summary/${restTitlePath(title)}`,
			AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
		);
	} catch {
		// Wikipedia is slow or failing: a typographic card from the requested title.
		return { kind: 'article', title, description: null, image: null, complete: false };
	}
	if (!summary) return { kind: 'missing' };

	const description = cardDescription(summary);
	const lead = leadImage(summary);
	const fit =
		lead && lead.width * lead.height <= MAX_IMAGE_PIXELS
			? cardImageFit(lead.width, lead.height, PHOTO_FILE.test(fileName(lead.source) ?? ''))
			: null;
	if (!lead || !fit) return { kind: 'article', title: summary.title, description, image: null, complete: true };
	const data = await fetchImage(lead.source).catch(() => null);
	return {
		kind: 'article',
		title: summary.title,
		description,
		image: data ? { src: 'lead-image', width: lead.width, height: lead.height, fit, data } : null,
		complete: data !== null
	};
}

/**
 * The summary's lead image at a size that fills the card: the standard 960px rendition
 * when the original is at least that wide (or is a vector), else the original itself.
 * The summary's own thumbnail stands in when the rendition's URL can't be derived or the
 * original isn't a web image format, so an original wider than 960px is never fetched.
 * Wikimedia rejects thumbnails at non-standard widths and never upscales bitmaps.
 */
export function leadImage(summary: Pick<SummaryResponse, 'thumbnail' | 'originalimage'>): Thumbnail | null {
	const thumbnail = summary.thumbnail;
	const original = summary.originalimage ?? thumbnail;
	if (!thumbnail || !original || !(original.width > 0) || !(original.height > 0)) return null;

	const file = fileName(original.source) ?? '';
	if (original.width >= PANEL_THUMB_WIDTH || /\.svg$/i.test(file)) {
		const source = resizeThumbnail(thumbnail.source, PANEL_THUMB_WIDTH);
		if (!source) return thumbnail;
		return {
			source,
			width: PANEL_THUMB_WIDTH,
			height: Math.max(1, Math.round((original.height * PANEL_THUMB_WIDTH) / original.width))
		};
	}
	return DECODABLE_FILE.test(file) ? original : thumbnail;
}

/** Rewrite a Wikimedia thumbnail URL (`…/330px-File.jpg`) to another standard width. */
function resizeThumbnail(source: string, width: number): string | null {
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		return null;
	}
	if (!url.pathname.includes('/thumb/')) return null;
	const resized = url.pathname.replace(
		/(\/(?:lossy-)?(?:page\d+-)?)\d+px-([^/]+)$/i,
		(_match, prefix: string, file: string) => `${prefix}${width}px-${file}`
	);
	if (resized === url.pathname) return null;
	url.pathname = resized;
	return url.href;
}

function fileName(source: string): string | null {
	try {
		const parts = new URL(source).pathname.split('/');
		// Thumbnails end in `/File.ext/330px-File.ext`; originals end in `/File.ext`.
		return decodeURIComponent(parts.includes('thumb') ? (parts.at(-2) ?? '') : (parts.at(-1) ?? ''));
	} catch {
		return null;
	}
}

/** Only https Wikimedia media hosts, checked again on every redirect hop. */
export function isAllowedImageUrl(url: URL): boolean {
	return (
		url.protocol === 'https:' &&
		WIKIMEDIA_HOSTS.has(url.hostname) &&
		!url.username &&
		!url.password &&
		!url.port
	);
}

async function fetchImage(source: string): Promise<ArrayBuffer> {
	const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
	let url = new URL(source);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (!isAllowedImageUrl(url)) throw new Error('image host not allowed');
		const response = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT },
			redirect: 'manual',
			signal
		});
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			await response.body?.cancel();
			if (!location) throw new Error('redirect without location');
			url = new URL(location, url);
			continue;
		}
		if (!response.ok) throw new Error(`image fetch failed (${response.status})`);
		const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		if (!IMAGE_TYPES.has(type)) throw new Error('unsupported image type');
		const data = await readCapped(response, MAX_IMAGE_BYTES);
		// The summary's dimensions were checked before fetching, but the file can have
		// changed since; the header is what Takumi will allocate for.
		const pixels = decodedPixels(new Uint8Array(data));
		if (pixels === null) throw new Error('unreadable image header');
		if (pixels > MAX_IMAGE_PIXELS) throw new Error('image too large to decode');
		return data;
	}
	throw new Error('too many redirects');
}

async function readCapped(response: Response, maxBytes: number): Promise<ArrayBuffer> {
	const declared = Number(response.headers.get('content-length'));
	if (declared > maxBytes) {
		await response.body?.cancel();
		throw new Error('image too large');
	}
	if (!response.body) throw new Error('empty image');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error('image too large');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes.buffer;
}

/** The short description, else the extract's first sentence; null when there's nothing worth showing. */
function cardDescription(summary: SummaryResponse): string | null {
	// A disambiguation page's description is the generic "Topics referred to by the same term".
	if (summary.type === 'disambiguation') return null;
	const text = summary.description?.trim() || firstSentence(summary.extract);
	return text && drawable(text) ? text : null;
}

/** First sentence of an extract, for articles without a short description. */
function firstSentence(extract: string | undefined): string | null {
	const text = extract?.replace(/\s+/g, ' ').trim();
	if (!text) return null;
	const end = text.search(/[.!?](\s|$)/);
	return end > 0 ? text.slice(0, end + 1) : text;
}
