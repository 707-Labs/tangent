/** Local, resumable Wikipedia snapshot. Run: bun scripts/build-atlas.ts */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, initialWorld, titleHash } from '../src/lib/graph/world';
import { ATLAS_BOUNDS, compactAtlasIntro, parseAtlas, type AtlasArticle, type AtlasData } from '../src/lib/graph/atlas';
import { articleTitleFromHref } from '../src/lib/wikipedia/links';
import { tokenize } from '../src/lib/feed/tokens';
import type { Thumbnail } from '../src/lib/wikipedia/types';
import { layoutAtlas } from './layout-atlas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, '.cache/atlas-v1');
const OUTPUT = resolve(ROOT, 'static/graph/atlas.v1.json');
const TARGET = Number(process.env.ATLAS_TARGET ?? 2000);
const MAX_REQUESTS = 2300;
const REFRESH = process.env.ATLAS_REFRESH === '1';
const PER_PARENT = 12;
const UA = 'Tangent-Atlas-Builder/0.1 (https://github.com/vrennat/tangent; offline read-only graph snapshot)';
if (!Number.isInteger(TARGET) || TARGET < 42 || TARGET > 2000) throw new Error('ATLAS_TARGET must be 42–2000.');

interface WikiPage {
	title: string; ns: number; pageid?: number; missing?: boolean;
	description?: string; extract?: string; thumbnail?: Thumbnail; fullurl?: string;
	pageprops?: { disambiguation?: string };
}
interface WikiResponse {
	error?: { code?: string; info?: string };
	query?: { pages?: WikiPage[]; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] };
	parse?: { text?: string | { '*': string } };
}
interface Job { title: string; region: string; parent?: string; anchor: string; hub: boolean }
const nodes = new Map<string, AtlasArticle>();
const aliases: Record<string, string> = Object.create(null);
const rawLinks = new Map<string, string[]>();
const queues = new Map(REGIONS.map((region) => [region.id, [] as Job[]]));
const queued = new Set<string>();
const ownership = new Map<string, Job>();
const expanded = new Set<string>();
let requests = 0;
let cacheHits = 0;
let round = 0;
let failures = 0;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function get(params: Record<string, string>): Promise<WikiResponse> {
	const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
	const path = resolve(CACHE, `${createHash('sha256').update(url).digest('hex')}.json`);
	if (!REFRESH) {
		try { const data = JSON.parse(await readFile(path, 'utf8')) as WikiResponse; cacheHits++; return data; } catch { /* Cold or corrupt cache. */ }
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		if (++requests > MAX_REQUESTS) throw new Error('Atlas request budget exhausted.');
		try {
			const response = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
			if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
			const data = await response.json() as WikiResponse;
			if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
			await writeFile(path, JSON.stringify(data));
			return data;
		} catch (error) {
			if (attempt === 1) throw error;
			await sleep(3000);
		}
	}
	throw new Error('Unreachable retry state.');
}
function canonical(title: string): string {
	const seen = new Set<string>();
	while (Object.hasOwn(aliases, title) && aliases[title] !== title && !seen.has(title)) { seen.add(title); title = aliases[title]; }
	return title;
}
function enqueue(job: Job): void {
	if (queued.has(job.title) || nodes.has(canonical(job.title))) return;
	queued.add(job.title);
	queues.get(job.region)!.push(job);
}
function takeBatch(): Job[] {
	const jobs: Job[] = [];
	let empty = 0;
	while (jobs.length < Math.min(20, TARGET - nodes.size) && empty < REGIONS.length) {
		const region = REGIONS[round++ % REGIONS.length];
		const job = queues.get(region.id)!.shift();
		if (!job) { empty++; continue; }
		empty = 0;
		if (!nodes.has(canonical(job.title))) jobs.push(job);
	}
	return jobs;
}
function place(job: Job, title: string): { x: number; y: number } {
	const landmark = initialWorld().find((node) => node.title === job.title);
	if (landmark) return { x: landmark.x, y: landmark.y };
	const region = REGIONS.find((region) => region.id === job.region)!;
	const parent = nodes.get(canonical(job.parent ?? ''));
	const anchor = nodes.get(canonical(job.anchor));
	const hash = titleHash(title);
	const center = parent ?? anchor ?? region;
	let best = { x: region.x, y: region.y };
	for (let attempt = 0; attempt < 240; attempt++) {
		const angle = (hash % 6283) / 1000 + attempt * 2.399963;
		const radius = 80 + Math.sqrt(attempt) * 48;
		const x = Math.max(ATLAS_BOUNDS.minX + 40, Math.min(ATLAS_BOUNDS.maxX - 40, center.x + Math.cos(angle) * radius));
		const y = Math.max(ATLAS_BOUNDS.minY + 40, Math.min(ATLAS_BOUNDS.maxY - 40, center.y + Math.sin(angle) * radius));
		best = { x, y };
		if (![...nodes.values()].some((node) => Math.hypot(node.x - x, node.y - y) < 55)) return best;
	}
	return best;
}
function leadTitles(data: WikiResponse): string[] {
	const text = data.parse?.text;
	let html = typeof text === 'string' ? text : text?.['*'] ?? '';
	html = html.replace(/<ol\b[^>]*class="[^"]*\breferences\b[^"]*"[\s\S]*?<\/ol>/gi, '')
		.replace(/<sup\b[^>]*class="[^"]*\breference\b[^"]*"[\s\S]*?<\/sup>/gi, '');
	const titles = new Set<string>();
	for (const fragment of [(html.match(/<p\b[\s\S]*?<\/p>/gi) ?? []).join('\n'), html]) {
		for (const match of fragment.matchAll(/<a\b[^>]*?\shref="([^"]+)"/g)) {
			const title = articleTitleFromHref(match[1]);
			if (title && !/\(disambiguation\)$/i.test(title)) titles.add(title);
		}
	}
	return [...titles].slice(0, 80);
}
async function expand(title: string): Promise<void> {
	if (expanded.has(title)) return;
	expanded.add(title);
	try {
		const data = await get({ action: 'parse', page: title, prop: 'text', section: '0', disabletoc: '1', redirects: '1' });
		const links = leadTitles(data).filter((linked) => canonical(linked) !== title);
		rawLinks.set(title, links);
		const job = ownership.get(title)!;
		for (const linked of links.slice(0, PER_PARENT)) enqueue({ title: linked, region: job.region, parent: title, anchor: job.anchor, hub: false });
	} catch (error) { failures++; console.warn(`Lead unavailable: ${title}: ${String(error)}`); }
}
async function expandPair(titles: string[]): Promise<void> {
	for (let i = 0; i < titles.length; i += 2) {
		await Promise.all(titles.slice(i, i + 2).map(expand));
		await sleep(100);
	}
}
/** Writes the crawl so far. The `final` write lays the atlas out from its links; earlier ones keep crawl positions. */
async function checkpoint(final = false): Promise<void> {
	const values = [...nodes.values()].map((node) => ({ ...node, outgoing: [...new Set((rawLinks.get(node.title) ?? []).map(canonical))]
		.filter((target) => target !== node.title && nodes.has(target)), neighbors: [] as string[] }));
	const byTitle = new Map(values.map((node) => [node.title, node]));
	for (const node of values) for (const target of node.outgoing) {
		node.neighbors.push(target);
		byTitle.get(target)!.neighbors.push(node.title);
	}
	for (const node of values) node.neighbors = [...new Set(node.neighbors)];
	const includedAliases = Object.fromEntries(Object.keys(aliases).map((alias) => [alias, canonical(alias)])
		.filter(([, target]) => nodes.has(target)));
	const laid = final ? layoutAtlas(values) : null;
	if (laid) console.log(JSON.stringify({ layout: laid.stats }));
	const snapshot: AtlasData = { version: 1, generatedAt: new Date().toISOString(), language: 'en', aliases: includedAliases, nodes: laid?.nodes ?? values };
	if (!parseAtlas(snapshot)) throw new Error('Generated atlas failed validation.');
	const json = JSON.stringify(snapshot);
	await writeFile(`${OUTPUT}.tmp`, json);
	await rename(`${OUTPUT}.tmp`, OUTPUT);
	console.log(JSON.stringify({ nodes: values.length, directedEdges: values.reduce((sum, node) => sum + node.outgoing.length, 0),
		bytes: Buffer.byteLength(json), requests, cacheHits, failures, regions: Object.fromEntries(REGIONS.map((region) =>
			[region.id, snapshot.nodes.filter((node) => node.region === region.id).length])) }));
}

await mkdir(CACHE, { recursive: true });
await mkdir(dirname(OUTPUT), { recursive: true });
for (const region of REGIONS) for (const [index, title] of region.titles.entries()) {
	enqueue({ title, region: region.id, anchor: title, hub: index === 0 });
}
while (nodes.size < TARGET) {
	const batch = takeBatch();
	if (!batch.length) break;
	let data: WikiResponse;
	try {
		data = await get({ action: 'query', titles: batch.map((job) => job.title).join('|'), redirects: '1',
			prop: 'extracts|pageimages|description|info|pageprops', exintro: '1', explaintext: '1', exchars: '900', exlimit: 'max',
			piprop: 'thumbnail', pithumbsize: '500', inprop: 'url', ppprop: 'disambiguation' });
	} catch (error) { console.warn(`Summary batch unavailable: ${String(error)}`); failures++; continue; }
	for (const mapping of [...data.query?.normalized ?? [], ...data.query?.redirects ?? []]) aliases[mapping.from] = mapping.to;
	const pages = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));
	const added: string[] = [];
	for (const job of batch) {
		const title = canonical(job.title);
		const page = pages.get(title);
		if (!page || page.ns !== 0 || page.missing || page.pageprops?.disambiguation !== undefined || !page.extract?.trim() || nodes.has(title)) continue;
		const point = place(job, title);
		nodes.set(title, { title, description: page.description ?? null, extract: compactAtlasIntro(page.extract), thumbnail: page.thumbnail ?? null,
			wikiUrl: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, lang: 'en',
			tokens: tokenize(`${title} ${page.description ?? ''}`), ...point, region: job.region, hub: job.hub, outgoing: [], neighbors: [] });
		ownership.set(title, job);
		added.push(title);
	}
	await expandPair(added);
	if (nodes.size) await checkpoint();
}
if (nodes.size < Math.min(1500, TARGET)) throw new Error(`Atlas too small: ${nodes.size} nodes; resume from cached successful requests.`);
await checkpoint(true);
console.log(`Atlas ready: ${nodes.size} real articles. ${OUTPUT}`);
