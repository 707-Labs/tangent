/** Read-only Wikipedia renderer inventory. Full upstream pages stay outside Git.
 * bun scripts/renderer-audit.ts /tmp/tangent-renderer-audit [--refresh]
 * Inventory checks are structural, not a substitute for browser layout checks. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeArticleHtml } from '../src/lib/wikipedia/article';

const titles = [
	'Quantum mechanics', 'Sulfuric acid', 'Periodic table', 'Octopus', 'Paris',
	'Earth', 'Timeline of the far future', 'Apollo 11', 'The Raven', 'Violin',
	'List of sovereign states', 'Python (programming language)', 'New York City',
	'Flag of Japan', 'Help:Gallery', 'Help:Math', 'Help:IPA',
	'Template:Graphical timeline', 'COVID-19 pandemic', 'History of Earth',
	'Template:Pie chart', 'Template:Clade'
];
const directory = process.argv[2] ?? '/tmp/tangent-renderer-audit';
const refresh = process.argv.includes('--refresh');
await mkdir(directory, { recursive: true });
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
const tags = ['img', 'table', 'math', 'audio', 'video', 'source', 'track', 'svg', 'map', 'area', 'dl', 'pre', 'figcaption'];
const results = [];
for (const title of titles) {
	const path = join(directory, `${title.replaceAll('/', '_')}.html`);
	const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
	try {
		let raw: string;
		try {
			if (refresh) throw new Error('refresh');
			raw = await readFile(path, 'utf8');
		} catch {
			const response = await fetch(url, {
				headers: { 'User-Agent': 'TangentRendererAudit/0.1 (https://tangent.page)', Accept: 'text/html' },
				signal: AbortSignal.timeout(45_000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			raw = await response.text();
			await writeFile(path, raw);
		}
		const html = sanitizeArticleHtml(raw);
		// Shed quoted metadata before counting, so literal tags in transclusion JSON
		// are not mistaken for visible elements. This remains an inventory heuristic.
		const body = raw.replace(/\sdata-(?:mw|parsoid)=("[^"]*"|'[^']*')/gi, '');
		results.push({ title, url, rawBytes: Buffer.byteLength(raw), renderedBytes: Buffer.byteLength(html),
			elements: Object.fromEntries(tags.map((tag) => [tag, { upstream: count(body, tag), rendered: count(html, tag) }])),
			sources: (html.match(/class="wh-sources"/g) ?? []).length,
			features: ['gallery', 'locmap', 'wh-tl', 'timeline-wrapper', 'enwiki-chart', 'clade', 'wh-climate', 'wh-imagemap']
				.filter((name) => new RegExp(`class="[^"]*\\b${name}\\b`).test(html))
		});
	} catch (error) {
		results.push({ title, url, error: error instanceof Error ? error.message : String(error) });
	}
}
const output = join(directory, 'report.json');
await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(output);
for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => 'error' in result)) process.exitCode = 1;
