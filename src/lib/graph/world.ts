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
	/** Static atlas articles survive the live-import eviction budget. */
	atlas?: boolean;
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
	const pinned = matching.find((node) => node.atlas && node.title === canonical.title);
	const first = pinned ?? matching[0];
	const merged: WorldNode = pinned ?? { ...first, ...canonical,
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
	// The atlas already has verified incident links. Live redirect requests must
	// never replace its graph, whether their links or summary arrive first.
	if (parent.atlas) return [...nodes];
	let next = [...nodes];
	const usable = candidates.filter((candidate) => !candidate.isDisambiguation && candidate.title !== title);
	for (const candidate of usable) next = importNode(next, candidate, parent);
	next = next.map((node) => node.title === title
		? { ...node, explored: true, neighbors: [...new Set(usable.map((candidate) => candidate.title))] }
		: node);
	// Keep memory bounded during long explorations, preserving landmarks and this neighborhood.
	const liveCount = next.filter((node) => !node.atlas).length;
	if (liveCount > 1200) {
		const protectedTitles = new Set([title, ...usable.map((candidate) => candidate.title)]);
		let remaining = liveCount - 1200;
		next = next.filter((node) => {
			if (remaining > 0 && !node.atlas && !node.hub && !protectedTitles.has(node.title)) { remaining--; return false; }
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
	const priority: ScreenNode[] = [];
	const cells = new Map<string, ScreenNode[]>();
	for (const node of nodes) {
		const point = project(node, camera);
		if (point.x < -70 || point.y < -70 || point.x > viewport.width + 70 || point.y > viewport.height + 70) continue;
		const item = { node, ...point };
		if (node.title === focus) priority.unshift(item);
		else if (node.hub) priority.push(item);
		else {
			const key = `${Math.floor(point.x / 90)},${Math.floor(point.y / 90)}`;
			const cell = cells.get(key) ?? [];
			if (cell.length < 4) cell.push(item);
			cells.set(key, cell);
		}
	}
	// Round-robin spatial cells gives every part of the viewport representation,
	// without sorting thousands of points every time the camera moves.
	for (let depth = 0; depth < 4 && priority.length < 250; depth++) {
		for (const cell of cells.values()) {
			if (cell[depth]) priority.push(cell[depth]);
			if (priority.length === 250) break;
		}
	}
	return priority.slice(0, 250);
}

/** Canvas points remain selectable even when their DOM label is culled. */
export function hitNode(nodes: readonly WorldNode[], camera: Camera, point: { x: number; y: number }, radius = 14): WorldNode | null {
	let closest: WorldNode | null = null;
	let distance = radius;
	for (const node of nodes) {
		const screen = project(node, camera);
		const candidate = Math.hypot(point.x - screen.x, point.y - screen.y);
		if (candidate < distance) { distance = candidate; closest = node; }
	}
	return closest;
}

export function atlasWorld(articles: readonly (SearchResult & { x: number; y: number; region: string; hub: boolean; neighbors: string[] })[], existing: readonly WorldNode[] = []): WorldNode[] {
	const titles = new Set(articles.map((article) => article.title));
	return [...articles.map((article) => ({ title: article.title, description: article.description, thumbnail: article.thumbnail,
		x: article.x, y: article.y, region: article.region, hub: article.hub, neighbors: article.neighbors, explored: true, atlas: true })),
		...existing.filter((node) => !titles.has(node.title))];
}

export function localSearch(nodes: readonly WorldNode[], query: string, aliases: ReadonlyMap<string, string>, limit = 8): SearchResult[] {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length < 2) return [];
	const alias = [...aliases].find(([title]) => title.toLocaleLowerCase() === needle)?.[1];
	const ranked = nodes.map((node) => {
		const title = node.title.toLocaleLowerCase();
		return { node, rank: title === needle || node.title === alias ? 0 : title.startsWith(needle) ? 1 : title.includes(needle) ? 2 : 3 };
	}).filter((item) => item.rank < 3).sort((a, b) => a.rank - b.rank || a.node.title.localeCompare(b.node.title));
	return ranked.slice(0, limit).map(({ node }) => node);
}

/** Label rectangles are in screen pixels, so zooming out never creates overlapping text. */
export interface LabelRect { x: number; y: number; width: number; height: number }
export function visibleLabels(nodes: readonly ScreenNode[], camera: Camera, focus: string | null, reserved: readonly LabelRect[] = []): Set<string> {
	const labels = new Set<string>();
	const boxes: LabelRect[] = [...reserved];
	const groups = new Map<string, ScreenNode[]>();
	const ordered = nodes.filter(({ node }) => node.title === focus || node.hub);
	for (const item of nodes) {
		if (item.node.title === focus || item.node.hub) continue;
		const group = groups.get(item.node.region) ?? [];
		group.push(item);
		groups.set(item.node.region, group);
	}
	for (let index = 0; index < nodes.length; index++) for (const group of groups.values()) if (group[index]) ordered.push(group[index]);
	for (const { node, x, y } of ordered) {
		if (camera.k < 0.11 && !node.hub && node.title !== focus) continue;
		const width = Math.min(170, node.title.length * 7 + 20);
		const box = { x: x - width / 2, y: y + 18, width, height: 20 };
		if (node.title !== focus && boxes.some((other) => box.y < other.y + other.height + 8 && box.y + box.height + 8 > other.y && box.x < other.x + other.width + 12 && box.x + box.width + 12 > other.x)) continue;
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
