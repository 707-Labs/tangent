import { describe, expect, it } from 'vitest';
import type { Node } from '@takumi-rs/wasm';
import { drawable } from '../src/lib/share/glyphs';
import {
	MARK_GHOST_SRC,
	MARK_IMAGES,
	MARK_SRC,
	cardImageFit,
	cardLayout,
	estimateLines,
	titleSize
} from '../src/lib/share/layout';

/** Every image `src` a layout references. */
function imageSources(node: Node): string[] {
	const own = node.type === 'image' && typeof node.src === 'string' ? [node.src] : [];
	const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
	return [...own, ...children.flatMap(imageSources)];
}

describe('cardImageFit', () => {
	it('fills the panel with photos that survive the crop', () => {
		expect(cardImageFit(960, 640, true)).toBe('cover');
		expect(cardImageFit(640, 960, true)).toBe('cover');
	});

	it('shows diagrams, maps and panoramas whole', () => {
		expect(cardImageFit(960, 640, false)).toBe('contain');
		expect(cardImageFit(960, 180, true)).toBe('contain');
	});

	it('leaves images too small to read off the card', () => {
		expect(cardImageFit(300, 200, true)).toBeNull();
		expect(cardImageFit(0, 640, true)).toBeNull();
		expect(cardImageFit(Number.NaN, 640, true)).toBeNull();
	});
});

describe('title sizing', () => {
	const sizes = [112, 100, 88, 78, 68, 60, 54];

	it('estimates more lines for longer text and narrower columns', () => {
		const title = 'List of people granted executive clemency by Donald Trump';
		expect(estimateLines('Apophenia', 112, 660, 0.47)).toBe(1);
		expect(estimateLines(title, 112, 660, 0.47)).toBeGreaterThan(estimateLines(title, 60, 660, 0.47));
		expect(estimateLines(title, 60, 300, 0.47)).toBeGreaterThan(estimateLines(title, 60, 660, 0.47));
	});

	it('breaks a word longer than a line across lines', () => {
		expect(estimateLines('x'.repeat(30), 100, 470, 0.47)).toBe(3);
	});

	it('sets short titles large and long ones smaller, within three lines', () => {
		const long = 'List of people granted executive clemency in the second Trump presidency';
		const short = titleSize('Apophenia', null, sizes, 660);
		const smaller = titleSize(long, null, sizes, 660);
		expect(short).toBe(112);
		expect(smaller).toBeLessThan(short);
		expect(estimateLines(long, smaller, 660, 0.47)).toBeLessThanOrEqual(3);
	});

	it('shrinks a title until its longest word fits on one line', () => {
		const size = titleSize('Llanfairpwllgwyngyll', null, sizes, 660);
		expect(estimateLines('Llanfairpwllgwyngyll', size, 660, 0.47)).toBe(1);
		expect(size).toBeLessThan(titleSize('Llanfair PG', null, sizes, 660));
	});

	it('leaves room for the description', () => {
		const title = 'General recursive function';
		const description = 'One of several equivalent definitions of a computable function';
		expect(titleSize(title, description, sizes, 660)).toBeLessThan(titleSize(title, null, sizes, 660));
	});

	it('clamps at the smallest size when nothing fits', () => {
		expect(titleSize('word '.repeat(80).trim(), null, sizes, 660)).toBe(54);
	});
});

describe('cardLayout', () => {
	it('places the lead image in the photo composition', () => {
		const layout = cardLayout({
			title: 'Elephant Island',
			description: 'Island off the coast of Antarctica',
			image: { src: 'lead-image', width: 960, height: 640, fit: 'cover' }
		});
		expect(imageSources(layout)).toEqual(expect.arrayContaining([MARK_SRC, 'lead-image']));
		expect(imageSources(layout)).not.toContain(MARK_GHOST_SRC);
	});

	it('carries an imageless card with the brand mark', () => {
		const layout = cardLayout({ title: 'Phatic expression', description: null, image: null });
		expect(imageSources(layout)).toEqual(expect.arrayContaining([MARK_SRC, MARK_GHOST_SRC]));
	});

	it('supplies SVG sources for both marks', () => {
		expect(Object.keys(MARK_IMAGES).sort()).toEqual([MARK_SRC, MARK_GHOST_SRC].sort());
		for (const svg of Object.values(MARK_IMAGES)) {
			expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 24 29"/);
		}
	});
});

describe('drawable', () => {
	it('accepts Latin, Latin Extended and Vietnamese text with common punctuation', () => {
		for (const text of ['Elephant Island', 'Łódź Dvořák', 'Võ Nguyên Giáp', 'Nguyễn dynasty', 'AT&T — “Long Lines” (1911–2013) €5']) {
			expect(drawable(text)).toBe(true);
		}
	});

	it('rejects scripts and symbols the bundled fonts lack', () => {
		for (const text of ['Москва', 'Ελλάδα', '東京', 'Elephant 🐘', 'μ-recursive']) {
			expect(drawable(text)).toBe(false);
		}
	});
});
