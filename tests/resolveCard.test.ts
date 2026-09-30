import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheDelete } from '../src/lib/server/cache';

const { fetchArticle, fetchArticleHtml, extractLeadImage } = vi.hoisted(() => ({
	fetchArticle: vi.fn(), fetchArticleHtml: vi.fn(), extractLeadImage: vi.fn()
}));
vi.mock('../src/lib/wikipedia/rest', () => ({ fetchArticle }));
vi.mock('../src/lib/wikipedia/article', () => ({ fetchArticleHtml }));
vi.mock('../src/lib/wikipedia/leadImage', () => ({ extractLeadImage }));
import { resolveCard } from '../src/lib/server/resolveCard';

const article = {
	title: 'Concept', description: 'A broad idea', extract: 'The readable summary.',
	thumbnail: null, wikiUrl: 'https://en.wikipedia.org/wiki/Concept', lang: 'en', tokens: ['concept']
};

describe('card loading critical path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of ['card:Concept', 'article:Concept', 'leadimg:Concept']) cacheDelete(key);
		fetchArticle.mockResolvedValue(article);
	});

	it('returns an imageless immediate card without requesting a full article', async () => {
		// A full article that never arrives must not block the seed/dive path.
		fetchArticleHtml.mockImplementation(() => new Promise(() => {}));
		expect(await resolveCard('Concept', { leadImage: false })).toEqual({ article, degraded: false });
		expect(fetchArticle).toHaveBeenCalledOnce();
		expect(fetchArticleHtml).not.toHaveBeenCalled();
	});

	it('retains full-article image enrichment for buffered cards sharing the summary cache', async () => {
		await resolveCard('Concept', { leadImage: false });
		const thumbnail = { source: 'https://upload.wikimedia.org/lead.jpg', width: 640, height: 480 };
		fetchArticleHtml.mockResolvedValue('<figure>image</figure>');
		extractLeadImage.mockReturnValue(thumbnail);
		expect(await resolveCard('Concept')).toEqual({ article: { ...article, thumbnail }, degraded: false });
		expect(fetchArticle).toHaveBeenCalledOnce();
		expect(fetchArticleHtml).toHaveBeenCalledOnce();
	});

	it('retains existing summary thumbnails for immediate cards', async () => {
		const thumbnail = { source: 'https://upload.wikimedia.org/summary.jpg', width: 320, height: 240 };
		fetchArticle.mockResolvedValue({ ...article, thumbnail });
		expect((await resolveCard('Concept', { leadImage: false })).article?.thumbnail).toEqual(thumbnail);
		expect(fetchArticleHtml).not.toHaveBeenCalled();
	});
});
