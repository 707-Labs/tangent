import { isPolitical } from '../../src/lib/feed/politics.ts';
import { readFileSync } from 'node:fs';
const D = '../feed-sim/';
// Usage: bun run compare-arms.ts <regex results name> <model results name> <politics cache file>
const [A_NAME = 'regex2', B_NAME = 'v2', PC = 'politics-cache.v2.json'] = process.argv.slice(2);
const pc: Record<string, Record<string, boolean>> = JSON.parse(readFileSync(D + PC, 'utf8'));
// Global model verdict per title: true if the model flagged it in any pool; undefined if never judged.
const yes = new Map<string, number>(), tot = new Map<string, number>();
for (const pool of Object.values(pc)) for (const [t, f] of Object.entries(pool)) { tot.set(t, (tot.get(t) ?? 0) + 1); yes.set(t, (yes.get(t) ?? 0) + (f ? 1 : 0)); }
const model = new Map<string, boolean>([...tot.keys()].map((t) => [t, yes.get(t)! / tot.get(t)! > 0.5]));
type J = { seed: string; persona: string; arm: string; rngSeed: number; path: any[]; firstBroadStep: number | null; firstCoreStep: number | null };
const load = (n: string): J[] => JSON.parse(readFileSync(D + `results-${n}.json`, 'utf8'));
const key = (j: J) => `${j.seed}|${j.persona}|${j.arm}|${j.rngSeed}`;
function stats(js: J[]) {
  const m = new Map<string, { regex: number; model: number; either: number; modelOnly: number; unjudged: number; n: number }>();
  for (const j of js) {
    const cards = j.path.slice(1); // exclude the seed
    let r = 0, mo = 0, e = 0, only = 0, un = 0;
    for (const c of cards) {
      const rx = isPolitical(`${c.title} ${c.description ?? ''} ${(c.categories ?? []).join(' ')}`);
      const md = model.get(c.title);
      if (md === undefined) un++;
      if (rx) r++; if (md) mo++; if (rx || md) e++; if (md && !rx) only++;
    }
    const n = Math.max(1, cards.length);
    m.set(key(j), { regex: r / n, model: mo / n, either: e / n, modelOnly: only / n, unjudged: un / n, n: cards.length });
  }
  return m;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const mu = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1)); };
const ci = (a: number[]) => 1.96 * sd(a) / Math.sqrt(a.length);
const pct = (x: number) => (100 * x).toFixed(2) + '%';
const A = load(A_NAME), B = load(B_NAME);
const sa = stats(A), sb = stats(B);
console.log('journeys', A.length, B.length, 'cards', A.reduce((s, j) => s + j.path.length - 1, 0), B.reduce((s, j) => s + j.path.length - 1, 0));
for (const f of ['regex', 'model', 'either', 'modelOnly', 'unjudged'] as const) {
  const keys = [...sa.keys()].filter((k) => sb.has(k));
  const a = keys.map((k) => sa.get(k)![f]), b = keys.map((k) => sb.get(k)![f]);
  const d = keys.map((k) => sb.get(k)![f] - sa.get(k)![f]);
  console.log(`${f.padEnd(10)} regexArm ${pct(mean(a))} ±${pct(ci(a))} (sd ${pct(sd(a))})  option1Arm ${pct(mean(b))} ±${pct(ci(b))} (sd ${pct(sd(b))})  paired diff ${pct(mean(d))} ±${pct(ci(d))}  n=${keys.length}`);
}
function wilson(k: number, n: number) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return `${k}/${n} = ${pct(p)} [${pct(c - h)}–${pct(c + h)}]`; }
for (const [name, js] of [['regex', A], ['option1', B]] as const) {
  console.log(name, 'any cluster', wilson(js.filter((j) => j.firstBroadStep !== null).length, js.length), ' core', wilson(js.filter((j) => j.firstCoreStep !== null).length, js.length));
}
// Distinct model-only titles served in option-1 arm (sample)
const only = new Map<string, number>();
for (const j of B) for (const c of j.path.slice(1)) if (model.get(c.title) && !isPolitical(`${c.title} ${c.description ?? ''} ${(c.categories ?? []).join(' ')}`)) only.set(c.title, (only.get(c.title) ?? 0) + 1);
console.log('option1 arm: model-only political cards still served (they get the penalty but can win):', [...only.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
const onlyA = new Map<string, number>();
for (const j of A) for (const c of j.path.slice(1)) if (model.get(c.title) && !isPolitical(`${c.title} ${c.description ?? ''} ${(c.categories ?? []).join(' ')}`)) onlyA.set(c.title, (onlyA.get(c.title) ?? 0) + 1);
console.log('regex arm: model-only political cards served:', [...onlyA.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
