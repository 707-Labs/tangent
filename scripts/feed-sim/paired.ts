/**
 * Paired comparison of two sim result sets. Unlike compare.ts (independent-sample
 * CIs on marginal means), this matches each (seed, persona, arm, rngSeed) tuple across
 * the two configs and puts the CI on the PER-TUPLE delta. Because the harness is fully
 * deterministic and seed-matched, two configs start each tuple identically; for levers
 * that only nudge the relevance channel the walks stay identical until the learned vector
 * starts to matter, so the paired delta strips exactly the between-walk variance that
 * would otherwise bury the signal.
 *
 * Usage: bun run paired.ts <baselineTag> <variantTag>
 */
import { readFileSync } from 'node:fs';

interface PathStep { title: string; surprised: boolean; onInterest: boolean; tier: 'core' | 'broad' | null }
interface Journey {
	seed: string; persona: string; arm: 'adaptive' | 'control'; rngSeed: number;
	path: PathStep[]; poolSizes?: number[];
	firstCoreStep: number | null; firstBroadStep: number | null;
	sinkLandings: { political: boolean }[]; deadEndedAt: number | null;
}

const [baseTag, varTag] = process.argv.slice(2);
if (!baseTag || !varTag) { console.error('usage: bun run paired.ts <baselineTag> <variantTag>'); process.exit(1); }
const load = (t: string): Journey[] => JSON.parse(readFileSync(`${import.meta.dir}/results-${t}.json`, 'utf8'));
const A = load(baseTag), B = load(varTag);

const key = (j: Journey) => `${j.seed}|${j.persona}|${j.arm}|${j.rngSeed}`;
const mapB = new Map(B.map((j) => [key(j), j]));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const ci = (xs: number[]) => 1.96 * std(xs) / Math.sqrt(Math.max(1, xs.length));
const pct = (x: number) => `${(x >= 0 ? '+' : '')}${(100 * x).toFixed(2)}pp`;
const oi = (j: Journey) => (j.path.length ? j.path.filter((p) => p.onInterest).length / j.path.length : null);

// first step at which two paths diverge (1-based), or null if identical over the shared prefix
function divergeStep(a: Journey, b: Journey): number | null {
	const n = Math.min(a.path.length, b.path.length);
	for (let i = 0; i < n; i++) if (a.path[i].title !== b.path[i].title) return i + 1;
	if (a.path.length !== b.path.length) return n + 1;
	return null;
}

console.log(`# Paired: ${baseTag} -> ${varTag}\n`);

// ---- Path divergence (did the lever change the walk at all?) -----------------
console.log('## Path divergence (per matched tuple)');
for (const armSel of [
	['balanced/control (literal cold start)', (j: Journey) => j.persona === 'balanced' && j.arm === 'control'],
	['adaptive (persona != balanced)', (j: Journey) => j.persona !== 'balanced' && j.arm === 'adaptive'],
	['control (persona != balanced)', (j: Journey) => j.persona !== 'balanced' && j.arm === 'control'],
] as const) {
	const [label, sel] = armSel;
	const tuples = A.filter(sel);
	let matched = 0, diverged = 0; const divSteps: number[] = [];
	for (const a of tuples) {
		const b = mapB.get(key(a)); if (!b) continue; matched++;
		const d = divergeStep(a, b);
		if (d !== null) { diverged++; divSteps.push(d); }
	}
	const fr = matched ? diverged / matched : 0;
	console.log(`  ${label.padEnd(40)} ${diverged}/${matched} diverged (${(100 * fr).toFixed(0)}%)` +
		(divSteps.length ? `, median first-diverge step ${divSteps.sort((x, y) => x - y)[Math.floor(divSteps.length / 2)]}` : ''));
}
console.log();

// ---- Paired on-interest delta (the relevance-channel signal) -----------------
console.log('## Paired on-interest delta  (variant OI - baseline OI, same tuple)');
console.log('arm        | persona  | n |  paired ΔOI (mean ± 95% CI) | n changed');
// COMPLETED_ONLY=1 restricts to tuples where NEITHER walk dead-ended (both ran to the
// length cap) — strips tuples truncated by cold-cache rate-limit failures, whose OI
// denominators are corrupted. This is the trustworthy subset for the relevance-channel ΔOI.
const COMPLETED_ONLY = process.env.COMPLETED_ONLY === '1';
function pairedDelta(armName: 'adaptive' | 'control', persona?: string) {
	const deltas: number[] = []; let changed = 0;
	for (const a of A) {
		if (a.arm !== armName || a.persona === 'balanced') continue;
		if (persona && a.persona !== persona) continue;
		const b = mapB.get(key(a)); if (!b) continue;
		if (COMPLETED_ONLY && (a.deadEndedAt !== null || b.deadEndedAt !== null)) continue;
		const oa = oi(a), ob = oi(b); if (oa === null || ob === null) continue;
		deltas.push(ob - oa);
		if (Math.abs(ob - oa) > 1e-9) changed++;
	}
	return { deltas, changed };
}
const personas = [...new Set(A.filter((j) => j.persona !== 'balanced').map((j) => j.persona))];
for (const arm of ['adaptive', 'control'] as const) {
	for (const p of [...personas, undefined]) {
		const { deltas, changed } = pairedDelta(arm, p);
		const tag = p ?? '**POOLED**';
		console.log(`${arm.padEnd(10)} | ${tag.padEnd(8)} | ${String(deltas.length).padStart(2)} | ${pct(mean(deltas)).padStart(8)} ± ${(100 * ci(deltas)).toFixed(2)}pp`.padEnd(58) + ` | ${changed}`);
	}
}
console.log('\n(adaptive ΔOI is the relevance-channel effect; control ΔOI is the placebo —');
console.log(' it should stay ~0 for levers that only act through the learned vector.)\n');

// ---- Cluster drift + pool size (cold-start balanced) -------------------------
const coldA = A.filter((j) => j.persona === 'balanced' && j.arm === 'control');
const coldB = B.filter((j) => j.persona === 'balanced' && j.arm === 'control');
const anyCluster = (J: Journey[]) => J.filter((j) => j.firstBroadStep !== null).length / Math.max(1, J.length);
const coreCluster = (J: Journey[]) => J.filter((j) => j.firstCoreStep !== null).length / Math.max(1, J.length);
const allPools = (J: Journey[]) => J.flatMap((j) => j.poolSizes ?? []);
const poolStats = (J: Journey[]) => {
	const p = allPools(J).sort((a, b) => a - b);
	if (!p.length) return 'n/a';
	const med = p[Math.floor(p.length / 2)];
	const below20 = p.filter((x) => x < 20).length / p.length;
	const at50 = p.filter((x) => x >= 50).length / p.length;
	return `median ${med}, mean ${mean(p).toFixed(1)}, <20: ${(100 * below20).toFixed(0)}%, =50(cap): ${(100 * at50).toFixed(0)}%`;
};
console.log('## Cold-start (balanced/control) drift + candidate pool');
console.log(`  reached any cluster:  ${(100 * anyCluster(coldA)).toFixed(1)}%  ->  ${(100 * anyCluster(coldB)).toFixed(1)}%`);
console.log(`  reached core (Nazi):  ${(100 * coreCluster(coldA)).toFixed(1)}%  ->  ${(100 * coreCluster(coldB)).toFixed(1)}%`);
console.log(`  pool size (baseline): ${poolStats(coldA)}`);
console.log(`  pool size (variant):  ${poolStats(coldB)}`);

const health = (J: Journey[]) => `mean len ${mean(J.map((j) => j.path.length)).toFixed(1)}, dead-ends ${J.filter((j) => j.deadEndedAt !== null).length}/${J.length}`;
console.log(`\n## Run health\n  ${baseTag}: ${health(A)}\n  ${varTag}: ${health(B)}`);
