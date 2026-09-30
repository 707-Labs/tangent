import type { Candidate, SearchResult } from '$lib/wikipedia/types';

export interface Region {
	id: string;
	label: string;
	x: number;
	y: number;
	titles: readonly string[];
}

/** Real articles are the landmarks. Background stars never stand in for articles. */
export const REGIONS: readonly Region[] = [
	{ id: 'history', label: 'History', x: -2100, y: -1250, titles: ['History', 'Ancient Greece', 'Roman Empire', 'Silk Road', 'Industrial Revolution', 'Maya civilization'] },
	{ id: 'nature', label: 'Nature', x: 0, y: -1850, titles: ['Nature', 'Octopus', 'Coral reef', 'Fungi', 'Rainforest', 'Evolution'] },
	{ id: 'science', label: 'Science', x: 2100, y: -1250, titles: ['Science', 'Quantum mechanics', 'Astronomy', 'Periodic table', 'Black hole', 'DNA'] },
	{ id: 'arts', label: 'Arts', x: -2450, y: 1050, titles: ['The arts', 'Music', 'Painting', 'Architecture', 'Film', 'Literature'] },
	{ id: 'people', label: 'People', x: -700, y: 1550, titles: ['Human', 'Ada Lovelace', 'Leonardo da Vinci', 'Marie Curie', 'Srinivasa Ramanujan', 'Wangari Maathai'] },
	{ id: 'places', label: 'Places', x: 1100, y: 1550, titles: ['Geography', 'Earth', 'Iceland', 'Kyoto', 'Amazon River', 'Antarctica'] },
	{ id: 'technology', label: 'Technology', x: 2650, y: 750, titles: ['Technology', 'Computer', 'Internet', 'Spaceflight', 'Robotics', 'Printing press'] }
];

export interface WorldNode extends SearchResult {
	x: number;
	y: number;
	region: string;
	hub: boolean;
	neighbors: string[];
	explored: boolean;
}

export interface Camera { x: number; y: number; k: number }
export interface Viewport { width: number; height: number }
export interface ScreenNode { node: WorldNode; x: number; y: number }

export function titleHash(title: string): number {
	let hash = 2166136261;
	for (const character of title) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	return hash >>> 0;
}

export function initialWorld(): WorldNode[] {
	return REGIONS.flatMap((region) => region.titles.map((title, index) => {
		const angle = index * 2.399963;
		const radius = index === 0 ? 0 : 280 + index * 64;
		return { title, description: null, thumbnail: null, x: region.x + Math.cos(angle) * radius,
			y: region.y + Math.sin(angle) * radius, region: region.id, hub: index === 0,
			neighbors: [], explored: false };
	}));
}

/** First placement wins: revisiting or encountering a shared article never moves it. */
export function importNode(nodes: readonly WorldNode[], info: SearchResult, parent?: WorldNode): WorldNode[] {
	const existing = nodes.find((node) => node.title === info.title);
	if (existing) return nodes.map((node) => node.title === info.title
		? { ...node, description: info.description ?? node.description, thumbnail: info.thumbnail ?? node.thumbnail }
		: node);
	const hash = titleHash(info.title);
	const region = REGIONS[hash % REGIONS.length];
	const center = parent ?? region;
	let angle = (hash % 6283) / 1000;
	let radius = parent ? 280 : 450 + (hash % 400);
	let x = center.x + Math.cos(angle) * radius;
	let y = center.y + Math.sin(angle) * radius;
	for (let attempt = 0; attempt < 80 && nodes.some((node) => Math.hypot(node.x - x, node.y - y) < 85); attempt++) {
		angle += 2.399963;
		radius += 22;
		x = center.x + Math.cos(angle) * radius;
		y = center.y + Math.sin(angle) * radius;
	}
	return [...nodes, { ...info, x, y, region: parent?.region ?? region.id, hub: false, neighbors: [], explored: false }];
}

/** Redirects identify one real article. Keep whichever placement was encountered first. */
export function canonicalizeNode(nodes: readonly WorldNode[], requested: string, canonical: SearchResult): WorldNode[] {
	if (requested === canonical.title) return importNode(nodes, canonical);
	const matching = nodes.filter((node) => node.title === requested || node.title === canonical.title);
	if (!matching.length) return importNode(nodes, canonical);
	const first = matching[0];
	const merged: WorldNode = { ...first, ...canonical,
		description: canonical.description ?? matching.find((node) => node.description)?.description ?? null,
		thumbnail: canonical.thumbnail ?? matching.find((node) => node.thumbnail)?.thumbnail ?? null,
		hub: matching.some((node) => node.hub), explored: matching.some((node) => node.explored),
		neighbors: matching.flatMap((node) => node.neighbors) };
	return nodes.filter((node) => !matching.includes(node) || node === first).map((node) => {
		const value = node === first ? merged : node;
		return { ...value, neighbors: [...new Set(value.neighbors.map((title) => title === requested ? canonical.title : title))]
			.filter((title) => title !== value.title) };
	});
}

/** Visits are ordered events; removing earlier occurrences would invent unvisited edges. */
export function appendVisit(trail: readonly string[], title: string): string[] {
	return (trail.at(-1) === title ? [...trail] : [...trail, title]).slice(-12);
}

export function addNeighborhood(nodes: readonly WorldNode[], title: string, candidates: readonly Candidate[]): WorldNode[] {
	const parent = nodes.find((node) => node.title === title);
	if (!parent) return [...nodes];
	let next = [...nodes];
	const usable = candidates.filter((candidate) => !candidate.isDisambiguation && candidate.title !== title);
	for (const candidate of usable) next = importNode(next, candidate, parent);
	next = next.map((node) => node.title === title
		? { ...node, explored: true, neighbors: [...new Set(usable.map((candidate) => candidate.title))] }
		: node);
	// Keep memory bounded during long explorations, preserving landmarks and this neighborhood.
	if (next.length > 1200) {
		const protectedTitles = new Set([title, ...usable.map((candidate) => candidate.title)]);
		let remaining = next.length - 1200;
		next = next.filter((node) => {
			if (remaining > 0 && !node.hub && !protectedTitles.has(node.title)) { remaining--; return false; }
			return true;
		});
	}
	return next;
}

export function project(node: Pick<WorldNode, 'x' | 'y'>, camera: Camera): { x: number; y: number } {
	return { x: node.x * camera.k + camera.x, y: node.y * camera.k + camera.y };
}

export function centeredCamera(node: Pick<WorldNode, 'x' | 'y'>, viewport: Viewport, k: number): Camera {
	return { x: viewport.width * (viewport.width > 760 ? 0.4 : 0.5) - node.x * k,
		y: viewport.height * (viewport.width > 760 ? 0.5 : 0.38) - node.y * k, k };
}

/** Keep the world point under the pointer fixed, including when zoom hits its limits. */
export function zoomCamera(camera: Camera, factor: number, pointer: { x: number; y: number }): Camera {
	const k = Math.max(0.045, Math.min(2.3, camera.k * factor));
	return { x: pointer.x - (pointer.x - camera.x) * k / camera.k,
		y: pointer.y - (pointer.y - camera.y) * k / camera.k, k };
}

export function visibleNodes(nodes: readonly WorldNode[], camera: Camera, viewport: Viewport, focus: string | null): ScreenNode[] {
	return nodes.map((node) => ({ node, ...project(node, camera) }))
		.filter(({ x, y }) => x > -70 && y > -70 && x < viewport.width + 70 && y < viewport.height + 70)
		.sort((a, b) => Number(b.node.title === focus) - Number(a.node.title === focus)
			|| Number(b.node.hub) - Number(a.node.hub)
			|| Math.hypot(a.x - viewport.width / 2, a.y - viewport.height / 2) - Math.hypot(b.x - viewport.width / 2, b.y - viewport.height / 2))
		.slice(0, 250);
}

/** Label rectangles are in screen pixels, so zooming out never creates overlapping text. */
export function visibleLabels(nodes: readonly ScreenNode[], camera: Camera, focus: string | null): Set<string> {
	const labels = new Set<string>();
	const boxes: { x: number; y: number; width: number }[] = [];
	for (const { node, x, y } of nodes) {
		if (camera.k < 0.24 && !node.hub && node.title !== focus) continue;
		const width = Math.min(170, node.title.length * 7 + 20);
		const box = { x: x - width / 2, y: y + 18, width };
		if (node.title !== focus && boxes.some((other) => Math.abs(other.y - box.y) < 28 && box.x < other.x + other.width + 12 && box.x + box.width + 12 > other.x)) continue;
		labels.add(node.title);
		boxes.push(box);
		if (labels.size >= 36) break;
	}
	return labels;
}

export function overviewCamera(viewport: Viewport): Camera {
	const k = Math.max(0.045, Math.min(0.28, (viewport.width - 80) / 6500, (viewport.height - 100) / 4600));
	return { x: viewport.width / 2, y: viewport.height / 2, k };
}
