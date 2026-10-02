import type { Article, Thumbnail } from '$lib/wikipedia/types';

export const ATLAS_BOUNDS = { minX: -3500, maxX: 3500, minY: -2600, maxY: 2600 } as const;
export const ATLAS_REGIONS = ['history', 'nature', 'science', 'arts', 'people', 'places', 'technology'] as const;

export interface AtlasArticle extends Article {
	x: number;
	y: number;
	region: string;
	hub: boolean;
	/** Real lead hyperlinks from this article to another included article. */
	outgoing: string[];
	/** Known incident hyperlinks, including incoming links for map navigation. */
	neighbors: string[];
}

export interface AtlasData {
	version: 1;
	generatedAt: string;
	language: 'en';
	aliases: Record<string, string>;
	nodes: AtlasArticle[];
}

export function compactAtlasIntro(extract: string): string {
	const text = extract.replace(/\s+/g, ' ').trim();
	if (text.length <= 900 && /[.!?]$/.test(text) && !/\.{3}$/.test(text)) return text;
	const prefix = text.slice(0, 900);
	const boundary = [...prefix.matchAll(/(?<!\.)[.!?](?!\.)(?=\s|$)/g)].at(-1)?.index;
	return boundary !== undefined && boundary >= 400 ? prefix.slice(0, boundary + 1) : `${prefix.trimEnd()}…`;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.length <= 10_000 && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 1000);
}
function httpUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 4096) return false;
	try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function wikiUrl(value: unknown, title: string): boolean {
	if (!httpUrl(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === 'en.wikipedia.org' &&
			!url.username && !url.password && !url.port && !url.search && !url.hash &&
			url.pathname.startsWith('/wiki/') &&
			decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ') === title.replaceAll('_', ' ');
	} catch { return false; }
}
function thumbnail(value: unknown): value is Thumbnail | null {
	return value === null || (record(value) && httpUrl(value.source) &&
		typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 &&
		typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0);
}
function article(value: unknown): value is AtlasArticle {
	return record(value) && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 1000 &&
		(value.description === null || (typeof value.description === 'string' && value.description.length <= 2000)) &&
		typeof value.extract === 'string' && value.extract.trim().length > 0 && value.extract.length <= 1800 &&
		thumbnail(value.thumbnail) && wikiUrl(value.wikiUrl, value.title) && value.lang === 'en' && strings(value.tokens) && value.tokens.length <= 256 &&
		typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= ATLAS_BOUNDS.minX && value.x <= ATLAS_BOUNDS.maxX &&
		typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= ATLAS_BOUNDS.minY && value.y <= ATLAS_BOUNDS.maxY &&
		typeof value.region === 'string' && ATLAS_REGIONS.some((region) => region === value.region) &&
		typeof value.hub === 'boolean' && strings(value.outgoing) && strings(value.neighbors);
}

/** Reject the whole snapshot if its graph or provenance is inconsistent. */
export function parseAtlas(value: unknown): AtlasData | null {
	if (!record(value) || value.version !== 1 || value.language !== 'en' ||
		typeof value.generatedAt !== 'string' || value.generatedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt)) ||
		!record(value.aliases) || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 10_000 ||
		!value.nodes.every(article)) return null;
	if (Object.keys(value.aliases).length > 20_000) return null;
	const nodes = value.nodes;
	const byTitle = new Map(nodes.map((node) => [node.title, node]));
	if (byTitle.size !== nodes.length) return null;
	if (nodes.reduce((sum, node) => sum + node.neighbors.length + node.outgoing.length, 0) > 1_000_000) return null;
	const outgoing = new Map(nodes.map((node) => [node.title, new Set(node.outgoing)]));
	for (const [alias, canonical] of Object.entries(value.aliases)) {
		if (!alias.trim() || alias.length > 1000 || typeof canonical !== 'string' || !byTitle.has(canonical) ||
			(byTitle.has(alias) && alias !== canonical)) return null;
	}
	for (const node of nodes) {
		if (new Set(node.neighbors).size !== node.neighbors.length || new Set(node.outgoing).size !== node.outgoing.length) return null;
		for (const target of [...node.neighbors, ...node.outgoing]) {
			if (target === node.title || !byTitle.has(target)) return null;
		}
		for (const target of node.outgoing) if (!node.neighbors.includes(target)) return null;
		for (const target of node.neighbors) {
			if (!outgoing.get(node.title)!.has(target) && !outgoing.get(target)!.has(node.title)) return null;
		}
	}
	// Alias lookup is safe even for names like "__proto__" or "constructor".
	const aliases = Object.assign(Object.create(null), value.aliases) as Record<string, string>;
	return { version: 1, generatedAt: value.generatedAt, language: 'en',
		aliases, nodes };
}
