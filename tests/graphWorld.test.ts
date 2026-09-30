import { describe, expect, it } from 'vitest';
import { initialWorld, atlasWorld, localSearch, hitNode, importNode, canonicalizeNode, appendVisit, addNeighborhood, overviewCamera, centeredCamera, zoomCamera, project, visibleNodes, visibleLabels, type WorldNode } from '../src/lib/graph/world';
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
	it('culls world nodes to the viewport and bounds rendering even with dense imports', () => {
		const camera = { x: 0, y: 0, k: 1 };
		const nodes: WorldNode[] = Array.from({ length: 800 }, (_, index) => ({ ...initialWorld()[0], title: `Node ${index}`, x: index % 500, y: index % 300, hub: false }));
		const visible = visibleNodes([...nodes, { ...nodes[0], title: 'Offscreen', x: 3000 }], camera, { width: 600, height: 400 }, 'Node 500');
		expect(visible.length).toBeLessThanOrEqual(250);
		expect(visible.length).toBeGreaterThan(0);
		expect(visible[0].node.title).toBe('Node 500');
		expect(visible.some((item) => item.node.title === 'Offscreen')).toBe(false);
	});
	it('uses semantic zoom and collision guards rather than shrinking labels together', () => {
		const world = initialWorld();
		const viewport = { width: 1200, height: 800 };
		const camera = { ...overviewCamera(viewport), k: 0.08 };
		const visible = visibleNodes(world, camera, viewport, null);
		const labels = visibleLabels(visible, camera, null);
		expect([...labels].every((title) => world.find((node) => node.title === title)?.hub)).toBe(true);
		const crowded = world.map((node, index) => ({ node, x: index * 4, y: 30 }));
		expect(visibleLabels(crowded, { ...camera, k: 1 }, null).size).toBeLessThan(5);
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
	it('keeps article labels clear of the larger topic-region controls', () => {
		const node = { ...initialWorld()[0], hub: false };
		const labels = visibleLabels([
			{ node: { ...node, title: 'Behind region' }, x: 100, y: 62 },
			{ node: { ...node, title: 'Clear article' }, x: 300, y: 62 }
		], { x: 0, y: 0, k: 0.2 }, null, [{ x: 70, y: 70, width: 80, height: 44 }]);
		expect(labels.has('Behind region')).toBe(false);
		expect(labels.has('Clear article')).toBe(true);
	});
	it('hits real canvas points independently of the bounded DOM overlay', () => {
		const world = atlasWorld(Array.from({ length: 2000 }, (_, index) => ({ title: `Article ${index}`, description: null, thumbnail: null,
			x: index, y: 100, region: 'history', hub: false, neighbors: [] })));
		const camera = { x: 10, y: 20, k: 1 };
		const target = world[999];
		expect(visibleNodes(world, camera, { width: 2200, height: 500 }, null).some(({ node }) => node === target)).toBe(false);
		expect(hitNode(world, camera, project(target, camera))?.title).toBe(target.title);
		expect(hitNode(world, camera, { x: 500, y: 500 })).toBeNull();
	});
	it('finds canonical atlas titles and aliases locally without a global search response', () => {
		const world = importNode(initialWorld(), { title: 'United States', description: 'Country', thumbnail: null });
		const aliases = new Map([['USA', 'United States']]);
		expect(localSearch(world, 'USA', aliases)[0]?.title).toBe('United States');
		expect(localSearch(world, 'United', aliases)[0]?.title).toBe('United States');
		expect(localSearch(world, 'Unknown title', aliases)).toEqual([]);
	});
});
