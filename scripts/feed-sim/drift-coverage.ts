/**
 * Drift-framing coverage: what share of drift breaks (run resets without a
 * deliberate tangent) hold a NAMEABLE direction relative to the run they broke
 * from — i.e. how often the divider can say "meanwhile, elsewhere" instead of a
 * bare "Tangent".
 *
 * Runs the same classifier the engine uses, reconstructing each run's
 * era/place/category context from the stored path, so it can be applied to a
 * results file recorded BEFORE the drift-direction bonus existed. That makes it
 * the counterfactual for the bonus:
 *
 *   bun run drift-coverage.ts baseline main
 *
 * Caveat: the two runs walk different paths (the bonus changes picks, which
 * changes everything downstream), so this compares policies, not a controlled
 * A/B on identical candidate pools.
 */
import { readFileSync } from 'node:fs';
import { classifyDirection, eraBuckets, placeTokens } from '../../src/lib/feed/directions';
import { categoryTokenSet } from '../../src/lib/feed/tokens';

type Step = {
	title: string;
	description: string | null;
	categories: string[];
	surprised: boolean;
	direction: 'era' | 'place' | 'theme' | null;
	runReset: boolean;
};
type Journey = { seed: string; path: Step[] };

function coverage(mode: string) {
	const journeys: Journey[] = JSON.parse(
		readFileSync(`${import.meta.dir}/results-${mode}.json`, 'utf8')
	);

	let drifts = 0;
	const byDirection = new Map<string, number>();

	for (const j of journeys) {
		for (let i = 1; i < j.path.length; i++) {
			const step = j.path[i];
			if (!step.runReset || step.surprised) continue;
			drifts++;

			// The run this break left: walk back to the previous reset (inclusive —
			// that card started the run), mirroring the engine's run accumulation.
			const run: Step[] = [];
			for (let k = i - 1; k >= 0; k--) {
				run.unshift(j.path[k]);
				if (j.path[k].runReset) break;
			}
			const ctx = {
				runEras: new Set<string>(),
				runPlaces: new Set<string>(),
				runCategories: new Set<string>()
			};
			for (const c of run) {
				for (const e of eraBuckets(c)) ctx.runEras.add(e);
				for (const p of placeTokens(c)) ctx.runPlaces.add(p);
				for (const t of categoryTokenSet(c.categories)) ctx.runCategories.add(t);
			}

			const d = classifyDirection(step, ctx) ?? 'unnameable';
			byDirection.set(d, (byDirection.get(d) ?? 0) + 1);
		}
	}

	const nameable = drifts - (byDirection.get('unnameable') ?? 0);
	console.log(`\n${mode}: ${drifts} drift breaks`);
	console.log(`  nameable: ${nameable} (${((100 * nameable) / drifts).toFixed(1)}%)`);
	for (const d of ['era', 'place', 'theme']) {
		const n = byDirection.get(d) ?? 0;
		console.log(`    ${d.padEnd(6)} ${String(n).padStart(5)}  (${((100 * n) / drifts).toFixed(1)}%)`);
	}
	return { drifts, nameable };
}

const modes = process.argv.slice(2);
const results = modes.map((m) => ({ mode: m, ...coverage(m) }));
if (results.length === 2) {
	const [a, b] = results;
	const pa = (100 * a.nameable) / a.drifts;
	const pb = (100 * b.nameable) / b.drifts;
	// Two-proportion z-test — the runs are independent walks, so a plain
	// difference-of-proportions interval is the right (approximate) gate.
	const p = (a.nameable + b.nameable) / (a.drifts + b.drifts);
	const se = Math.sqrt(p * (1 - p) * (1 / a.drifts + 1 / b.drifts)) * 100;
	console.log(
		`\n${b.mode} − ${a.mode}: ${(pb - pa >= 0 ? '+' : '')}${(pb - pa).toFixed(1)} pp ` +
			`(95% CI ${(pb - pa - 1.96 * se).toFixed(1)} to ${(pb - pa + 1.96 * se).toFixed(1)} pp)`
	);
}
