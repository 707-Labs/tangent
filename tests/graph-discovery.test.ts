import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_ROUTES, NEIGHBORHOODS, rankConnections, parseMapVisit } from '../src/lib/graph/discovery';
import { parseAtlas } from '../src/lib/graph/atlas';
import { atlasWorld } from '../src/lib/graph/world';
const atlas = parseAtlas(JSON.parse(readFileSync('static/graph/atlas.v1.json', 'utf8')))!;
const nodes = atlasWorld(atlas.nodes);

describe('map discovery', () => {
	it('anchors every neighborhood and route stop to a real bundled article', () => {
		const titles = new Set(nodes.map((node) => node.title));
		for (const item of NEIGHBORHOODS) expect(titles.has(item.anchor), item.anchor).toBe(true);
		for (const route of DISCOVERY_ROUTES) for (const title of route.stops) expect(titles.has(title), title).toBe(true);
	});
	it('ranks only existing links, preferring concrete fresh destinations over dates', () => {
		const base = nodes[0];
		const values = [{ ...base, title: '1100s BC', thumbnail: null }, { ...base, title: 'Octopus', description: 'Marine animal', region: 'nature' }, { ...base, title: 'Silk Road', region: 'history' }];
		const ranked = rankConnections(values, ['Silk Road']);
		expect(ranked[0].title).toBe('Octopus');
		expect(new Set(ranked.map((node) => node.title))).toEqual(new Set(values.map((node) => node.title)));
		expect(values[0].title).toBe('1100s BC');
	});
	it('does not promote broad continents or disciplines merely for regional variety', () => {
		const base = nodes[0];
		const values = [
			{ ...base, title: 'Africa', description: 'Continent', region: 'places' },
			{ ...base, title: 'Cosmology', description: 'Study of the universe', region: 'science' },
			{ ...base, title: 'Habitable zone', description: 'Orbits where planets may have liquid surface water', region: 'science' },
			{ ...base, title: 'Ptolemy', description: 'Greco-Roman astronomer and geographer', region: 'people' },
			{ ...base, title: 'Nebula', description: 'Body of interstellar clouds', region: 'science' }
		];
		expect(rankConnections(values, []).slice(0, 3).map((node) => node.title)).not.toContain('Africa');
		expect(rankConnections(values, []).slice(0, 3).map((node) => node.title)).not.toContain('Cosmology');
	});
	it('validates bounded map restoration and rejects malformed camera state', () => {
		const saved = { selected: 'Astronomy', trail: ['Earth', 'Astronomy'], camera: { x: 100, y: 50, k: .5 }, region: 'science', neighborhood: 'Astronomy' };
		expect(parseMapVisit(saved)).toEqual(saved);
		expect(parseMapVisit({ ...saved, camera: { x: Infinity, y: 0, k: 1 } })).toBeNull();
		expect(parseMapVisit({ ...saved, trail: Array(13).fill('Earth') })).toBeNull();
		expect(parseMapVisit({ ...saved, neighborhood: 'Invented' })).toBeNull();
	});
});
