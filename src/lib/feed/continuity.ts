import type { TrailNode } from './types';

export interface TangentLocation { reader: string | null; card: string | null; scrollY: number; offset?: number }
declare global { namespace App { interface PageState { tangent?: TangentLocation; mapVisit?: import('$lib/graph/discovery').MapVisit & { reader?: string | null } } } }
const KEY = 'tangent-recent-v1';
export interface RecentTangent { seedTitle: string; trail: TrailNode[]; updated: number }
const relations = new Set(['seed', 'link', 'related', 'surprise', 'dive']);
export function validTrail(value: unknown): TrailNode[] | null {
	if (!Array.isArray(value) || value.length > 300) return null;
	if (!value.every((node) => node && typeof node.id === 'string' && node.id.length <= 200 &&
		typeof node.title === 'string' && node.title.length > 0 && node.title.length <= 500 &&
		typeof node.fromTitle === 'string' && node.fromTitle.length <= 500 && relations.has(node.relation) &&
		typeof node.isDetour === 'boolean' && typeof node.seen === 'boolean')) return null;
	return value as TrailNode[];
}
export function loadRecent(storage?: Storage): RecentTangent[] {
	try {
		const value: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '[]');
		if (!Array.isArray(value)) return [];
		return value.slice(0, 6).filter((item): item is RecentTangent => item &&
			typeof item.seedTitle === 'string' && item.seedTitle.length > 0 && item.seedTitle.length <= 500 &&
			typeof item.updated === 'number' && Number.isFinite(item.updated) && validTrail(item.trail) !== null);
	} catch { return []; }
}
/** Restore an archived chain only for explicit Resume or a matching history waypoint. */
export function recentForLocation(recent: RecentTangent[], seed: string | null, card: string | null, explicitResume: boolean): RecentTangent | null {
	if (!seed || (!explicitResume && !card)) return null;
	return recent.find((item) => item.seedTitle === seed &&
		(explicitResume || item.trail.some((node) => node.id === card))) ?? null;
}

export function rememberTangent(seedTitle: string, trail: TrailNode[], storage?: Storage): void {
	if (!seedTitle || !trail.length) return;
	try { const target = storage ?? localStorage; target.setItem(KEY, JSON.stringify([{ seedTitle, trail: trail.slice(-200), updated: Date.now() },
		...loadRecent(target).filter((item) => item.seedTitle !== seedTitle)].slice(0, 6))); } catch { /* Best effort. */ }
}
/** Only accept bounded, serializable location snapshots from browser history. */
export function validateLocation(value: unknown): TangentLocation | null {
	if (!value || typeof value !== 'object') return null;
	const location = value as Record<string, unknown>;
	const title = (entry: unknown, limit: number) => entry === null ||
		(typeof entry === 'string' && entry.length > 0 && entry.length <= limit);
	if (!title(location.reader, 500) || !title(location.card, 200) ||
		typeof location.scrollY !== 'number' || !Number.isFinite(location.scrollY) ||
		location.scrollY < 0 || location.scrollY > 100_000_000 ||
		(location.offset !== undefined && (typeof location.offset !== 'number' ||
			!Number.isFinite(location.offset) || Math.abs(location.offset) > 100_000_000))) return null;
	return { reader: location.reader as string | null, card: location.card as string | null,
		scrollY: location.scrollY, ...(location.offset === undefined ? {} : { offset: location.offset as number }) };
}

export function locationFromUrl(url: URL): TangentLocation {
	const title = url.searchParams.get('reader');
	const card = url.searchParams.get('card');
	return { reader: title && title.length <= 500 ? title : null, card: card && card.length <= 200 ? card : null, scrollY: 0 };
}
export function locationUrl(url: URL, state: TangentLocation): URL {
	const next = new URL(url);
	for (const key of ['reader', 'card'] as const) {
		if (state[key]) next.searchParams.set(key, state[key]); else next.searchParams.delete(key);
	}
	return next;
}
