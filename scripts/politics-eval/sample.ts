import { isPolitical } from '../../src/lib/feed/politics.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const cache = JSON.parse(readFileSync('../../scripts/feed-sim/cache.json', 'utf8'));
let s = 20261113; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pool = (t: string) => (cache[t] ?? []).filter((c: any) => !c.isDisambiguation);
const text = (c: any) => `${c.title} ${c.description ?? ''} ${(c.categories ?? []).join(' ')}`;
const history = ['Roman Empire', 'Byzantine Empire', 'Ottoman Empire', 'Napoleon', 'Cold War', 'Middle Ages', 'Kingdom of France', 'Achaemenid Empire'];
const all = Object.keys(cache).filter((t) => pool(t).length >= 20 && !history.includes(t));
const polHeavy = shuffle(all.filter((t) => pool(t).filter((c: any) => isPolitical(text(c))).length >= 8)).slice(0, 10);
const random = shuffle(all.filter((t) => !polHeavy.includes(t))).slice(0, 10);
const items: any[] = [];
for (const [stratum, tips] of [['history', history], ['politics-heavy', polHeavy], ['random', random]] as const)
  for (const tip of tips) for (const c of shuffle(pool(tip)).slice(0, 6))
    items.push({ id: items.length, stratum, pool: tip, title: c.title, description: c.description ?? null, categories: (c.categories ?? []).slice(0, 8).map((x: string) => x.replace(/^Category:/, '')) });
for (const tip of ['United States', 'United Kingdom']) for (const c of shuffle(pool(tip)).slice(0, 6))
  items.push({ id: items.length, stratum: 'contemporary', pool: tip, title: c.title, description: c.description ?? null, categories: (c.categories ?? []).slice(0, 8).map((x: string) => x.replace(/^Category:/, '')) });
writeFileSync(process.argv[2], JSON.stringify(items, null, 1));
writeFileSync(process.argv[3], items.map((i) => `${i.id}\t${i.title} — ${i.description ?? '(none)'} | ${i.categories.join('; ')}`).join('\n'));
console.log(items.length, 'items; pools:', [...history, ...polHeavy, ...random].length, '\npolHeavy:', polHeavy.join(' / '), '\nrandom:', random.join(' / '));
