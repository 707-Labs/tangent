// Scores the word rules, prompt v1 and the current prompt on the labelled set (gold.json).
//
//   bun run eval.ts           score from the committed verdicts.json; no model calls, no cache.
//   bun run eval.ts --fresh   re-run: needs scripts/feed-sim/cache.json (untracked, ~500 MB,
//                             built by feed-sim) and a Workers AI relay on localhost:18787.
//                             Each item is judged inside its full real pool, as production does.
//                             The 'v2' column re-runs whatever prompt src/ has now (v3 since the
//                             untrusted-data quoting); the committed verdicts are v2's.
import { isPolitical } from '../../src/lib/feed/politics.ts';
import * as v2 from '../../src/lib/server/politicsModel.ts';
import * as v1 from './politicsModel.v1.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const D = import.meta.dir;
const items: any[] = JSON.parse(readFileSync(D + '/items.json', 'utf8'));
const gold: Record<string, number> = JSON.parse(readFileSync(D + '/gold.json', 'utf8'));
const fresh = process.argv.includes('--fresh');
type Verdicts = { words: Record<string, boolean>; v1: Record<string, (boolean | null)[]>; v2: Record<string, (boolean | null)[]> };
let verdicts: Verdicts;
if (!fresh) {
  verdicts = JSON.parse(readFileSync(D + '/verdicts.json', 'utf8'));
} else {
  const cache = JSON.parse(readFileSync('../../scripts/feed-sim/cache.json', 'utf8'));
  const ai = { run: async (_m: string, input: unknown) => ((await (await fetch('http://localhost:18787', { method: 'POST', body: JSON.stringify(input) })).json()) as any).out };
  const pools = [...new Set(items.map((i) => i.pool))];
  verdicts = { words: {}, v1: {}, v2: {} };
  for (const it of items) {
    const c = cache[it.pool].find((x: any) => x.title === it.title);
    verdicts.words[it.id] = isPolitical(`${c.title} ${c.description ?? ''} ${(c.categories ?? []).join(' ')}`);
  }
  for (const [name, mod] of [['v1', v1], ['v2', v2]] as const) for (let run = 0; run < 2; run++) for (const p of pools) {
    const pool = cache[p].filter((c: any) => !c.isDisambiguation);
    const flags = await mod.classifyPolitics(ai, pool, 10_000);
    for (const it of items.filter((i) => i.pool === p)) (verdicts[name][it.id] ??= []).push(flags ? flags.get(it.title) ?? null : null);
  }
  writeFileSync(D + '/verdicts.json', JSON.stringify(verdicts));
}
function score(label: string, pred: (it: any) => boolean | null, subset = items) {
  let tp = 0, fp = 0, fn = 0, tn = 0, miss = 0;
  for (const it of subset) { const p = pred(it); if (p === null) { miss++; continue; } const g = gold[it.id] === 1; if (p && g) tp++; else if (p) fp++; else if (g) fn++; else tn++; }
  const prec = tp + fp ? (tp / (tp + fp)).toFixed(3) : 'n/a', rec = tp + fn ? (tp / (tp + fn)).toFixed(3) : 'n/a';
  console.log(`${label.padEnd(34)} TP ${tp} FP ${fp} FN ${fn} TN ${tn} missing ${miss}  precision ${prec} (${tp}/${tp + fp})  recall ${rec} (${tp}/${tp + fn})`);
}
const rx = (it: any) => verdicts.words[it.id];
for (const [sub, subset] of [['all', items], ['history stratum', items.filter((i) => i.stratum === 'history')]] as const) {
  console.log(`--- ${sub} (n=${subset.length}, gold positives ${subset.filter((i) => gold[i.id] === 1).length})`);
  score('word rules', rx, subset);
  for (const v of ['v1', 'v2'] as const) for (const r of [0, 1]) score(`${v} model alone, run ${r + 1}`, (it) => verdicts[v][it.id][r], subset);
  for (const v of ['v1', 'v2'] as const) score(`option 1 = word rules OR ${v} (run 1)`, (it) => { const m = verdicts[v][it.id][0]; return m === null ? rx(it) : m || rx(it); }, subset);
}
for (const v of ['v1', 'v2'] as const) console.log(v, 'run-to-run flips:', items.filter((i) => verdicts[v][i.id][0] !== verdicts[v][i.id][1]).length, '/', items.length);
