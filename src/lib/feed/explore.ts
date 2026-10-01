import type { Article, Candidate } from '$lib/wikipedia/types';
import { specificity } from './score';
import { intrigue } from './taste';
import { eraBuckets, placeTokens } from './directions';
import { tokenSet } from './tokens';

export interface ExploreChoice { candidate: Candidate; connection: string; }

/** Reuse existing metadata. Labels describe only relationships the metadata supports. */
export function exploreChoices(article: Article, candidates: Candidate[], seen: Set<string>): ExploreChoice[] {
	const source = { description: article.description, categories: [] as string[] };
	const places = placeTokens(source);
	const eras = eraBuckets(source);
	const sourceWords = tokenSet(article.title);
	const unique = new Map<string, Candidate>();
	for (const candidate of candidates) {
		if (!candidate.title || candidate.title === article.title || candidate.isDisambiguation || seen.has(candidate.title)) continue;
		if (!unique.has(candidate.title)) unique.set(candidate.title, candidate);
	}
	const score = (candidate: Candidate): number => {
		const words = tokenSet(candidate.title);
		const restatement = words.size > sourceWords.size && [...sourceWords].every((word) => words.has(word));
		const generic = /^(?:a |the )?type of\b/i.test(candidate.description ?? '') ? 0.5 : 0;
		return specificity(candidate) + intrigue(candidate) * 0.5 + 0.15 / (1 + Math.max(0, candidate.position)) - (restatement ? 0.8 : 0) - generic;
	};
	return [...unique.values()].sort((a, b) => score(b) - score(a) || a.position - b.position).slice(0, 3).map((candidate) => {
		const samePlace = [...placeTokens(candidate)].some((place) => places.has(place));
		const sameEra = [...eraBuckets(candidate)].some((era) => eras.has(era));
		return { candidate, connection: samePlace ? 'Same place' : sameEra ? 'Same era' : candidate.relation === 'link' ? 'Linked in the article' : 'Related topic' };
	});
}

const pools = new Map<string, Promise<Candidate[]>>();
export function loadExplore(title: string): Promise<Candidate[]> {
	const cached = pools.get(title);
	if (cached) return cached;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	const request = fetch(`/api/links?from=${encodeURIComponent(title)}&mode=related`, { signal: controller.signal })
		.then(async (response) => {
			if (!response.ok) throw new Error('Could not load related topics.');
			const data = await response.json() as { candidates?: Candidate[] };
			const candidates = Array.isArray(data.candidates) ? data.candidates : [];
			if (!candidates.length) pools.delete(title);
			return candidates;
		}).catch((error: unknown) => { pools.delete(title); throw error; })
		.finally(() => clearTimeout(timer));
	if (pools.size >= 24) pools.delete(pools.keys().next().value!);
	pools.set(title, request);
	return request;
}
