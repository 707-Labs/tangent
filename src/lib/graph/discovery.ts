import { titleHash, type WorldNode, type Camera } from './world';

/** Editorial signposts, anchored to articles rather than synthetic graph nodes. */
export const NEIGHBORHOODS = [
	{ region: 'history', label: 'Ancient worlds', anchor: 'Ancient Greece' },
	{ region: 'history', label: 'Trade & travel', anchor: 'Silk Road' },
	{ region: 'history', label: 'Industry & change', anchor: 'Industrial Revolution' },
	{ region: 'nature', label: 'Life & evolution', anchor: 'Evolution' },
	{ region: 'nature', label: 'Ocean life', anchor: 'Coral reef' },
	{ region: 'nature', label: 'Fungi', anchor: 'Fungus' },
	{ region: 'science', label: 'Astronomy', anchor: 'Astronomy' },
	{ region: 'science', label: 'Quantum world', anchor: 'Quantum mechanics' },
	{ region: 'science', label: 'Inside DNA', anchor: 'DNA' },
	{ region: 'arts', label: 'Music', anchor: 'Music' },
	{ region: 'arts', label: 'Built worlds', anchor: 'Architecture' },
	{ region: 'arts', label: 'Cinema', anchor: 'Film' },
	{ region: 'people', label: 'Early computing', anchor: 'Ada Lovelace' },
	{ region: 'people', label: 'Scientific lives', anchor: 'Marie Curie' },
	{ region: 'people', label: 'Art & invention', anchor: 'Leonardo da Vinci' },
	{ region: 'places', label: 'Our planet', anchor: 'Earth' },
	{ region: 'places', label: 'Polar worlds', anchor: 'Antarctica' },
	{ region: 'places', label: 'Cities', anchor: 'Kyoto' },
	{ region: 'technology', label: 'Computing', anchor: 'Computer' },
	{ region: 'technology', label: 'Connected world', anchor: 'Internet' },
	{ region: 'technology', label: 'Printed ideas', anchor: 'Printing press' }
] as const;
export type Neighborhood = typeof NEIGHBORHOODS[number];

/** Curated sequences are reading suggestions, not claims of direct hyperlinks. */
export const DISCOVERY_ROUTES = [
	{ id: 'ideas', label: 'How ideas travel', stops: ['Silk Road', 'Printing press', 'Internet'] },
	{ id: 'cosmos', label: 'Beyond Earth', stops: ['Earth', 'Astronomy', 'Exoplanet', 'Black hole', 'Spaceflight'] },
	{ id: 'invention', label: 'Art meets invention', stops: ['Leonardo da Vinci', 'Architecture', 'Ada Lovelace', 'Computer'] }
] as const;

export function neighborhoodsIn(nodes: ReadonlyMap<string, WorldNode>, region?: string) {
	return NEIGHBORHOODS.filter((item) => (!region || item.region === region) && nodes.get(item.anchor)?.atlas);
}

/** Prefer concrete destinations, varied regions, and unread topics. Only ranks known links. */
export function rankConnections(nodes: readonly WorldNode[], visited: readonly string[]): WorldNode[] {
	const seen = new Set(visited);
	const broad = /(?:^Continent$|^Sub-?region|^Region$|^Countries |^Branch of |^Field of |^Study of |^Scientific (?:field|study)|^Scientist in |^Systematic endeavour|^Observable event|^Everything in space)/i;
	const foundations = new Set(['Science', 'Nature', 'Human', 'History', 'Geography', 'Technology', 'The arts', 'Mathematics', 'Physics', 'Chemistry', 'Cosmology', 'Natural science', 'Astronomical object', 'Phenomenon', 'Universe', 'Cosmos']);
	const score = (node: WorldNode) => (seen.has(node.title) ? -8 : 0) + (node.thumbnail ? 3 : 0) +
		(node.description ? 2 : 0) + (/\b(?:empire|civilization|invention|instrument|animal|plant|material|sea|river|city|orbit|liquid|life|ancient)\b/i.test(node.description ?? '') ? 2 : 0) -
		(broad.test(node.description ?? '') || foundations.has(node.title) ? 8 : 0) - (node.hub ? 4 : 0) -
		(/^(?:\d|List of |Outline of |History of |Geography of )/.test(node.title) ? 5 : 0);
	const sorted = [...nodes].sort((a, b) => score(b) - score(a) || titleHash(a.title) - titleHash(b.title));
	const chosen: WorldNode[] = [];
	const regions = new Set<string>();
	for (const node of sorted) if (!regions.has(node.region) && chosen.length < 3 && score(node) >= score(sorted[0]) - 3) {
		chosen.push(node); regions.add(node.region);
	}
	return [...chosen, ...sorted.filter((node) => !chosen.includes(node))];
}

export interface MapVisit { selected: string | null; trail: string[]; camera: Camera; region: string | null; neighborhood: string | null }
export function parseMapVisit(value: unknown): MapVisit | null {
	if (!value || typeof value !== 'object') return null;
	const item = value as Partial<MapVisit>;
	if (!(item.selected === null || typeof item.selected === 'string' && item.selected.length <= 1000) ||
		!Array.isArray(item.trail) || item.trail.length > 12 || !item.trail.every((title) => typeof title === 'string' && title.length <= 1000) ||
		!item.camera || ![item.camera.x, item.camera.y, item.camera.k].every(Number.isFinite) ||
		Math.abs(item.camera.x) > 100_000 || Math.abs(item.camera.y) > 100_000 || item.camera.k < .045 || item.camera.k > 2.3 ||
		!(item.region === null || NEIGHBORHOODS.some((n) => n.region === item.region)) ||
		!(item.neighborhood === null || NEIGHBORHOODS.some((n) => n.anchor === item.neighborhood))) return null;
	return item as MapVisit;
}
