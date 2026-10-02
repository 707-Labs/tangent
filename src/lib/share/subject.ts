/**
 * Which article a shared Tangent URL is about. Pure URL parsing: page responses never
 * call Wikipedia to build their share metadata.
 */

export type ShareView = 'feed' | 'graph';

export interface ShareSubject {
	title: string;
	view: ShareView;
}

const VIEWS: Partial<Record<string, ShareView>> = { '/': 'feed', '/graph': 'graph' };

/** MediaWiki's hard cap on a title, in UTF-8 bytes. */
const MAX_TITLE_BYTES = 255;
/** Characters MediaWiki never allows in a title, plus control characters and bidi isolates. */
const ILLEGAL_TITLE = /[#<>[\]{}|\u0000-\u001f\u007f\u2066-\u2069]/;
/** Direction marks and overrides, which MediaWiki strips from titles. */
const STRIPPED_BIDI = /[\u200e\u200f\u202a-\u202e]/g;
/** `.`, `..` and relative path segments, which MediaWiki forbids and URLs would resolve. */
const RELATIVE_PATH = /^\.\.?(?:\/|$)|\/\.\.?(?:\/|$)/;
/** Feed card ids are `${title}#${n}`; the suffix is per-feed bookkeeping, not part of the title. */
const CARD_SUFFIX = /#\d+$/;

/** A display title ("Elephant_Island" -> "Elephant Island"), or null when it can't be one. */
export function normalizeTitle(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const title = raw.normalize('NFC').replace(STRIPPED_BIDI, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
	if (!title || ILLEGAL_TITLE.test(title) || RELATIVE_PATH.test(title)) return null;
	if (new TextEncoder().encode(title).length > MAX_TITLE_BYTES) return null;
	return title;
}

/**
 * The article a share link points at: the open reader, else the focused card (feed
 * only), else the seed, the precedence each page itself restores. Only the feed and the
 * article map carry article state; every other route shares the site card.
 */
export function shareSubject(url: URL): ShareSubject | null {
	const view = VIEWS[url.pathname];
	if (!view) return null;
	const params = url.searchParams;
	// Same length caps as the page's locationFromUrl, which ignores longer reader/card values.
	const reader = capped(params.get('reader'), 500);
	// The map reads only seed and reader; a card parameter there is not what it shows.
	const card = view === 'feed' ? capped(params.get('card'), 200)?.replace(CARD_SUFFIX, '') : null;
	const candidates = [reader, card, params.get('seed')];
	// The first non-blank value is the subject; an invalid one falls back to the site card
	// rather than to a different article.
	const raw = candidates.find((value) => value?.trim());
	const title = normalizeTitle(raw);
	return title ? { title, view } : null;
}

function capped(value: string | null, max: number): string | null {
	return value && value.length <= max ? value : null;
}
