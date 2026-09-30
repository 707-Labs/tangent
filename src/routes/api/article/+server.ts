import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchArticleHtml } from '$lib/wikipedia/article';
import { cached, TTL } from '$lib/server/cache';
import { ARTICLE_RENDER_VERSION } from '$lib/reader/version';

/** GET /api/article?title=Octopus -> { html } sanitized full-article body for inline reading. */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) return json({ html: null, error: 'missing title' }, { status: 400 });

	try {
		const html = await cached(`article:v${ARTICLE_RENDER_VERSION}:${title}`, TTL.long, () => fetchArticleHtml(title));
		setHeaders({ 'cache-control': 'public, max-age=3600' });
		return json({ html });
	} catch {
		return json({ html: null, error: 'upstream error' }, { status: 502 });
	}
};
