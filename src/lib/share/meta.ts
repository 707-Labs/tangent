/**
 * Open Graph / Twitter metadata for page responses. src/app.html carries
 * `%tangent.share.*%` placeholders; the server hook fills them per request from the URL
 * alone (see ./subject), so a page response never waits on Wikipedia.
 */
import { shareSubject } from './subject';

/** Bump when the card design changes: crawlers and the edge cache key on the image URL. */
export const CARD_VERSION = '1';
const CARD_PATH = '/og';

export interface ShareMeta {
	url: string;
	title: string;
	description: string;
	image: string;
	imageAlt: string;
}

/** The site card, shared by every page that isn't about one article. */
export const SITE_SHARE: ShareMeta = {
	url: 'https://tangent.page',
	title: 'Tangent: fall down a Wikipedia rabbit hole',
	description: 'A feed of connected Wikipedia articles that shows how unrelated topics link together.',
	image: 'https://tangent.page/og.png',
	imageAlt: 'Tangent: fall down a Wikipedia rabbit hole'
};

/** Page state worth keeping in og:url, with the page's own length caps. */
const SHARE_PARAMS = [
	['seed', 500],
	['reader', 500],
	['card', 200]
] as const;

/** Absolute URL of the generated card for an article. */
export function cardImageUrl(origin: string, title: string): string {
	const url = new URL(CARD_PATH, origin);
	url.searchParams.set('title', title);
	url.searchParams.set('v', CARD_VERSION);
	return url.href;
}

function shareMeta(url: URL): ShareMeta {
	const subject = shareSubject(url);
	if (!subject) return SITE_SHARE;
	const name = clip(subject.title, 90);
	return {
		// Facebook and LinkedIn treat og:url as canonical; the site URL would collapse every
		// article share into the site card.
		url: shareUrl(url),
		title: clip(subject.title, 120),
		description:
			subject.view === 'graph'
				? `See how ${name} connects across Wikipedia on Tangent's article map.`
				: `Fall down a Wikipedia rabbit hole from ${name}: a feed of connected articles that shows how unrelated topics link together.`,
		image: cardImageUrl(url.origin, subject.title),
		imageAlt: `${name}, on Tangent`
	};
}

const FIELDS: Record<string, (meta: ShareMeta) => string> = {
	url: (meta) => meta.url,
	title: (meta) => meta.title,
	description: (meta) => meta.description,
	image: (meta) => meta.image,
	image_alt: (meta) => meta.imageAlt
};

const PLACEHOLDER = /%tangent\.share\.([a-z_]+)%/g;

/**
 * A `transformPageChunk` that fills the share placeholders in the document head. Once
 * `</head>` has passed, chunks go through untouched: page data in the body can echo URL
 * text, and a placeholder look-alike there must stay literal.
 */
export function shareMetaFiller(url: URL): (chunk: { html: string }) => string {
	let meta: ShareMeta | undefined;
	let headClosed = false;
	return ({ html }) => {
		if (headClosed) return html;
		const end = html.indexOf('</head>');
		headClosed = end !== -1;
		const head = headClosed ? html.slice(0, end) : html;
		return fillShareMeta(head, (meta ??= shareMeta(url))) + html.slice(head.length);
	};
}

/**
 * Replace the share placeholders in one pass, so text inserted for one placeholder is
 * never rescanned as another, and a replacer function so `$&`-style patterns in titles
 * stay literal.
 */
function fillShareMeta(html: string, meta: ShareMeta): string {
	return html.replace(PLACEHOLDER, (match, key: string) => {
		const field = FIELDS[key];
		return field ? escapeAttribute(field(meta)) : match;
	});
}

const ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'"': '&quot;',
	"'": '&#39;',
	'<': '&lt;',
	'>': '&gt;'
};

/** Escape text for a double- or single-quoted HTML attribute value. */
function escapeAttribute(value: string): string {
	return value.replace(/[&"'<>]/g, (char) => ENTITIES[char]);
}

/** Shorten to at most `max` characters, at a word boundary when there is one. */
function clip(text: string, max: number): string {
	const chars = Array.from(text);
	if (chars.length <= max) return text;
	const cut = chars.slice(0, max - 1).join('');
	const space = cut.lastIndexOf(' ');
	return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function shareUrl(url: URL): string {
	const share = new URL(url.pathname, url.origin);
	for (const [key, max] of SHARE_PARAMS) {
		const value = url.searchParams.get(key);
		if (value && value.length <= max) share.searchParams.set(key, value);
	}
	return share.href;
}
