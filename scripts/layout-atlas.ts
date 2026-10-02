/**
 * Constellation layout for the bundled atlas. Run: bun scripts/layout-atlas.ts
 *
 * Positions come from the link graph rather than crawl order, so linked articles sit together
 * and the seven topic regions read as separate clusters:
 * 1. Label propagation moves each article into the region most of its links point to.
 *    Region landmarks and neighborhood anchors keep their curated region.
 * 2. Louvain communities split each region into sub-clusters.
 * 3. ForceAtlas2 (LinLog) arranges each region around its pinned hub. Links within a community
 *    pull hardest; links to other regions draw an article toward the side facing that region.
 * 4. Each region is scaled to an area proportional to its size, stragglers are pulled in, and a
 *    final pass enforces a minimum spacing between points.
 * The result is deterministic: starting positions derive from title hashes, not the input.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, titleHash } from '../src/lib/graph/world';
import { NEIGHBORHOODS } from '../src/lib/graph/discovery';
import { ATLAS_BOUNDS, parseAtlas, type AtlasArticle } from '../src/lib/graph/atlas';

/** Points never sit closer than this, so every article stays individually clickable. */
export const MIN_SEPARATION = 50;
/** 92nd-percentile radius of a region with 290 articles; area scales with article count. */
const REGION_RADIUS = 760;
const ITERATIONS = 700;
const COMMUNITY_PULL = 3;
const BRIDGE_PULL = 0.4;
const FOREIGN_PULL = 0.3;
const GRAVITY = 0.6;

export interface LayoutStats {
	moved: number;
	rounds: number;
	intraRegionShare: number;
	communities: Record<string, number>;
	minSeparation: number;
}

/** Undirected adjacency as indices into `nodes`. */
function adjacency(nodes: readonly AtlasArticle[]): number[][] {
	const index = new Map(nodes.map((node, i) => [node.title, i]));
	return nodes.map((node) => [...new Set(node.neighbors.map((title) => index.get(title)).filter((j): j is number => j !== undefined))]);
}

function propagateRegions(nodes: readonly AtlasArticle[], links: number[][]): { regions: string[]; moved: number; rounds: number } {
	const index = new Map(nodes.map((node, i) => [node.title, i]));
	const fixed = new Map<number, string>();
	for (const region of REGIONS) for (const title of region.titles) { const i = index.get(title); if (i !== undefined) fixed.set(i, region.id); }
	for (const item of NEIGHBORHOODS) { const i = index.get(item.anchor); if (i !== undefined) fixed.set(i, item.region); }
	let regions = nodes.map((node, i) => fixed.get(i) ?? node.region);
	const initial = [...regions];
	let rounds = 0;
	for (; rounds < 100; rounds++) {
		const next = [...regions];
		let changes = 0;
		for (let i = 0; i < nodes.length; i++) {
			if (fixed.has(i)) continue;
			// The current region votes first with inertia, so ties never flip an article.
			const votes = new Map<string, number>([[regions[i], 1]]);
			for (const j of links[i]) votes.set(regions[j], (votes.get(regions[j]) ?? 0) + 1 / Math.sqrt(links[j].length));
			let best = regions[i];
			let bestVotes = -1;
			for (const [region, count] of votes) if (count > bestVotes + 1e-9) { best = region; bestVotes = count; }
			if (best !== regions[i]) { next[i] = best; changes++; }
		}
		regions = next;
		if (!changes) break;
	}
	return { regions, moved: regions.filter((region, i) => region !== initial[i]).length, rounds };
}

/** Louvain modularity communities with deterministic visiting order. */
function louvain(count: number, edges: [number, number, number][]): number[] {
	let membership = Array.from({ length: count }, (_, i) => i);
	let size = count;
	let current = edges;
	for (let level = 0; level < 10; level++) {
		const weights: Map<number, number>[] = Array.from({ length: size }, () => new Map());
		const strength = new Float64Array(size);
		let total = 0;
		for (const [a, b, w] of current) {
			weights[a].set(b, (weights[a].get(b) ?? 0) + w);
			if (a !== b) weights[b].set(a, (weights[b].get(a) ?? 0) + w);
			strength[a] += w; strength[b] += w; total += 2 * w;
		}
		if (!total) break;
		const community = Array.from({ length: size }, (_, i) => i);
		const totals = Float64Array.from(strength);
		let improved = false;
		for (let pass = 0; pass < 50; pass++) {
			let moves = 0;
			for (let i = 0; i < size; i++) {
				const from = community[i];
				totals[from] -= strength[i];
				const shared = new Map<number, number>();
				for (const [j, w] of weights[i]) if (j !== i) shared.set(community[j], (shared.get(community[j]) ?? 0) + w);
				let best = from;
				let bestGain = (shared.get(from) ?? 0) - totals[from] * strength[i] / total;
				for (const [candidate, w] of shared) {
					const gain = w - totals[candidate] * strength[i] / total;
					if (gain > bestGain + 1e-12) { best = candidate; bestGain = gain; }
				}
				community[i] = best;
				totals[best] += strength[i];
				if (best !== from) { moves++; improved = true; }
			}
			if (!moves) break;
		}
		if (!improved) break;
		const ids = new Map<number, number>();
		for (const value of community) if (!ids.has(value)) ids.set(value, ids.size);
		membership = membership.map((value) => ids.get(community[value])!);
		const merged = new Map<string, number>();
		for (const [a, b, w] of current) {
			const ca = ids.get(community[a])!;
			const cb = ids.get(community[b])!;
			const key = ca < cb ? `${ca},${cb}` : `${cb},${ca}`;
			merged.set(key, (merged.get(key) ?? 0) + w);
		}
		current = [...merged].map(([key, w]) => { const [a, b] = key.split(',').map(Number); return [a, b, w]; });
		size = ids.size;
	}
	return membership;
}

/** ForceAtlas2 with LinLog attraction and adaptive speed, in unitless local coordinates. */
function forceAtlas(count: number, edges: [number, number, number][], foreign: { node: number; dx: number; dy: number }[],
	start: (i: number) => [number, number], pinned: number): { x: Float64Array; y: Float64Array } {
	const x = new Float64Array(count), y = new Float64Array(count);
	const fx = new Float64Array(count), fy = new Float64Array(count);
	const previousX = new Float64Array(count), previousY = new Float64Array(count);
	const mass = new Float64Array(count).fill(1);
	for (const [a, b] of edges) { mass[a]++; mass[b]++; }
	for (let i = 0; i < count; i++) [x[i], y[i]] = start(i);
	let speed = 1;
	let efficiency = 1;
	let reach = 10;
	for (let iteration = 0; iteration < ITERATIONS; iteration++) {
		if (iteration % 25 === 0) {
			// Foreign targets sit just beyond the region's current edge, in the direction of that region.
			const radii = Array.from({ length: count }, (_, i) => Math.hypot(x[i], y[i])).sort((a, b) => a - b);
			reach = Math.max(1, radii[Math.floor(count * 0.9)] * 1.4);
		}
		previousX.set(fx); previousY.set(fy); fx.fill(0); fy.fill(0);
		for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
			const dx = x[a] - x[b], dy = y[a] - y[b];
			const force = mass[a] * mass[b] / (dx * dx + dy * dy + 0.01);
			fx[a] += dx * force; fy[a] += dy * force; fx[b] -= dx * force; fy[b] -= dy * force;
		}
		for (let i = 0; i < count; i++) {
			const distance = Math.hypot(x[i], y[i]);
			if (distance > 0) { const force = GRAVITY * mass[i] / distance; fx[i] -= x[i] * force; fy[i] -= y[i] * force; }
		}
		for (const [a, b, w] of edges) {
			const dx = x[a] - x[b], dy = y[a] - y[b];
			const distance = Math.hypot(dx, dy);
			if (!distance) continue;
			const force = -w * Math.log(1 + distance) / distance;
			fx[a] += dx * force; fy[a] += dy * force; fx[b] -= dx * force; fy[b] -= dy * force;
		}
		for (const pull of foreign) {
			const dx = x[pull.node] - pull.dx * reach, dy = y[pull.node] - pull.dy * reach;
			const distance = Math.hypot(dx, dy);
			if (!distance) continue;
			const force = -FOREIGN_PULL * Math.log(1 + distance) / distance;
			fx[pull.node] += dx * force; fy[pull.node] += dy * force;
		}
		let swinging = 0, traction = 0;
		for (let i = 0; i < count; i++) {
			swinging += mass[i] * Math.hypot(previousX[i] - fx[i], previousY[i] - fy[i]);
			traction += mass[i] * 0.5 * Math.hypot(previousX[i] + fx[i], previousY[i] + fy[i]);
		}
		const estimate = 0.05 * Math.sqrt(count);
		const tolerance = Math.max(Math.sqrt(estimate), Math.min(10, estimate * traction / (count * count)));
		if (swinging / traction > 2 && efficiency > 0.05) efficiency *= 0.5;
		const target = tolerance * efficiency * traction / swinging;
		if (swinging > tolerance * traction) { if (efficiency > 0.05) efficiency *= 0.7; } else if (speed < 1000) efficiency *= 1.3;
		speed += Math.min(target - speed, 0.5 * speed);
		for (let i = 0; i < count; i++) {
			if (i === pinned) { x[i] = 0; y[i] = 0; continue; }
			const swing = mass[i] * Math.hypot(previousX[i] - fx[i], previousY[i] - fy[i]);
			const force = Math.hypot(fx[i], fy[i]);
			const factor = Math.min(speed / (1 + Math.sqrt(speed * swing)), 5 / Math.max(force, 1e-9));
			x[i] += fx[i] * factor; y[i] += fy[i] * factor;
		}
	}
	return { x, y };
}

/** Push apart any pair closer than the minimum spacing. Hubs stay at their region centers. */
function separate(x: Float64Array, y: Float64Array, pinned: Set<number>): void {
	const count = x.length;
	for (let pass = 0; pass < 500; pass++) {
		const grid = new Map<string, number[]>();
		for (let i = 0; i < count; i++) {
			const key = `${Math.floor(x[i] / MIN_SEPARATION)},${Math.floor(y[i] / MIN_SEPARATION)}`;
			const cell = grid.get(key);
			if (cell) cell.push(i); else grid.set(key, [i]);
		}
		let violations = 0;
		for (let i = 0; i < count; i++) {
			const cx = Math.floor(x[i] / MIN_SEPARATION), cy = Math.floor(y[i] / MIN_SEPARATION);
			for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
				for (const j of grid.get(`${gx},${gy}`) ?? []) {
					if (j <= i) continue;
					const dx = x[j] - x[i], dy = y[j] - y[i];
					const distance = Math.hypot(dx, dy);
					if (distance >= MIN_SEPARATION + 0.5) continue;
					violations++;
					const ux = distance ? dx / distance : 1, uy = distance ? dy / distance : 0;
					const push = MIN_SEPARATION + 0.6 - distance;
					const share = pinned.has(i) ? 0 : pinned.has(j) ? 1 : 0.5;
					x[i] -= ux * push * share; y[i] -= uy * push * share;
					x[j] += ux * push * (1 - share); y[j] += uy * push * (1 - share);
				}
			}
		}
		if (!violations) return;
	}
	throw new Error('Atlas layout could not reach the minimum point separation.');
}

export function layoutAtlas(input: readonly AtlasArticle[]): { nodes: AtlasArticle[]; stats: LayoutStats } {
	const links = adjacency(input);
	const { regions, moved, rounds } = propagateRegions(input, links);
	const x = new Float64Array(input.length), y = new Float64Array(input.length);
	const pinned = new Set<number>();
	const communities: Record<string, number> = {};
	for (const region of REGIONS) {
		const members = input.map((_, i) => i).filter((i) => regions[i] === region.id);
		const local = new Map(members.map((global, i) => [global, i]));
		const internal: [number, number, number][] = [];
		const foreign: { node: number; dx: number; dy: number }[] = [];
		for (const global of members) for (const neighbor of links[global]) {
			const other = local.get(neighbor);
			if (other !== undefined) { if (local.get(global)! < other) internal.push([local.get(global)!, other, 1]); continue; }
			const target = REGIONS.find((item) => item.id === regions[neighbor])!;
			const distance = Math.hypot(target.x - region.x, target.y - region.y);
			foreign.push({ node: local.get(global)!, dx: (target.x - region.x) / distance, dy: (target.y - region.y) / distance });
		}
		const community = louvain(members.length, internal);
		communities[region.id] = new Set(community).size;
		const weighted = internal.map(([a, b]): [number, number, number] => [a, b, community[a] === community[b] ? COMMUNITY_PULL : BRIDGE_PULL]);
		const hub = members.findIndex((global) => input[global].hub);
		const layout = forceAtlas(members.length, weighted, foreign, (i) => {
			const hash = titleHash(input[members[i]].title);
			const angle = (hash % 6283) / 1000;
			const radius = 1 + ((hash >>> 12) % 1000) / 40;
			return [Math.cos(angle) * radius, Math.sin(angle) * radius];
		}, hub);
		const radii = members.map((_, i) => Math.hypot(layout.x[i], layout.y[i])).sort((a, b) => a - b);
		const radius = REGION_RADIUS * Math.sqrt(members.length / 290);
		const scale = radius / radii[Math.floor(members.length * 0.92)];
		const limit = radius * 1.15;
		members.forEach((global, i) => {
			let dx = layout.x[i] * scale, dy = layout.y[i] * scale;
			const distance = Math.hypot(dx, dy);
			if (distance > limit) {
				const pulled = Math.min(radius * 1.3, limit + (distance - limit) * 0.3) / distance;
				dx *= pulled; dy *= pulled;
			}
			x[global] = region.x + dx;
			y[global] = region.y + dy;
			if (input[global].hub) pinned.add(global);
		});
	}
	separate(x, y, pinned);
	const nodes = input.map((node, i) => ({ ...node, x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10, region: regions[i] }));
	let minSeparation = Infinity;
	for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
		minSeparation = Math.min(minSeparation, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y));
	}
	for (const node of nodes) {
		if (node.x < ATLAS_BOUNDS.minX || node.x > ATLAS_BOUNDS.maxX || node.y < ATLAS_BOUNDS.minY || node.y > ATLAS_BOUNDS.maxY) {
			throw new Error(`Atlas layout placed ${node.title} outside the map bounds.`);
		}
	}
	let intra = 0, total = 0;
	for (let i = 0; i < links.length; i++) for (const j of links[i]) if (i < j) { total++; if (regions[i] === regions[j]) intra++; }
	return { nodes, stats: { moved, rounds, intraRegionShare: Math.round(intra / total * 1000) / 1000, communities, minSeparation: Math.round(minSeparation * 10) / 10 } };
}

if (import.meta.main) {
	const output = resolve(dirname(fileURLToPath(import.meta.url)), '../static/graph/atlas.v1.json');
	const data = parseAtlas(JSON.parse(await readFile(output, 'utf8')));
	if (!data) throw new Error('The bundled atlas failed validation.');
	const started = performance.now();
	const { nodes, stats } = layoutAtlas(data.nodes);
	const snapshot = { ...data, nodes };
	if (!parseAtlas(snapshot)) throw new Error('The laid-out atlas failed validation.');
	const json = JSON.stringify(snapshot);
	await writeFile(`${output}.tmp`, json);
	await rename(`${output}.tmp`, output);
	console.log(JSON.stringify({ ...stats, seconds: Math.round((performance.now() - started) / 100) / 10, bytes: Buffer.byteLength(json),
		sha256: createHash('sha256').update(json).digest('hex'), regions: Object.fromEntries(REGIONS.map((region) =>
			[region.id, nodes.filter((node) => node.region === region.id).length])) }));
}
