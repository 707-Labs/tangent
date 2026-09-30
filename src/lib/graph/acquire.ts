import type { Article, Candidate } from '$lib/wikipedia/types';

/** One bounded acquisition per title. Failed/empty neighborhoods stay retryable. */
export class AcquisitionCache<T> {
	#values = new Map<string, T>();
	#pending = new Map<string, Promise<T>>();
	constructor(private readonly acquire: (title: string) => Promise<T>, private readonly capacity = 64) {}
	peek(title: string): T | undefined { return this.#values.get(title); }
	get(title: string): Promise<T> {
		if (this.#values.has(title)) return Promise.resolve(this.#values.get(title)!);
		const pending = this.#pending.get(title);
		if (pending) return pending;
		const request = Promise.resolve().then(() => this.acquire(title)).then((value) => {
			this.#values.set(title, value);
			while (this.#values.size > this.capacity) this.#values.delete(this.#values.keys().next().value!);
			return value;
		}).finally(() => this.#pending.delete(title));
		this.#pending.set(title, request);
		return request;
	}
}

export function graphAcquisitions() {
	const MAX_REQUESTS = 4;
	const controllers = new Set<AbortController>();
	const queue: { start: () => void; reject: (error: Error) => void }[] = [];
	let active = 0;
	let disposed = false;
	function drain(): void {
		// FIFO shares the budget between cards and neighborhoods; older foreground
		// work cannot be starved by rapid selections or speculative acquisitions.
		while (!disposed && active < MAX_REQUESTS && queue.length) queue.shift()!.start();
	}
	function request<T>(url: string): Promise<T> {
		if (disposed) return Promise.reject(new Error('Map closed.'));
		return new Promise<T>((resolve, reject) => {
			queue.push({ reject, start: () => {
				active++;
				const controller = new AbortController();
				controllers.add(controller);
				// The upstream timeout begins when a slot is granted, not in the queue.
				const timeout = setTimeout(() => controller.abort(), 18_000);
				void (async () => {
					try {
						const response = await fetch(url, { signal: controller.signal });
						if (!response.ok) throw new Error('Wikipedia is unavailable. Try again.');
						resolve(await response.json() as T);
					} catch (error) {
						reject(error);
					} finally {
						clearTimeout(timeout);
						controllers.delete(controller);
						active--;
						drain();
					}
				})();
			} });
			drain();
		});
	}
	return {
		links: new AcquisitionCache(async (title: string) => {
			const data = await request<{ candidates: Candidate[]; error?: string }>(`/api/links?from=${encodeURIComponent(title)}`);
			if (data.error || !data.candidates.length) throw new Error('No connections returned. Try again.');
			return data.candidates;
		}),
		cards: new AcquisitionCache(async (title: string) => {
			const data = await request<{ article: Article | null }>(`/api/card?title=${encodeURIComponent(title)}&image=summary`);
			if (!data.article) throw new Error('This article could not be opened.');
			return data.article;
		}),
		dispose: () => {
			disposed = true;
			for (const job of queue.splice(0)) job.reject(new Error('Map closed.'));
			for (const controller of controllers) controller.abort();
		}
	};
}
