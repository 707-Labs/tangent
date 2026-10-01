import type { Article, Thumbnail } from '$lib/wikipedia/types';

export interface SavedArticle {
	title: string;
	description: string | null;
	thumbnail: Thumbnail | null;
	savedAt: number;
}

export const SAVED_KEY = 'tangent:saved:v1';
export const SAVED_LIMIT = 200;

export function parseSaved(value: unknown): SavedArticle[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const items: SavedArticle[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Record<string, unknown>;
		if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300 || seen.has(item.title)) continue;
		if (typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt) || item.savedAt < 0) continue;
		seen.add(item.title);
		let thumbnail: Thumbnail | null = null;
		if (item.thumbnail && typeof item.thumbnail === 'object') {
			const image = item.thumbnail as Record<string, unknown>;
			if (typeof image.source === 'string' && /^https:\/\/upload\.wikimedia\.org\//.test(image.source) &&
				typeof image.width === 'number' && Number.isFinite(image.width) && image.width > 0 &&
				typeof image.height === 'number' && Number.isFinite(image.height) && image.height > 0) {
				thumbnail = { source: image.source, width: image.width, height: image.height };
			}
		}
		items.push({ title: item.title, description: typeof item.description === 'string' ? item.description.slice(0, 500) : null, thumbnail, savedAt: item.savedAt });
	}
	return items.sort((a, b) => b.savedAt - a.savedAt).slice(0, SAVED_LIMIT);
}

export function loadSaved(storage: Storage): SavedArticle[] {
	try { return parseSaved(JSON.parse(storage.getItem(SAVED_KEY) ?? '[]')); }
	catch { return []; }
}

export function saveArticles(items: SavedArticle[], storage: Storage): void {
	try { storage.setItem(SAVED_KEY, JSON.stringify(parseSaved(items))); }
	catch { /* Keep the in-memory list usable when storage is unavailable. */ }
}

export function savedEntry(article: Article, savedAt = Date.now()): SavedArticle {
	return { title: article.title, description: article.description, thumbnail: article.thumbnail, savedAt };
}
