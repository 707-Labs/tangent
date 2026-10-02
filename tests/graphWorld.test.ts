import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialWorld, atlasWorld, localSearch, importNode, canonicalizeNode, appendVisit, addNeighborhood, overviewCamera, mapTop, centeredCamera, zoomCamera, project, MAP_EXTENT, REGIONS } from '../src/lib/graph/world';
import { parseAtlas } from '../src/lib/graph/atlas';
import { MIN_SEPARATION } from '../scripts/layout-atlas';
import type { Candidate } from '../src/lib/wikipedia/types';

const candidate = (title: string): Candidate => ({ title, description: null, thumbnail: null, categories: [], position: 0, relation: 'link', isDisambiguation: false });

describe('article world', () => {
	it.each(['summary first', 'links first'])('preserves atlas metadata and verified links for an unknown redirect: %s', (order) => {
		const atlas = atlasWorld([{ title: 'United States', description: 'Snapshot country', thumbnail: null,
			x: 123, y: 456, region: 'places', hub: false, neighbors: ['Mexico'] },
			{ title: 'Mexico', description: null, thumbnail: null, x: 321, y: 654, region: 'places', hub: false, neighbors: ['United States'] }]);
		const canonical = { title: 'United States', description: 'Live changed description', thumbnail: null };
		let world = importNode(atlas, { title: 'Unknown redirect', description: null, thumbnail: null });
		if (order === 'links first') {
			world = addNeighborhood(world, 'Unknown redirect', [candidate('Live related page')]);
			world = canonicalizeNode(world, 'Unknown redirect', canonical);
		} else {
			world = canonicalizeNode(world, 'Unknown redirect', canonical);
			world = addNeighborhood(world, 'United States', [candidate('Live related page')]);
		}
		expect(world.find((node) => node.title === 'United States')).toEqual(atlas[0]);
		expect(world.some((node) => node.title === 'Unknown redirect')).toBe(false);
		expect(world.find((node) => node.title === 'Mexico')).toEqual(atlas[1]);
	});
	it('merges redirects at the first placement and rewrites incoming and outgoing references', () => {
		for (const titles of [['USA', 'United States'], ['United States', 'USA']]) {
			let world = initialWorld();
			for (const title of titles) world = importNode(world, { title, description: null, thumbnail: null });
			const first = world.find((node) => node.title === titles[0])!;
			world = addNeighborhood(world, 'History', [candidate('USA'), candidate('United States')]);
			world = addNeighborhood(world, 'USA', [candidate('Mexico'), candidate('United States')]);
			world = canonicalizeNode(world, 'USA', { title: 'United States', description: 'Country', thumbnail: null });
			const merged = world.find((node) => node.title === 'United States')!;
			expect(world.some((node) => node.title === 'USA')).toBe(false);
			expect(merged.x).toBe(first.x);
			expect(merged.y).toBe(first.y);
			expect(merged.neighbors).toEqual(['Mexico']);
			expect(merged.explored).toBe(true);
			expect(world.find((node) => node.title === 'History')?.neighbors).toEqual(['United States']);
		}
	});
	it('retains actual repeated visits without fabricating shortcuts and bounds the history', () => {
		let visits: string[] = [];
		for (const title of ['A', 'B', 'C', 'B', 'B']) visits = appendVisit(visits, title);
		expect(visits).toEqual(['A', 'B', 'C', 'B']);
		for (let index = 0; index < 20; index++) visits = appendVisit(visits, String(index));
		expect(visits).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 8)));
	});
	it('preserves the world point under the pointer through zoom and its limits', () => {
		const camera = { x: 230, y: -180, k: 0.8 };
		const pointer = { x: 97, y: 510 };
		const worldPoint = { x: (pointer.x - camera.x) / camera.k, y: (pointer.y - camera.y) / camera.k };
		for (const factor of [1.35, 100, 0.0001]) {
			const next = zoomCamera(camera, factor, pointer);
			expect(project(worldPoint, next).x).toBeCloseTo(pointer.x);
			expect(project(worldPoint, next).y).toBeCloseTo(pointer.y);
			expect(next.k).toBeGreaterThanOrEqual(0.045);
			expect(next.k).toBeLessThanOrEqual(2.3);
		}
	});
	it('reframes selection clear of desktop and mobile details while retaining zoom', () => {
		const node = { x: 2650, y: -1250 };
		for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 600 }]) {
			const next = centeredCamera(node, viewport, 1.7);
			const screen = project(node, next);
			expect(next.k).toBe(1.7);
			expect(screen.x).toBeCloseTo(viewport.width * (viewport.width > 760 ? 0.4 : 0.5));
			expect(screen.y).toBeCloseTo(viewport.height * (viewport.width > 760 ? 0.5 : 0.38));
		}
	});
	it('creates deterministic real landmarks spread over a large coordinate space', () => {
		const world = initialWorld();
		expect(world).toEqual(initialWorld());
		expect(world.filter((node) => node.hub)).toHaveLength(7);
		expect(Math.max(...world.map((node) => node.x)) - Math.min(...world.map((node) => node.x))).toBeGreaterThan(5000);
		expect(new Set(world.map((node) => node.title)).size).toBe(world.length);
	});
	it('preserves first positions when an article is shared by two neighborhoods', () => {
		const initial = initialWorld();
		const first = addNeighborhood(initial, 'History', [candidate('Shared article'), candidate('History'), { ...candidate('Ambiguous'), isDisambiguation: true }]);
		const position = first.find((node) => node.title === 'Shared article')!;
		const next = addNeighborhood(first, 'Science', [candidate('Shared article')]);
		expect(next.filter((node) => node.title === 'Shared article')).toHaveLength(1);
		expect(next.find((node) => node.title === 'Shared article')).toEqual(position);
		expect(first.find((node) => node.title === 'History')?.neighbors).toEqual(['Shared article']);
		expect(next.find((node) => node.title === 'Science')?.neighbors).toEqual(['Shared article']);
	});
	it('keeps imported articles stable and separates dense new neighborhoods', () => {
		const initial = initialWorld();
		const imported = importNode(initial, { title: 'A searched article', description: null, thumbnail: null });
		expect(importNode(initial, { title: 'A searched article', description: null, thumbnail: null })).toEqual(imported);
		const next = addNeighborhood(imported, 'A searched article', Array.from({ length: 40 }, (_, index) => candidate(`Neighbor ${index}`)));
		for (const node of next.filter((item) => item.title.startsWith('Neighbor'))) {
			expect(next.filter((other) => other.title !== node.title).every((other) => Math.hypot(other.x - node.x, other.y - node.y) >= 85)).toBe(true);
		}
	});
	it('keeps static positions and every atlas node when live exploration exceeds its budget', () => {
		const articles = Array.from({ length: 2000 }, (_, index) => ({ title: `Atlas ${index}`, description: 'Mapped article', thumbnail: null,
			x: index, y: index % 100, region: 'science', hub: false, neighbors: ['Atlas 1'] }));
		let world = atlasWorld(articles, [ { ...initialWorld()[0], title: 'Atlas 0', x: -999 } ]);
		expect(world.find((node) => node.title === 'Atlas 0')?.x).toBe(0);
		const live = Array.from({ length: 1300 }, (_, index) => ({ ...initialWorld()[0], title: `Live ${index}`, hub: false }));
		world = addNeighborhood([...world, ...live], 'Live 1299', [candidate('Live addition')]);
		expect(world.filter((node) => node.atlas)).toHaveLength(2000);
		expect(world.filter((node) => !node.atlas).length).toBeLessThanOrEqual(1200);
	});
	it('fits the whole map between the search panel and the controls at desktop and phone sizes', () => {
		for (const viewport of [{ width: 1280, height: 739 }, { width: 390, height: 775 }, { width: 375, height: 598 }, { width: 320, height: 560 }]) {
			const camera = overviewCamera(viewport);
			const top = mapTop(viewport);
			expect(top).toBe(viewport.width > 760 ? 104 : 288);
			const corners = [project({ x: MAP_EXTENT.minX, y: MAP_EXTENT.minY }, camera), project({ x: MAP_EXTENT.maxX, y: MAP_EXTENT.maxY }, camera)];
			expect(corners[0].x).toBeGreaterThanOrEqual(24 - 1e-9);
			expect(corners[1].x).toBeLessThanOrEqual(viewport.width - 24 + 1e-9);
			expect(corners[0].y).toBeGreaterThanOrEqual(top - 1e-9);
			expect(corners[1].y).toBeLessThanOrEqual(viewport.height - 72 + 1e-9);
		}
	});
	it('keeps the bundled atlas inside the map extent with every hub at its region center', () => {
		const data = parseAtlas(JSON.parse(readFileSync(new URL('../static/graph/atlas.v1.json', import.meta.url), 'utf8')))!;
		for (const node of data.nodes) {
			expect(node.x).toBeGreaterThanOrEqual(MAP_EXTENT.minX);
			expect(node.x).toBeLessThanOrEqual(MAP_EXTENT.maxX);
			expect(node.y).toBeGreaterThanOrEqual(MAP_EXTENT.minY);
			expect(node.y).toBeLessThanOrEqual(MAP_EXTENT.maxY);
		}
		for (const region of REGIONS) {
			const hub = data.nodes.find((node) => node.hub && node.region === region.id);
			expect(hub, region.id).toBeDefined();
			expect(Math.hypot(hub!.x - region.x, hub!.y - region.y)).toBeLessThan(1);
		}
	});
	it('spaces bundled articles far enough apart that each point stays clickable', () => {
		const { nodes } = parseAtlas(JSON.parse(readFileSync(new URL('../static/graph/atlas.v1.json', import.meta.url), 'utf8')))!;
		let closest = Infinity;
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
			closest = Math.min(closest, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y));
		}
		expect(closest).toBeGreaterThanOrEqual(MIN_SEPARATION);
	});
	it('lays the bundled atlas out from its links, so linked articles sit together', () => {
		const { nodes } = parseAtlas(JSON.parse(readFileSync(new URL('../static/graph/atlas.v1.json', import.meta.url), 'utf8')))!;
		const median = (values: Float64Array) => values.sort()[values.length >> 1];
		const byTitle = new Map(nodes.map((node) => [node.title, node]));
		const links = nodes.flatMap((node) => node.neighbors.flatMap((title) => {
			const other = byTitle.get(title);
			return other && node.title < title ? [Math.hypot(node.x - other.x, node.y - other.y)] : [];
		}));
		const pairs = new Float64Array(nodes.length * (nodes.length - 1) / 2);
		let n = 0;
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) pairs[n++] = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
		// Crawl positions, which an interrupted build:atlas leaves behind, measure about 0.28 here.
		expect(median(Float64Array.from(links)) / median(pairs)).toBeLessThan(0.2);
	});
	it('finds canonical atlas titles and aliases locally without a global search response', () => {
		const world = importNode(initialWorld(), { title: 'United States', description: 'Country', thumbnail: null });
		const aliases = new Map([['USA', 'United States']]);
		expect(localSearch(world, 'USA', aliases)[0]?.title).toBe('United States');
		expect(localSearch(world, 'United', aliases)[0]?.title).toBe('United States');
		expect(localSearch(world, 'Unknown title', aliases)).toEqual([]);
	});
});
