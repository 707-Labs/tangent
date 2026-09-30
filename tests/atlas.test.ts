import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS_REGIONS, compactAtlasIntro, parseAtlas, type AtlasArticle, type AtlasData } from '../src/lib/graph/atlas';

function node(title: string): AtlasArticle {
	return { title, description: 'Real encyclopedia subject', extract: 'A compact Wikipedia introduction.',
		thumbnail: null, wikiUrl: `https://en.wikipedia.org/wiki/${title}`, lang: 'en', tokens: ['subject'],
		x: 0, y: 0, region: 'history', hub: false, outgoing: [], neighbors: [] };
}
function snapshot(): AtlasData {
	const source = node('Roman Empire');
	const target = node('Byzantine Empire');
	source.outgoing = [target.title];
	source.neighbors = [target.title];
	target.neighbors = [source.title];
	return { version: 1, generatedAt: '2026-09-30T12:00:00.000Z', language: 'en',
		aliases: { 'Eastern Roman Empire': target.title }, nodes: [source, target] };
}

describe('precomputed atlas validation', () => {
	it('accepts a real directed hyperlink and its incoming navigation adjacency', () => {
		const data = snapshot();
		expect(parseAtlas(data)?.nodes).toEqual(data.nodes);
		expect(parseAtlas(data)?.aliases['Eastern Roman Empire']).toBe('Byzantine Empire');
	});

	it('rejects dangling targets, duplicate canonical nodes and invented map connections', () => {
		const dangling = snapshot(); dangling.nodes[0].neighbors.push('Not included');
		expect(parseAtlas(dangling)).toBeNull();
		const duplicate = snapshot(); duplicate.nodes.push(node('Roman Empire'));
		expect(parseAtlas(duplicate)).toBeNull();
		const invented = snapshot(); invented.nodes[0].outgoing = [];
		expect(parseAtlas(invented)).toBeNull();
	});

	it('rejects incorrect versions, aliases, coordinates and unsafe content URLs', () => {
		const badVersion = { ...snapshot(), version: 2 };
		expect(parseAtlas(badVersion)).toBeNull();
		const badAlias = snapshot(); badAlias.aliases['Eastern Roman Empire'] = 'Absent';
		expect(parseAtlas(badAlias)).toBeNull();
		const coordinates = snapshot(); coordinates.nodes[0].x = Number.NaN;
		expect(parseAtlas(coordinates)).toBeNull();
		const outOfBounds = snapshot(); outOfBounds.nodes[0].y = 100_000;
		expect(parseAtlas(outOfBounds)).toBeNull();
		const unsafe = snapshot(); unsafe.nodes[0].wikiUrl = 'javascript:alert(1)';
		expect(parseAtlas(unsafe)).toBeNull();
		expect(parseAtlas(null)).toBeNull();
	});

	it('keeps short intros and cuts long or API-truncated intros at a complete sentence', () => {
		expect(compactAtlasIntro('A short complete introduction.')).toBe('A short complete introduction.');
		const complete = `${'Useful factual context '.repeat(23).trim()}.`;
		const cut = `${complete} ${'An unfinished sentence '.repeat(25)}...`;
		expect(compactAtlasIntro(cut)).toBe(complete);
		expect(compactAtlasIntro('word '.repeat(240)).length).toBeLessThanOrEqual(901);
	});

	it('requires the canonical English Wikipedia URL while accepting encoded titles', () => {
		const data = snapshot();
		data.nodes[0].wikiUrl = 'https://en.wikipedia.org/wiki/Roman_Empire';
		expect(parseAtlas(data)).not.toBeNull();
		for (const url of [
			'https://example.com/wiki/Roman_Empire',
			'http://en.wikipedia.org/wiki/Roman_Empire',
			'https://en.wikipedia.org/wiki/Coffee',
			'https://en.wikipedia.org/wiki/Roman_Empire?redirect=no',
			'https://user:password@en.wikipedia.org/wiki/Roman_Empire',
			'https://en.wikipedia.org/wiki/%INVALID'
		]) {
			data.nodes[0].wikiUrl = url;
			expect(parseAtlas(data)).toBeNull();
		}
		const bounded = snapshot(); bounded.nodes[0].description = 'x'.repeat(2001);
		expect(parseAtlas(bounded)).toBeNull();
		const tokens = snapshot(); tokens.nodes[0].tokens = Array(257).fill('bounded');
		expect(parseAtlas(tokens)).toBeNull();
	});

	it('keeps prototype-like aliases inert and leaves the supplied snapshot untouched', () => {
		const data = snapshot();
		data.aliases = JSON.parse('{"__proto__":"Roman Empire","constructor":"Byzantine Empire"}') as Record<string, string>;
		const before = structuredClone(data);
		const parsed = parseAtlas(data)!;
		expect(Object.getPrototypeOf(parsed.aliases)).toBeNull();
		expect(parsed.aliases.__proto__).toBe('Roman Empire');
		expect(parsed.aliases.constructor).toBe('Byzantine Empire');
		expect(parsed.aliases.toString).toBeUndefined();
		expect(data).toEqual(before);
	});
});


it('ships a substantial validated atlas across every map region', () => {
	const data = parseAtlas(JSON.parse(readFileSync(new URL('../static/graph/atlas.v1.json', import.meta.url), 'utf8')));
	expect(data).not.toBeNull();
	expect(data!.nodes.length).toBeGreaterThanOrEqual(1500);
	expect(new Set(data!.nodes.map((article) => article.region))).toEqual(new Set(ATLAS_REGIONS));
	expect(data!.nodes.reduce((total, article) => total + article.outgoing.length, 0)).toBeGreaterThan(data!.nodes.length);
	expect(data!.nodes.every((article) => article.extract.length <= 901)).toBe(true);
});
