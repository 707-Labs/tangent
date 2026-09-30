interface Visibility {
	inView: boolean;
	pageVisible: boolean;
	pending: boolean;
	interacted: boolean;
}

export interface DwellSignal {
	dwellMs: number;
	skipped: boolean;
}

/** One card's foreground reading time. Only scrolling away can signal rejection. */
export class DwellTracker {
	#startedAt: number | null = null;
	#totalMs = 0;
	#skipped = false;

	constructor(
		private readonly skipMinMs: number,
		private readonly skipThresholdMs: number
	) {}

	update(visibility: Visibility, now: number): DwellSignal {
		const active = visibility.inView && visibility.pageVisible && !visibility.pending;
		if (active) {
			this.#startedAt ??= now;
			return { dwellMs: 0, skipped: false };
		}

		const wasActive = this.#startedAt !== null;
		const dwellMs = this.finish(now);
		const skipped =
			wasActive &&
			!visibility.inView &&
			visibility.pageVisible &&
			!visibility.pending &&
			!visibility.interacted &&
			!this.#skipped &&
			this.#totalMs >= this.skipMinMs &&
			this.#totalMs < this.skipThresholdMs;
		if (skipped) this.#skipped = true;
		return { dwellMs, skipped };
	}

	/** Flush before hiding or removing a card, without treating it as a skip. */
	finish(now: number): number {
		if (this.#startedAt === null) return 0;
		const dwellMs = Math.max(0, now - this.#startedAt);
		this.#startedAt = null;
		this.#totalMs += dwellMs;
		return dwellMs;
	}
}
