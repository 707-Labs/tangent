import type { FeedCard } from './types';
import type { Thumbnail } from '$lib/wikipedia/types';

const WIKIMEDIA_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const TRACKING_PARAMS = new Set(['utm_source', 'utm_campaign', 'utm_content']);

/** Presentation identity, not an image URL rewrite. Unknown sources exact-match. */
export function imageIdentity(source: string): string {
	const exact = `source:${source}`;
	try {
		const url = new URL(source);
		if (!WIKIMEDIA_HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) ||
			url.username || url.password || url.port || url.hash) return exact;
		// Only recognize Wikimedia's hashed original/thumbnail storage paths.
		const match = /^\/([^/]+)\/([^/]+)\/(thumb\/)?([a-f0-9])\/([a-f0-9]{2})\/([^/]+)(?:\/([^/]+))?$/i.exec(url.pathname);
		if (!match || Boolean(match[3]) !== Boolean(match[7])) return exact;
		const filename = decodeURIComponent(match[6]);
		let page = '';
		if (match[7]) {
			const rendered = decodeURIComponent(match[7]);
			const thumbnail = /^(?:lossy-)?(?:page(\d+)-)?\d+px-/i.exec(rendered);
			if (!thumbnail) return exact;
			if (thumbnail[1]) page = `:page${Number(thumbnail[1])}`;
			// An unrecognized multipage renderer must not collapse different pages.
			if (/\.(pdf|djvu)$/i.test(filename) && !page) return exact;
		}
		// Current Wikimedia summaries append these tracking fields to thumb URLs.
		// Preserve every other parameter; it may change the rendered content.
		const query = new URLSearchParams(url.search);
		for (const key of TRACKING_PARAMS) query.delete(key);
		const suffix = query.size ? `?${query}` : '';
		return `wikimedia:${match[1]}/${match[2]}/${match[4]}/${match[5]}/${filename}${page}${suffix}`;
	} catch {
		return exact;
	}
}

/** Use a verified Wikimedia thumbnail size; callers retry the original on failure. */
export function cardThumbnail(thumbnail: Thumbnail | null): Thumbnail | null {
	if (!thumbnail || !Number.isFinite(thumbnail.width) || !Number.isFinite(thumbnail.height) ||
		thumbnail.width <= 0 || thumbnail.height <= 0 || thumbnail.width >= 500) return thumbnail;
	if (!imageIdentity(thumbnail.source).startsWith('wikimedia:')) return thumbnail;
	const url = new URL(thumbnail.source);
	if (!url.pathname.includes('/thumb/')) return thumbnail;
	const rendered = /^(?:lossy-)?(?:page\d+-)?(\d+)px-/i.exec(url.pathname.split('/').at(-1) ?? '');
	if (!rendered || Number(rendered[1]) >= 500) return thumbnail;
	url.pathname = url.pathname.replace(
		/(\/(?:lossy-)?(?:page\d+-)?)\d+px-([^/]+)$/i,
		(_match, prefix: string, file: string) => `${prefix}500px-${file}`
	);
	return { source: url.toString(), width: 500,
		height: Math.max(1, Math.round(thumbnail.height * 500 / thumbnail.width)) };
}

/** First resolved, non-exhausted card per image wins. Metadata remains intact. */
export function uniqueImageCardIds(
	cards: readonly FeedCard[],
	excludedCardIds: ReadonlySet<string> = new Set()
): Set<string> {
	const identities = new Set<string>();
	const ids = new Set<string>();
	for (const card of cards) {
		const source = card.article.thumbnail?.source;
		if (card.pending || excludedCardIds.has(card.id) || !source) continue;
		const identity = imageIdentity(source);
		if (identities.has(identity)) continue;
		identities.add(identity);
		ids.add(card.id);
	}
	return ids;
}
