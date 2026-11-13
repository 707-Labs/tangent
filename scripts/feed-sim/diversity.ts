/**
 * Paired topical-diversity delta — the serendipity counterweight to on-interest rate.
 * Raising relevanceWeight is expected to raise on-interest; the open question is whether
 * it does so by collapsing the walk into a topical echo chamber. We post-process the
 * EXISTING result paths (no new sim runs): each served card's description is looked up
 * from cache.json (every card appears there as a candidate under its parent), tokenized
 * with the BASELINE tokenizer, and summarised per walk by:
 *   - TTR  = distinct content tokens / total token instances (length-robust)
 *   - DPC  = distinct content tokens / cards served
 * Lower = more repetition = more bubble. Reports paired (variant − baseline) on adaptive arm.
 *
 * Usage: bun run diversity.ts <baselineTag> <variantTag> [cacheFile]
 */
import { readFileSync } from 'node:fs';
import { tokenize } from '../../src/lib/feed/tokens.ts';
import type { Candidate } from '../../src/lib/wikipedia/types.ts';

const [baseTag, varTag, cacheFile = 'cache.json'] = process.argv.slice(2);
if (!baseTag || !varTag) { console.error('usage: bun run diversity.ts <baselineTag> <variantTag> [cacheFile]'); process.exit(1); }

interface Journey { seed: string; persona: string; arm: string; rngSeed: number; path: { title: string }[]; deadEndedAt: number | null }
const load = (t: string): Journey[] => JSON.parse(readFileSync(`${import.meta.dir}/results-${t}.json`, 'utf8'));
const cache: Record<string, Candidate[]> = JSON.parse(readFileSync(`${import.meta.dir}/${cacheFile}`, 'utf8'));

// title -> description, harvested from every candidate in the cache.
const desc = new Map<string, string>();
for (const cands of Object.values(cache)) for (const c of cands) if (!desc.has(c.title)) desc.set(c.title, `${c.title} ${c.description ?? ''}`);

function walkDiversity(j: Journey): { ttr: number; dpc: number } | null {
	if (j.path.length < 3) return null;
	const all: string[] = [];
	for (const step of j.path) {
		const text = desc.get(step.title) ?? step.title; // fall back to bare title if uncached
		all.push(...tokenize(text));
	}
	if (all.length === 0) return null;
	const distinct = new Set(all).size;
	return { ttr: distinct / all.length, dpc: distinct / j.path.length };
}

const A = load(baseTag), B = load(varTag);
const key = (j: Journey) => `${j.seed}|${j.persona}|${j.arm}|${j.rngSeed}`;
const mapB = new Map(B.map((j) => [key(j), j]));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const ci = (xs: number[]) => 1.96 * std(xs) / Math.sqrt(Math.max(1, xs.length));
const COMPLETED_ONLY = process.env.COMPLETED_ONLY === '1';

console.log(`# Paired topical diversity: ${baseTag} -> ${varTag}${COMPLETED_ONLY ? '  (completed-only)' : ''}\n`);
console.log('arm/persona      | n  | Δ TTR (×100, ±CI)      | Δ distinct-per-card (±CI)   | base TTR -> var TTR');
function row(label: string, sel: (j: Journey) => boolean) {
	const dT: number[] = [], dD: number[] = [], bT: number[] = [], vT: number[] = [];
	for (const a of A) {
		if (!sel(a)) continue;
		const b = mapB.get(key(a)); if (!b) continue;
		if (COMPLETED_ONLY && (a.deadEndedAt !== null || b.deadEndedAt !== null)) continue;
		const da = walkDiversity(a), db = walkDiversity(b); if (!da || !db) continue;
		dT.push(db.ttr - da.ttr); dD.push(db.dpc - da.dpc); bT.push(da.ttr); vT.push(db.ttr);
	}
	const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
	console.log(`${label.padEnd(16)} | ${String(dT.length).padStart(2)} | ${f(100 * mean(dT))} ± ${(100 * ci(dT)).toFixed(2)}`.padEnd(42) +
		` | ${f(mean(dD))} ± ${ci(dD).toFixed(2)}`.padEnd(30) + ` | ${(100 * mean(bT)).toFixed(1)} -> ${(100 * mean(vT)).toFixed(1)}`);
}
const personas = [...new Set(A.filter((j) => j.persona !== 'balanced').map((j) => j.persona))];
for (const p of personas) row(`adaptive/${p}`, (j) => j.arm === 'adaptive' && j.persona === p);
row('adaptive/POOLED', (j) => j.arm === 'adaptive' && j.persona !== 'balanced');
console.log('\nTTR = distinct tokens / total tokens across served descriptions (higher = more topical spread).');
console.log('A negative ΔTTR under higher relevance = the predicted filter-bubble / serendipity cost.');
