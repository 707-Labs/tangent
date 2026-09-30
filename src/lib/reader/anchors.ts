import { articleTitleFromHref } from '$lib/wikipedia/links';

/** Parsoid uses full page URLs even for footnotes in the current article. */
export function localArticleAnchor(href: string, title: string): string | null {
	if (href.startsWith('#')) return href;
	if (articleTitleFromHref(href) !== title.replace(/_/g, ' ')) return null;
	try {
		return new URL(href, 'https://en.wikipedia.org').hash || null;
	} catch {
		return null;
	}
}
