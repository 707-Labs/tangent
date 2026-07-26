import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveCard } from '$lib/server/resolveCard';
import { recordEvent } from '$lib/server/metrics';
import { fetchCategoriesFor } from '$lib/wikipedia/action';
import { cached, TTL } from '$lib/server/cache';

/**
 * GET /api/card?title=Roman%20Empire -> { article } (or null if it doesn't exist).
 * With &categories=1, adds the article's complete non-hidden categories — the
 * /graph playground needs them to sector a bare seed's first hop, and Article
 * deliberately doesn't carry them (the feed's candidates get theirs in batch).
 */
export const GET: RequestHandler = async ({ url, setHeaders, platform }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) return json({ article: null, error: 'missing title' }, { status: 400 });
	const withCategories = url.searchParams.get('categories') === '1';

	try {
		const { article, degraded } = await resolveCard(title);
		let categories: string[] = [];
		if (withCategories && article) {
			const canonical = article.title;
			try {
				categories = await cached(`cats:${canonical}`, TTL.long, async () => {
					const map = await fetchCategoriesFor([canonical]);
					return map.get(canonical) ?? map.values().next().value ?? [];
				});
			} catch {
				// Best-effort: a card without categories still renders; the graph just
				// falls back to an unsectored fan for this hop.
			}
		}
		// A degraded (imageless) card is only briefly cacheable: the Cloudflare edge
		// caches these, and a long-lived degraded copy would pin an imageless card on
		// every client until it expires. Same logic for a category-less categories=1
		// response — usually an upstream blip, not a truly uncategorized article.
		const brief = degraded || (withCategories && categories.length === 0);
		setHeaders({ 'cache-control': brief ? 'public, max-age=60' : 'public, max-age=3600' });
		recordEvent(platform, 'feed_served', [title]);
		return json(withCategories ? { article, categories } : { article });
	} catch {
		return json({ article: null, error: 'upstream error' }, { status: 502 });
	}
};
