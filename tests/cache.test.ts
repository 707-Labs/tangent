import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, cacheDelete } from '../src/lib/server/cache';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

describe('server cache', () => {
	afterEach(() => vi.useRealTimers());

	it('shares one acquisition across eight simultaneous cold misses', async () => {
		const request = deferred<string>();
		const acquire = vi.fn(() => request.promise);
		const readers = Array.from({ length: 8 }, () => cached('concurrent', 1000, acquire));
		await Promise.resolve();
		expect(acquire).toHaveBeenCalledTimes(1);
		request.resolve('article');
		expect(await Promise.all(readers)).toEqual(Array(8).fill('article'));
		expect(await cached('concurrent', 1000, acquire)).toBe('article');
		expect(acquire).toHaveBeenCalledTimes(1);
	});

	it('starts TTL at completion so slow acquisitions get the full cache lifetime', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const request = deferred<string>();
		const value = cached('slow', 1000, () => request.promise);
		await Promise.resolve();
		vi.setSystemTime(5000);
		request.resolve('complete');
		await value;
		const acquire = vi.fn().mockResolvedValue('fresh');
		vi.setSystemTime(5999);
		expect(await cached('slow', 1000, acquire)).toBe('complete');
		vi.setSystemTime(6000);
		expect(await cached('slow', 1000, acquire)).toBe('fresh');
		expect(acquire).toHaveBeenCalledTimes(1);
	});

	it('allows retry after a shared upstream failure', async () => {
		const request = deferred<string>();
		const first = cached('retry', 1000, () => request.promise);
		const second = cached('retry', 1000, () => Promise.resolve('unexpected'));
		const failures = Promise.allSettled([first, second]);
		request.reject(new Error('upstream unavailable'));
		expect((await failures).map((r) => r.status)).toEqual(['rejected', 'rejected']);
		expect(await cached('retry', 1000, () => Promise.resolve('recovered'))).toBe('recovered');
	});

	it('does not let an invalidated acquisition overwrite a newer value', async () => {
		const old = deferred<string>();
		const first = cached('invalidate', 1000, () => old.promise);
		await Promise.resolve();
		cacheDelete('invalidate');
		expect(await cached('invalidate', 1000, () => Promise.resolve('new'))).toBe('new');
		old.resolve('old');
		expect(await first).toBe('old');
		expect(await cached('invalidate', 1000, () => Promise.resolve('unexpected'))).toBe('new');
	});
});
