import { describe, expect, it } from 'vitest';
import { normalizeTitle, shareSubject } from '../src/lib/share/subject';

const at = (path: string) => shareSubject(new URL(path, 'https://tangent.page'));

describe('shareSubject', () => {
	it('prefers the open reader, then the focused card, then the seed', () => {
		expect(at('/?seed=Apophenia&reader=Elephant+Island&card=Russian+sloop+Mirny%232')).toEqual({
			title: 'Elephant Island',
			view: 'feed'
		});
		expect(at('/?seed=Apophenia&card=Russian+sloop+Mirny%232')?.title).toBe('Russian sloop Mirny');
		expect(at('/?seed=Apophenia')?.title).toBe('Apophenia');
	});

	it("strips the feed card's #n suffix but keeps a title that merely contains digits", () => {
		expect(at('/?card=Russian+sloop+Mirny%2312')?.title).toBe('Russian sloop Mirny');
		expect(at('/?card=Apollo+11')?.title).toBe('Apollo 11');
	});

	it('describes the article map separately from the feed', () => {
		expect(at('/graph?seed=Plastic+arts')).toEqual({ title: 'Plastic arts', view: 'graph' });
		expect(at('/graph?seed=Plastic+arts&reader=Clay')).toEqual({ title: 'Clay', view: 'graph' });
	});

	it('ignores card on the article map, which never reads it', () => {
		expect(at('/graph?card=Clay%232&seed=Plastic+arts')?.title).toBe('Plastic arts');
	});

	it('gives every other route, and a bare feed, the site card', () => {
		expect(at('/about?seed=Apophenia')).toBeNull();
		expect(at('/graph/extra?seed=Apophenia')).toBeNull();
		expect(at('/')).toBeNull();
		expect(at('/?seed=+++')).toBeNull();
	});

	it('normalizes underscores and whitespace the way Wikipedia titles read', () => {
		expect(at('/?seed=Elephant_Island')?.title).toBe('Elephant Island');
		expect(at('/?seed=++Elephant%09%09Island++')?.title).toBe('Elephant Island');
	});

	it('falls back to the site card, not another article, when the subject is invalid', () => {
		expect(at('/?seed=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')).toBeNull();
		expect(at('/?reader=Foo%7CBar&seed=Apophenia')).toBeNull();
	});

	it('ignores reader and card values longer than the page itself accepts', () => {
		const long = 'x'.repeat(501);
		expect(at(`/?reader=${long}&seed=Apophenia`)?.title).toBe('Apophenia');
		expect(at(`/?card=${'y'.repeat(201)}&seed=Apophenia`)?.title).toBe('Apophenia');
	});
});

describe('normalizeTitle', () => {
	it("enforces MediaWiki's 255-byte title limit in UTF-8, not characters", () => {
		expect(normalizeTitle('a'.repeat(255))).toBe('a'.repeat(255));
		expect(normalizeTitle('a'.repeat(256))).toBeNull();
		// 128 two-byte characters are 256 bytes.
		expect(normalizeTitle('é'.repeat(128))).toBeNull();
	});

	it('rejects characters a title can never contain', () => {
		for (const bad of ['A#B', 'A<B', 'A>B', 'A[B', 'A]B', 'A{B', 'A}B', 'A|B', 'A\u0000B', 'A\u007fB']) {
			expect(normalizeTitle(bad)).toBeNull();
		}
	});

	it('keeps punctuation that real titles use', () => {
		expect(normalizeTitle(`AT&T "Long Lines" O'Brien: $&`)).toBe(`AT&T "Long Lines" O'Brien: $&`);
		for (const title of ['AC/DC', 'Mr. Bean', '...', 'Ellipsis (...)']) expect(normalizeTitle(title)).toBe(title);
	});

	it('rejects titles that would act as relative URL paths', () => {
		for (const bad of ['.', '..', './Foo', '../Foo', 'Foo/./Bar', 'Foo/../Bar', 'Foo/.', 'Foo/..']) {
			expect(normalizeTitle(bad)).toBeNull();
		}
	});

	it('drops the direction marks MediaWiki strips and rejects bidi isolates', () => {
		expect(normalizeTitle('Elephant\u202e Island')).toBe('Elephant Island');
		expect(normalizeTitle('\u200fMoscow')).toBe('Moscow');
		expect(normalizeTitle('Elephant \u2066Island\u2069')).toBeNull();
	});

	it('composes Unicode the way MediaWiki stores titles', () => {
		expect(normalizeTitle('Dvor\u030cák')).toBe('Dvořák');
	});
});
