import { describe, expect, it } from 'vitest';
import { cardThumbnail, imageIdentity, uniqueImageCardIds } from '../src/lib/feed/images';
import type { FeedCard } from '../src/lib/feed/types';

// Actual Commons photo repeated by Ancient Greek architecture and Ancient Greece.
const PARTHENON = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a4/Parthenon_%2830276156187%29.jpg/330px-Parthenon_%2830276156187%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail';
const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Parthenon_(30276156187).jpg';

function card(id: string, source: string | null, pending = false): FeedCard {
	return { id, pending, connection: { fromTitle: '', relation: 'seed' }, article: {
		title: id, description: null, extract: 'Readable article', tokens: [id], lang: 'en',
		wikiUrl: `https://en.wikipedia.org/wiki/${id}`,
		thumbnail: source ? { source, width: 330, height: 220 } : null
	} };
}

describe('feed image identity', () => {
	it('recognizes the actual repeated Parthenon image across encoding, host and width', () => {
		expect(imageIdentity(PARTHENON)).toBe(imageIdentity(ORIGINAL));
		expect(imageIdentity(PARTHENON.replace('330px-', '250px-'))).toBe(imageIdentity(ORIGINAL));
	});

	it('matches an SVG raster thumbnail with its original but preserves distinct files and repositories', () => {
		const original = 'https://upload.wikimedia.org/wikipedia/commons/1/12/Example.svg';
		const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Example.svg/120px-Example.svg.png';
		expect(imageIdentity(thumb)).toBe(imageIdentity(original));
		expect(imageIdentity(original.replace('commons', 'en'))).not.toBe(imageIdentity(original));
		expect(imageIdentity(original.replace('Example.svg', 'Other.svg'))).not.toBe(imageIdentity(original));
		expect(imageIdentity(original.replace('/1/12/', '/a/ab/'))).not.toBe(imageIdentity(original));
	});

	it.each(['pdf', 'djvu'])('keeps %s rendered pages distinct across thumbnail widths', (extension) => {
		const base = `https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Book.${extension}/`;
		const first = `${base}page1-200px-Book.${extension}.jpg`;
		expect(imageIdentity(first)).toBe(imageIdentity(`${base}lossy-page1-400px-Book.${extension}.jpg`));
		expect(imageIdentity(first)).not.toBe(imageIdentity(`${base}page2-200px-Book.${extension}.jpg`));
		expect(imageIdentity(first)).not.toBe(imageIdentity(base.replace('/thumb/', '/').replace(/\/$/, '')));
	});

	it('exact-matches unknown or invalid sources and preserves unknown query parameters', () => {
		const external = 'https://images.example/photo.jpg?width=100';
		expect(imageIdentity(external)).not.toBe(imageIdentity(external.replace('100', '200')));
		expect(imageIdentity('not a URL')).toBe(imageIdentity('not a URL'));
		expect(imageIdentity('not a URL')).not.toBe(imageIdentity('not a URL '));
		expect(imageIdentity(`${ORIGINAL}?page=1`)).not.toBe(imageIdentity(`${ORIGINAL}?page=2`));
		expect(imageIdentity(ORIGINAL.replace('.jpg', '%ZZ.jpg'))).toBe(`source:${ORIGINAL.replace('.jpg', '%ZZ.jpg')}`);
	});
});

describe('card thumbnail resolution', () => {
	it('requests the verified 500px Parthenon variant, preserving encoded filename and tracking', () => {
		const thumbnail = { source: PARTHENON, width: 330, height: 220 };
		expect(cardThumbnail(thumbnail)).toEqual({ source: PARTHENON.replace('330px-', '500px-'),
			width: 500, height: 333 });
		expect(thumbnail.width).toBe(330);
	});

	it('preserves SVG raster suffixes, document page prefixes and unknown query parameters', () => {
		const source = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Book.pdf/lossy-page2-200px-Book.pdf.jpg?download=1';
		expect(cardThumbnail({ source, width: 200, height: 300 })).toEqual({
			source: source.replace('200px-', '500px-'), width: 500, height: 750 });
		const svg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Image.svg/120px-Image.svg.png';
		expect(cardThumbnail({ source: svg, width: 120, height: 60 })?.source).toBe(svg.replace('120px-', '500px-'));
	});

	it('leaves unknown URLs, originals, invalid dimensions and larger sources unchanged', () => {
		for (const thumbnail of [
			{ source: 'https://example.org/330px-photo.jpg', width: 330, height: 220 },
			{ source: ORIGINAL, width: 330, height: 220 },
			{ source: 'not a URL', width: 330, height: 220 },
			{ source: PARTHENON, width: 0, height: 220 },
			{ source: PARTHENON, width: 330, height: Number.NaN },
			{ source: PARTHENON, width: 330, height: -1 },
			{ source: PARTHENON, width: Number.POSITIVE_INFINITY, height: 220 },
			{ source: PARTHENON.replace('330px-', '960px-'), width: 960, height: 640 },
			{ source: PARTHENON.replace('330px-', '960px-'), width: 330, height: 220 }
		]) expect(cardThumbnail(thumbnail)).toBe(thumbnail);
		expect(cardThumbnail(null)).toBeNull();
	});
});

describe('feed image presentation', () => {
	it('lets a later original-size source try after the first card exhausts its image sources', () => {
		const cards = [card('failed', PARTHENON), card('retry', PARTHENON.replace('330px-', '250px-'))];
		expect([...uniqueImageCardIds(cards)]).toEqual(['failed']);
		const exhausted = new Set(['failed']);
		expect([...uniqueImageCardIds(cards, exhausted)]).toEqual(['retry']);
		expect(exhausted).toEqual(new Set(['failed']));
		expect(cards[1].article.thumbnail?.source).toContain('250px-');
	});

	it('shows the first resolved occurrence while retaining later article metadata', () => {
		const cards = [card('pending', ORIGINAL, true), card('architecture', PARTHENON),
			card('greece', ORIGINAL), card('text', null), card('other', 'https://example.org/other.jpg')];
		const before = structuredClone(cards);
		expect([...uniqueImageCardIds(cards)]).toEqual(['architecture', 'other']);
		expect(cards).toEqual(before);
	});

	it('recomputes from the visible chain when a session resets or restores a shorter trail', () => {
		const old = card('old', ORIGINAL);
		const later = card('later', PARTHENON);
		expect([...uniqueImageCardIds([old, later])]).toEqual(['old']);
		expect([...uniqueImageCardIds([later])]).toEqual(['later']);
		expect([...uniqueImageCardIds([])]).toEqual([]);
		expect([...uniqueImageCardIds([later, old])]).toEqual(['later']);
	});
});
