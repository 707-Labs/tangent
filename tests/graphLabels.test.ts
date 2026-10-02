import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxesOverlap, conflictRange, intervalAlpha, labelIntervals, LABEL_FADE, type LabelSpec } from '../src/lib/graph/labels';
import { buildLabels, prepareGraph, REGION_LABEL_MAX, type MapPalette } from '../src/lib/graph/render';
import { parseAtlas } from '../src/lib/graph/atlas';
import { atlasWorld } from '../src/lib/graph/world';

function screenBox(label: Pick<LabelSpec, 'x' | 'y' | 'width' | 'height' | 'offsetX' | 'offsetY'>, k: number) {
	const x = label.x * k + (label.offsetX ?? 0), y = label.y * k + (label.offsetY ?? 0);
	return { x: x - label.width / 2, y: y - label.height / 2, width: label.width, height: label.height };
}

/** Index pairs of overlapping boxes. */
function overlaps(boxes: readonly ReturnType<typeof screenBox>[]): [number, number][] {
	const found: [number, number][] = [];
	for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i], boxes[j])) found.push([i, j]);
	return found;
}

/** Deterministic pseudo-random labels, dense enough that most must wait for higher zooms. */
function crowd(count: number): LabelSpec[] {
	let seed = 7;
	const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	return Array.from({ length: count }, (_, i) => ({ x: next() * 3000 - 1500, y: next() * 2000 - 1000,
		width: 30 + next() * 120, height: 15, offsetY: 14, min: 0.05 * Math.sqrt(i + 1) }));
}

describe('map label intervals', () => {
	it('finds the zooms at which two labels overlap from their spacing and sizes', () => {
		const a = { x: 0, y: 0, width: 100, height: 15, min: 0 };
		const range = conflictRange(a, { ...a, x: 200 });
		expect(range.start).toBe(0);
		expect(range.end).toBeCloseTo((100 + 6) / 200);
		expect(conflictRange(a, { ...a, y: 1000 }).end).toBeCloseTo((15 + 3) / 1000);
		expect(conflictRange(a, { ...a, x: 200, offsetY: 40 })).toEqual({ start: 0, end: 0 });
	});

	it('never shows overlapping labels at any zoom, so panning cannot change which labels show', () => {
		const labels = crowd(400);
		const intervals = labelIntervals(labels, 2.3);
		for (const k of [0.05, 0.08, 0.13, 0.2, 0.33, 0.5, 0.8, 1.3, 2.3]) {
			const shown = labels.flatMap((label, i) => k >= intervals[i].start && k < intervals[i].end ? [screenBox(label, k)] : []);
			expect(shown.length, `zoom ${k}`).toBeGreaterThan(0);
			expect(overlaps(shown), `zoom ${k}`).toEqual([]);
		}
	});

	it('only adds labels as zoom increases, never trading one for another', () => {
		const labels = crowd(400);
		const intervals = labelIntervals(labels, 2.3);
		expect(intervals.every((interval) => interval.end === Infinity)).toBe(true);
		const counts = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6].map((k) => intervals.filter((interval) => k >= interval.start).length);
		expect(counts).toEqual([...counts].sort((a, b) => a - b));
		expect(counts.at(-1)).toBeGreaterThan(counts[0]);
	});

	it('shows fixed labels across their whole range and moves the others out of their way', () => {
		const region = { x: 0, y: 0, width: 100, height: 30, min: 0, max: 0.42, fixed: true };
		const [first, second, article] = labelIntervals([region, { ...region, x: 50 }, { x: 10, y: 0, width: 60, height: 15, min: 0.1 }]);
		expect(first).toEqual({ start: 0, end: 0.42 });
		expect(second).toEqual({ start: 0, end: 0.42 });
		expect(article.start).toBeGreaterThanOrEqual(0.42);
	});

	it('keeps a more important label in place and starts the lesser one after their collision ends', () => {
		const major = { x: 0, y: 0, width: 100, height: 15, min: 0 };
		const minor = { x: 50, y: 0, width: 100, height: 15, min: 0.1 };
		const [first, second] = labelIntervals([major, minor]);
		expect(first).toEqual({ start: 0, end: Infinity });
		expect(second.start).toBeCloseTo(106 / 50);
		expect(labelIntervals([major, minor], 1)[1].start).toBe(Infinity);
	});

	it('fades labels in over a short zoom range and out before a region name gives way', () => {
		const interval = { start: 0.2, end: 0.42 };
		expect(intervalAlpha(interval, 0.19)).toBe(0);
		expect(intervalAlpha(interval, 0.2 * Math.sqrt(LABEL_FADE))).toBeGreaterThan(0);
		expect(intervalAlpha(interval, 0.2 * Math.sqrt(LABEL_FADE))).toBeLessThan(1);
		expect(intervalAlpha(interval, 0.3)).toBe(1);
		expect(intervalAlpha(interval, 0.42 / Math.sqrt(LABEL_FADE))).toBeLessThan(1);
		expect(intervalAlpha(interval, 0.42)).toBe(0);
		expect(intervalAlpha({ start: 0, end: Infinity }, 0.001)).toBe(1);
		expect(intervalAlpha({ start: 1, end: 1 }, 1)).toBe(0);
	});
});

describe('atlas map labels', () => {
	const data = parseAtlas(JSON.parse(readFileSync(new URL('../static/graph/atlas.v1.json', import.meta.url), 'utf8')))!;
	const graph = prepareGraph(atlasWorld(data.nodes));
	const palette: MapPalette = { dark: true, background: '#000', ink: '#fff', muted: '#888', accent: '#fa0', bodyFont: 'sans-serif', displayFont: 'serif', regions: [], regionNames: [] };
	// A fixed advance per character stands in for canvas text measurement.
	const context = { font: '', measureText: (text: string) => ({ width: text.length * 6.5 }) } as unknown as CanvasRenderingContext2D;
	const layer = buildLabels(graph, palette, context);

	it('shows only region names at the overview and gives every region a name', () => {
		const regions = layer.labels.filter((label) => label.tier === 0);
		expect(regions).toHaveLength(7);
		expect(regions.every((label) => label.interval.start === 0 && label.interval.end === REGION_LABEL_MAX)).toBe(true);
	});

	it('names more of the atlas as zoom increases without overlapping names', () => {
		let previous = 0;
		for (const k of [0.1, 0.2, 0.35, 0.6, 1, 1.6, 2.3]) {
			const shown = layer.labels.filter((label) => k >= label.interval.start && k < label.interval.end);
			const collisions = overlaps(shown.map((label) => screenBox(label, k)));
			expect(collisions.map(([i, j]) => `${shown[i].text} / ${shown[j].text}`), `zoom ${k}`).toEqual([]);
			const articles = shown.filter((label) => label.tier > 0).length;
			expect(articles).toBeGreaterThanOrEqual(previous);
			previous = articles;
		}
		expect(previous).toBeGreaterThan(data.nodes.length / 2);
	});
});
