/**
 * Political-topic flags from Workers AI (Clef), one batched call per candidate pool.
 *
 * The feed dampens politics and the WWII / authoritarian cluster (see `$lib/feed/politics`).
 * The stem regex there misses hubs whose title, description and categories dodge every
 * stem ("Belovezha Accords", "Council of People's Commissars"). This asks the model one
 * yes/no question per candidate in a single call and writes the answer to
 * `candidate.political`; `isPoliticalCandidate` counts a candidate as political when
 * that flag is true OR the regex matches (see there for why the model never clears a
 * regex match).
 *
 * Eval, 2026-11-13: 440 candidates from 11 feed-sim hops, hand-labelled by Claude (387
 * unambiguous). Regex: precision 0.785, recall 0.779. clef-flash with this prompt at
 * p >= 0.5: precision 0.983, recall 0.943, 0 decision flips over 3 runs, ai.run p50
 * 306 ms / p95 398 ms (n=33, measured from a Mac through `wrangler dev`). About 6,400
 * input tokens per 50-candidate hop, so about $0.00024 per hop.
 *
 * Every failure (no binding, timeout, error, malformed answer) returns the pool
 * unchanged, which is exactly the old regex behavior. The precision figure above is the
 * model alone; under the either-or rule the regex's false positives still apply.
 */
import type { Candidate } from '../../src/lib/wikipedia/types.ts';
import { cached, TTL } from '../../src/lib/server/cache.ts';
import { recordEvent } from '../../src/lib/server/metrics.ts';

/**
 * The slice of the Workers AI binding this module uses. Kept structural (not the
 * generated `Ai` type) because the generated model list does not name Clef, and so
 * tests can pass a stub.
 */
export interface AiRunner {
	run(model: string, input: unknown): Promise<unknown>;
}

export const POLITICS_MODEL = '@cf/cloudflare/clef-flash';
/** Bump when the prompt or threshold changes, so cached flags from the old prompt expire. */
export const POLITICS_PROMPT_VERSION = 'v1';
/** Workers AI allows 1 to 64 questions per call. Pools above this are split into parallel calls. */
const MAX_QUESTIONS = 64;
const THRESHOLD = 0.5;
/** Live hops measured p95 398 ms; past this the feed uses the regex rather than wait. */
export const POLITICS_TIMEOUT_MS = 800;
const MAX_CATEGORIES = 8;

const RULE =
	'mainly about politics or government (elections, parties, legislatures, government bodies, ' +
	'politicians and heads of state as political figures, political ideologies, diplomacy and treaties), ' +
	'or about the Nazi / fascist / Soviet / totalitarian-regime cluster (dictators, the Holocaust, ' +
	'genocides, the world wars as a whole)';

function line(c: Candidate, i: number): string {
	const cats = (c.categories ?? [])
		.slice(0, MAX_CATEGORIES)
		.map((x) => x.replace(/^Category:/, ''))
		.join('; ');
	return `c${i}: ${c.title} — ${c.description ?? '(no description)'} | categories: ${cats}`;
}

/** The Clef request for one chunk of at most {@link MAX_QUESTIONS} candidates. */
export function politicsRequest(chunk: Candidate[]) {
	const state =
		`Rule: an article is POLITICAL if it is ${RULE}. Individual battles, military officers, ` +
		`places, countries, languages, and science are not political.\nCandidate articles:\n` +
		chunk.map(line).join('\n');
	const questions: Record<string, { type: 'noul'; instructions: string }> = {};
	chunk.forEach((c, i) => {
		questions[`c${i}`] = { type: 'noul', instructions: `Is c${i} ("${c.title}") POLITICAL under the rule?` };
	});
	return { model: 'clef-flash', state, questions };
}

type Answers = Record<string, { noul?: unknown } | undefined>;

async function classifyChunk(ai: AiRunner, chunk: Candidate[]): Promise<boolean[]> {
	const out = (await ai.run(POLITICS_MODEL, politicsRequest(chunk))) as { answers?: Answers } | null;
	return chunk.map((_, i) => {
		const p = out?.answers?.[`c${i}`]?.noul;
		if (typeof p !== 'number' || Number.isNaN(p)) throw new Error(`missing answer c${i}`);
		return p >= THRESHOLD;
	});
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('politics model timeout')), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Flags for every title in the pool, keyed by title, or null when the model is
 * unavailable. Rejects never escape: null means "use the regex".
 */
export async function classifyPolitics(
	ai: AiRunner | undefined,
	candidates: Candidate[],
	timeoutMs: number = POLITICS_TIMEOUT_MS
): Promise<Map<string, boolean> | null> {
	if (!ai || candidates.length === 0) return null;
	const chunks: Candidate[][] = [];
	for (let i = 0; i < candidates.length; i += MAX_QUESTIONS) {
		chunks.push(candidates.slice(i, i + MAX_QUESTIONS));
	}
	try {
		const results = await withTimeout(
			Promise.all(chunks.map((chunk) => classifyChunk(ai, chunk))),
			timeoutMs
		);
		const flags = new Map<string, boolean>();
		chunks.forEach((chunk, ci) => chunk.forEach((c, i) => flags.set(c.title, results[ci][i])));
		return flags;
	} catch {
		return null;
	}
}

/** Copy of the pool with `political` set from the flags; untouched titles keep the regex fallback. */
export function applyPoliticsFlags(
	candidates: Candidate[],
	flags: ReadonlyMap<string, boolean> | null
): Candidate[] {
	if (!flags) return candidates;
	return candidates.map((c) => (flags.has(c.title) ? { ...c, political: flags.get(c.title) } : c));
}

/**
 * The pool with model flags applied, memoized per pool key (one model call per hop per
 * isolate per day). A failed call is not memoized, so the next request retries; until
 * then the pool goes out unflagged and the feed uses the regex.
 */
export async function withPoliticsFlags(
	poolKey: string,
	candidates: Candidate[],
	platform: App.Platform | undefined
): Promise<Candidate[]> {
	const ai = platform?.env?.AI;
	if (!ai || candidates.length === 0) return candidates;
	try {
		const flags = await cached(`politics:${POLITICS_PROMPT_VERSION}:${poolKey}`, TTL.long, async () => {
			const result = await classifyPolitics(ai, candidates);
			if (!result) throw new Error('politics model unavailable');
			return result;
		});
		return applyPoliticsFlags(candidates, flags);
	} catch {
		recordEvent(platform, 'politics_fallback');
		return candidates;
	}
}
