/**
 * Tiny in-memory TTL cache. Wikipedia content barely changes, so we cache hard.
 *
 * This lives per server instance (one isolate on Cloudflare Workers), which is
 * plenty for Phase 1 — repeated views of the same rabbit-hole node hit the cache.
 * A later pass can swap this for the Workers Cache API without touching callers.
 */

interface Entry<T> {
	value: T;
	expires: number;
}

export interface Cache {
	/** Memoize completed results and share concurrent misses in this isolate. */
	cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
	/** Drop a single entry — e.g. so a transient empty result isn't memoized for its full TTL. */
	cacheDelete(key: string): void;
}

/**
 * A separate store with its own entry cap, for callers whose entries must not evict
 * (or be evicted by) the shared pool of Wikipedia responses.
 */
export function createCache(maxEntries: number): Cache {
	const store = new Map<string, Entry<unknown>>();
	const inflight = new Map<string, Promise<unknown>>();

	async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
		const now = Date.now();
		const hit = store.get(key) as Entry<T> | undefined;
		if (hit && hit.expires > now) return hit.value;

		const active = inflight.get(key) as Promise<T> | undefined;
		if (active) return active;

		const pending = Promise.resolve().then(fn).then((value) => {
			// An invalidation during the fetch must not resurrect an obsolete value.
			if (inflight.get(key) !== pending) return value;
			store.set(key, { value, expires: Date.now() + ttlMs });

			// Crude bound: when we blow the cap, drop the oldest-inserted entries.
			if (store.size > maxEntries) {
				const overflow = store.size - maxEntries;
				let i = 0;
				for (const k of store.keys()) {
					if (i++ >= overflow) break;
					store.delete(k);
				}
			}

			return value;
		}).finally(() => {
			if (inflight.get(key) === pending) inflight.delete(key);
		});
		inflight.set(key, pending);
		return pending;
	}

	function cacheDelete(key: string): void {
		store.delete(key);
		inflight.delete(key);
	}

	return { cached, cacheDelete };
}

const shared = createCache(2000);

/** Memoize completed results and share concurrent misses in this isolate. */
export const cached: Cache['cached'] = shared.cached;

/** Drop a single entry — e.g. so a transient empty result isn't memoized for its full TTL. */
export const cacheDelete: Cache['cacheDelete'] = shared.cacheDelete;

export const TTL = {
	/** Article summaries / links — stable, cache for a day. */
	long: 24 * 60 * 60 * 1000,
	/** Search results — shorter so typeahead stays fresh-ish. */
	short: 10 * 60 * 1000
} as const;
