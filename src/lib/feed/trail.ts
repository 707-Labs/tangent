import { validTrail, rememberTangent } from './continuity';
import { FEED } from './config';
import type { TrailNode } from './types';

interface StoredTrail {
	seedTitle: string;
	trail: TrailNode[];
}

/**
 * Persist the trail to sessionStorage.
 * Trails die when the tab closes, preventing stale resurrection days later.
 * Capped at FEED.trailCap nodes (oldest dropped first).
 *
 * Accepts an injectable Storage so tests can pass a mock without touching the real
 * sessionStorage. Callers that omit storage must guard with `if (!browser)` before
 * calling, since `sessionStorage` is undefined in SSR/Node.
 */
export function saveTrail(
	seedTitle: string,
	nodes: TrailNode[],
	storage?: Storage
): void {
	const capped = nodes.length > FEED.trailCap ? nodes.slice(-FEED.trailCap) : nodes;
	try {
		const payload: StoredTrail = { seedTitle, trail: capped };
		(storage ?? sessionStorage).setItem(FEED.trailStorageKey, JSON.stringify(payload));
	} catch {
		// Storage full or unavailable — trail is best-effort.
	}
	rememberTangent(seedTitle, capped);
}

/**
 * Load the stored trail. Returns null when absent or corrupted.
 *
 * Callers must guard with `if (!browser)` before calling in SSR contexts.
 */
export function loadTrail(storage?: Storage): StoredTrail | null {
	try {
		const raw = (storage ?? sessionStorage).getItem(FEED.trailStorageKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredTrail>;
		const trail = validTrail(parsed.trail);
		if (typeof parsed.seedTitle !== 'string' || !parsed.seedTitle || parsed.seedTitle.length > 500 || !trail) return null;
		return { seedTitle: parsed.seedTitle, trail };
	} catch {
		return null;
	}
}

/**
 * Remove the stored trail from sessionStorage.
 *
 * Callers must guard with `if (!browser)` before calling in SSR contexts.
 */
export function clearTrail(storage?: Storage): void {
	try {
		(storage ?? sessionStorage).removeItem(FEED.trailStorageKey);
	} catch {
		// Ignore.
	}
}

/**
 * The chain tip: the last non-detour node. Surprise cards are detours so the feed
 * self-heals — the next build fetches links from the pre-surprise tip, not the dud.
 * Returns null when the trail is empty or all nodes are detours.
 */
export function chainTip(nodes: TrailNode[]): TrailNode | null {
	for (let i = nodes.length - 1; i >= 0; i--) {
		if (!nodes[i].isDetour) return nodes[i];
	}
	return null;
}
