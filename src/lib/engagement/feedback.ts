export function disinterest(weights: Record<string, number>, tokens: Iterable<string>, amount: number, cap: number): { weights: Record<string, number>; delta: Record<string, number> } {
	const next = { ...weights };
	const delta: Record<string, number> = {};
	for (const token of new Set(tokens)) {
		const before = next[token] ?? 0;
		next[token] = Math.min(cap, before + amount);
		delta[token] = Math.max(0, next[token] - before);
	}
	return { weights: next, delta };
}

/** Undo just this action, retaining unrelated feedback received in the meantime. */
export function undoDisinterest(weights: Record<string, number>, delta: Record<string, number>): Record<string, number> {
	const next = { ...weights };
	for (const [token, amount] of Object.entries(delta)) {
		const value = Math.max(0, (next[token] ?? 0) - amount);
		if (value > 0) next[token] = value;
		else delete next[token];
	}
	return next;
}
