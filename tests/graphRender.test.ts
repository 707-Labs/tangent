import { describe, expect, it } from 'vitest';
import { easeFade, hitTest, litNodes, prepareGraph, sameGeometry } from '../src/lib/graph/render';
import type { WorldNode } from '../src/lib/graph/world';

const node = (title: string, x: number, y: number, region: string, neighbors: string[] = []): WorldNode =>
	({ title, description: null, thumbnail: null, x, y, region, hub: false, neighbors, explored: true, atlas: true });

const world = [
	node('A', 0, 0, 'history', ['B', 'C']),
	node('B', 100, 0, 'history', ['A']),
	node('C', 2000, 0, 'science', ['A', 'Missing']),
	node('D', 0, 900, 'mystery')
];

describe('map graph', () => {
	it('counts each link once in either direction and separates links between regions', () => {
		const graph = prepareGraph(world);
		expect(graph.edgeA.length).toBe(2);
		expect([...graph.degree]).toEqual([2, 1, 1, 0]);
		expect(graph.intra[0].length).toBe(1);
		expect(graph.cross.length).toBe(1);
		expect(graph.region[3]).toBe(-1);
		expect([...graph.members.at(-1)!]).toEqual([3]);
		expect([...litNodes(graph, [1])]).toEqual([1, 1, 0, 0]);
		expect([...litNodes(graph, [0, -1])]).toEqual([1, 1, 1, 0]);
	});

	it('reuses the graph for text-only updates but not for moved or relinked articles', () => {
		const described = world.map((item) => item.title === 'B' ? { ...item, description: 'New text' } : item);
		expect(sameGeometry(world, described)).toBe(true);
		expect(sameGeometry(world, world.map((item) => item.title === 'B' ? { ...item, x: 101 } : item))).toBe(false);
		expect(sameGeometry(world, world.map((item) => item.title === 'B' ? { ...item, neighbors: ['C'] } : item))).toBe(false);
		expect(sameGeometry(world, world.map((item) => item.title === 'B' ? { ...item, neighbors: [...item.neighbors] } : item))).toBe(true);
		expect(sameGeometry(world, world.slice(1))).toBe(false);
	});

	it('hits names first, then the nearest point within reach', () => {
		const graph = prepareGraph(world);
		const camera = { x: 10, y: 20, k: 1 };
		const hits = [{ x: 500, y: 500, width: 80, height: 15, node: 2, region: 2 }];
		expect(hitTest(graph, hits, camera, { x: 520, y: 505 }, 10)).toEqual({ node: 2, region: 2 });
		expect(hitTest(graph, hits, camera, { x: 14, y: 22 }, 10)).toEqual({ node: 0, region: 0 });
		expect(hitTest(graph, hits, camera, { x: 60, y: 20 }, 10)).toBeNull();
	});

	it('eases highlights toward their targets at the same pace at any frame rate', () => {
		const fast = new Float32Array(3), slow = new Float32Array(3);
		const lit = new Uint8Array([1, 0, 0]);
		for (let frame = 0; frame < 12; frame++) easeFade(fast, lit, 1, 10);
		for (let frame = 0; frame < 4; frame++) easeFade(slow, lit, 1, 30);
		expect(fast[0]).toBe(0);
		expect(fast[1]).toBeCloseTo(slow[1], 2);
		let frames = 0;
		while (easeFade(fast, lit, 1, 16)) frames++;
		expect(frames).toBeLessThan(40);
		expect([...fast]).toEqual([0, 1, 1]);
		expect(easeFade(fast, null, 0, 1000)).toBe(false);
		expect([...fast]).toEqual([0, 0, 0]);
	});
});
