import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_VERSION, SITE_SHARE, cardImageUrl, shareMetaFiller } from '../src/lib/share/meta';

const TEMPLATE = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');

/** Render app.html's share block for a request URL, as the server hook does. */
const page = (path: string) => shareMetaFiller(new URL(path, 'https://tangent.page'))({ html: TEMPLATE });

/** Decoded `content` of every tag with the given property or name. */
function contents(html: string, key: string): string[] {
	const tags = html.match(/<meta\s[^>]*>/g) ?? [];
	return tags
		.filter((tag) => tag.includes(`property="${key}"`) || tag.includes(`name="${key}"`))
		.map((tag) => decode(/content="([^"]*)"/.exec(tag)?.[1] ?? ''));
}

function decode(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

describe('share metadata in app.html', () => {
	it('gives a shared article its own title and exactly one generated image per platform', () => {
		const html = page('/?reader=Elephant+Island&card=Russian+sloop+Mirny%232');
		const image = cardImageUrl('https://tangent.page', 'Elephant Island');
		expect(contents(html, 'og:title')).toEqual(['Elephant Island']);
		expect(contents(html, 'twitter:title')).toEqual(['Elephant Island']);
		expect(contents(html, 'og:image')).toEqual([image]);
		expect(contents(html, 'twitter:image')).toEqual([image]);
		expect(contents(html, 'og:description')[0]).toContain('Elephant Island');
		expect(contents(html, 'og:url')).toEqual([
			'https://tangent.page/?reader=Elephant+Island&card=Russian+sloop+Mirny%232'
		]);
		expect(html).not.toContain('%tangent.share');
	});

	it('describes an article map share as the map', () => {
		const html = page('/graph?seed=Plastic+arts');
		expect(contents(html, 'og:title')).toEqual(['Plastic arts']);
		expect(contents(html, 'og:image')).toEqual([cardImageUrl('https://tangent.page', 'Plastic arts')]);
		expect(contents(html, 'og:description')[0]).toMatch(/article map/);
	});

	it('keeps the site card on pages that are not about one article', () => {
		for (const path of ['/', '/about', '/about?seed=Apophenia']) {
			const html = page(path);
			expect(contents(html, 'og:url')).toEqual([SITE_SHARE.url]);
			expect(contents(html, 'og:title')).toEqual([SITE_SHARE.title]);
			expect(contents(html, 'og:description')).toEqual([SITE_SHARE.description]);
			expect(contents(html, 'og:image')).toEqual(['https://tangent.page/og.png']);
			expect(contents(html, 'twitter:image')).toEqual(['https://tangent.page/og.png']);
			expect(contents(html, 'og:image:alt')).toEqual([SITE_SHARE.imageAlt]);
		}
	});

	it('cannot be used to inject markup', () => {
		const html = page('/?seed=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E');
		expect(html).not.toContain('<script>alert');
		expect(contents(html, 'og:title')).toEqual([SITE_SHARE.title]);
	});

	it('escapes quotes and ampersands in titles and keeps them intact', () => {
		const title = `AT&T "Long Lines" O'Brien`;
		const html = page(`/?seed=${encodeURIComponent(title)}`);
		expect(html).toContain('content="AT&amp;T &quot;Long Lines&quot; O&#39;Brien"');
		expect(contents(html, 'og:title')).toEqual([title]);
		expect(new URL(contents(html, 'og:image')[0]).searchParams.get('title')).toBe(title);
	});

	it('inserts replacement patterns and placeholder look-alikes literally', () => {
		const html = page(`/?seed=${encodeURIComponent("$& $' %tangent.share.image%")}`);
		expect(contents(html, 'og:title')).toEqual(["$& $' %tangent.share.image%"]);
	});

	it('clips a very long title for the tags but cards the full title', () => {
		const title = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
		const html = page(`/?seed=${encodeURIComponent(title)}`);
		const ogTitle = contents(html, 'og:title')[0];
		expect(Array.from(ogTitle).length).toBeLessThanOrEqual(120);
		expect(ogTitle.endsWith('…')).toBe(true);
		expect(new URL(contents(html, 'og:image')[0]).searchParams.get('title')).toBe(title);
	});

	it('drops unrelated query parameters from og:url', () => {
		const html = page('/?seed=Apophenia&utm_source=newsletter');
		expect(contents(html, 'og:url')).toEqual(['https://tangent.page/?seed=Apophenia']);
	});
});

describe('cardImageUrl', () => {
	it('round-trips the title and carries the card version', () => {
		const url = new URL(cardImageUrl('https://tangent.page', 'Café & "Bar" #1'));
		expect(url.origin + url.pathname).toBe('https://tangent.page/og');
		expect(url.searchParams.get('title')).toBe('Café & "Bar" #1');
		expect(url.searchParams.get('v')).toBe(CARD_VERSION);
	});
});

describe('shareMetaFiller', () => {
	const at = (path: string) => shareMetaFiller(new URL(path, 'https://tangent.page'));

	it('fills only the head, leaving body text that echoes a placeholder literal', () => {
		const fill = at('/?seed=Apophenia');
		expect(fill({ html: '<head><meta content="%tangent.share.title%"></head><body>%tangent.share.title%' })).toBe(
			'<head><meta content="Apophenia"></head><body>%tangent.share.title%'
		);
		expect(fill({ html: '<script>"%tangent.share.title%"</script>' })).toBe('<script>"%tangent.share.title%"</script>');
	});

	it('fills a head that spans chunks', () => {
		const fill = at('/?seed=Apophenia');
		expect(fill({ html: '<head><meta content="%tangent.share.title%">' })).toBe('<head><meta content="Apophenia">');
		expect(fill({ html: '<meta content="%tangent.share.url%"></head>' })).toBe(
			'<meta content="https://tangent.page/?seed=Apophenia"></head>'
		);
	});
});
