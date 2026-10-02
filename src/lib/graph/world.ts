import type { Candidate, SearchResult } from '$lib/wikipedia/types';

export interface Region {
	id: string;
	label: string;
	x: number;
	y: number;
	titles: readonly string[];
}

/**
 * Real articles are the landmarks. Background stars never stand in for articles.
 * Centers sit at equal spacing on an ellipse; each region's hub is pinned at its center by
 * scripts/layout-atlas.ts, so moving a center means re-running that layout.
 */
export const REGIONS: readonly Region[] = [
	{ id: 'history', label: 'History', x: -1780, y: -1130, titles: ['History', 'Ancient Greece', 'Roman Empire', 'Silk Road', 'Industrial Revolution', 'Maya civilization'] },
	{ id: 'nature', label: 'Nature', x: 0, y: -1600, titles: ['Nature', 'Octopus', 'Coral reef', 'Fungi', 'Rainforest', 'Evolution'] },
	{ id: 'science', label: 'Science', x: 1780, y: -1130, titles: ['Science', 'Quantum mechanics', 'Astronomy', 'Periodic table', 'Black hole', 'DNA'] },
	{ id: 'arts', label: 'Arts', x: -2400, y: 450, titles: ['The arts', 'Music', 'Painting', 'Architecture', 'Film', 'Literature'] },
	{ id: 'people', label: 'People', x: -920, y: 1490, titles: ['Human', 'Ada Lovelace', 'Leonardo da Vinci', 'Marie Curie', 'Srinivasa Ramanujan', 'Wangari Maathai'] },
	{ id: 'places', label: 'Places', x: 920, y: 1490, titles: ['Geography', 'Earth', 'Iceland', 'Kyoto', 'Amazon River', 'Antarctica'] },
	{ id: 'technology', label: 'Technology', x: 2400, y: 450, titles: ['Technology', 'Computer', 'Internet', 'Spaceflight', 'Robotics', 'Printing press'] }
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

/** World extent of the atlas articles plus room for their names; tests keep the atlas inside it. */
export const MAP_EXTENT = { minX: -3000, maxX: 2900, minY: -2100, maxY: 1850 } as const;

/**
 * Top of the open map while nothing is selected: below the search panel on desktop, and on phones
 * below the search panel, browse button and orientation card stacked over the map (graph page CSS).
 */
export function mapTop(viewport: Viewport): number {
	return viewport.width > 760 ? 104 : 288;
}

/** Fits the whole map between the panels above it and the map controls below. */
export function overviewCamera(viewport: Viewport): Camera {
	const top = mapTop(viewport);
	const bottom = 72;
	const side = 24;
	const spanX = MAP_EXTENT.maxX - MAP_EXTENT.minX, spanY = MAP_EXTENT.maxY - MAP_EXTENT.minY;
	const k = Math.max(0.045, Math.min(0.28, (viewport.width - 2 * side) / spanX, (viewport.height - top - bottom) / spanY));
	return { x: viewport.width / 2 - (MAP_EXTENT.minX + spanX / 2) * k,
		y: top + (viewport.height - top - bottom) / 2 - (MAP_EXTENT.minY + spanY / 2) * k, k };
}
