// Scores the word rules and each prompt version stored in verdicts.json (v1 is the prompt
// in commit 26617d8) against the labelled set (gold.json).
//
//   bun run eval.ts           score from the committed verdicts.json; no model calls, no cache.
//   bun run eval.ts --fresh   judge the set with the prompt src/ has now and store it under
//                             that prompt's version key (v1 and v2 are kept). Needs
//                             scripts/feed-sim/cache.json (untracked, ~500 MB, built by
//                             feed-sim) and a Workers AI relay on localhost:18787. Each item is
//                             judged inside its full real pool with direct model calls (the
//                             production breaker, cap and flood guard are bypassed); each
//                             pool's model-only share is stored so flood rejections can be
//                             counted separately.
import { isPolitical } from '../../src/lib/feed/politics.ts';
import { politicsRequest, POLITICS_PROMPT_VERSION, FLOOD_SHARE, FLOOD_MIN_POOL } from '../../src/lib/server/politicsModel.ts';
import { modelOnlyShare } from '../../src/lib/feed/politics.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const D = import.meta.dir;
const items: any[] = JSON.parse(readFileSync(D + '/items.json', 'utf8'));
const gold: Record<string, number> = JSON.parse(readFileSync(D + '/gold.json', 'utf8'));
const fresh = process.argv.includes('--fresh');
type Verdicts = { words: Record<string, boolean>; shares?: Record<string, Record<string, number>> } & Record<string, Record<string, (boolean | null)[]>>;
const verdicts: Verdicts = JSON.parse(readFileSync(D + '/verdicts.json', 'utf8'));
if (fresh) {
  const v = POLITICS_PROMPT_VERSION;
  const cache = JSON.parse(readFileSync('../../scripts/feed-sim/cache.json', 'utf8'));
  const run = async (input: unknown) => ((await (await fetch('http://localhost:18787', { method: 'POST', body: JSON.stringify(input) })).json()) as any).out;
  verdicts[v] = {};
  verdicts.shares ??= {};
  verdicts.shares[v] = {};
  for (let r = 0; r < 2; r++) for (const p of [...new Set(items.map((i) => i.pool))]) {
    const pool = cache[p].filter((c: any) => !c.isDisambiguation);
    const flags = new Map<string, boolean>();
    for (let i = 0; i < pool.length; i += 64) {
      const chunk = pool.slice(i, i + 64);
      const out = await run(politicsRequest(chunk));
      chunk.forEach((c: any, j: number) => { const n = out?.answers?.[`c${j}`]?.noul; if (typeof n === 'number') flags.set(c.title, n >= 0.5); });
    }
    if (r === 0) verdicts.shares[v][p] = modelOnlyShare(pool, flags);
    for (const it of items.filter((i) => i.pool === p)) (verdicts[v][it.id] ??= []).push(flags.has(it.title) ? flags.get(it.title)! : null);
  }
  writeFileSync(D + '/verdicts.json', JSON.stringify(verdicts));
}
const prompts = Object.keys(verdicts).filter((k) => /^v\d+$/.test(k));
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
  for (const v of prompts) for (const r of [0, 1]) score(`${v} model alone, run ${r + 1}`, (it) => verdicts[v][it.id][r], subset);
  for (const v of prompts) score(`option 1 = word rules OR ${v} (run 1)`, (it) => { const m = verdicts[v][it.id][0]; return m === null ? rx(it) : m || rx(it); }, subset);
}
for (const v of prompts) console.log(v, 'run-to-run flips:', items.filter((i) => verdicts[v][i.id][0] !== verdicts[v][i.id][1]).length, '/', items.length);
for (const [v, shares] of Object.entries(verdicts.shares ?? {})) {
  const vals = Object.values(shares);
  console.log(`${v} model-only share per pool (${vals.length} pools, run 1): max ${Math.max(...vals).toFixed(3)}; pools over ${FLOOD_SHARE} (flood guard, pools of ${FLOOD_MIN_POOL}+): ${vals.filter((x) => x > FLOOD_SHARE).length}`);
}
