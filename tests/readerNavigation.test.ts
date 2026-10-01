import { describe, expect, it } from 'vitest';
import { headingAnchor, sourceDestination, citationNoteId } from '../src/lib/reader/navigation';
import { loadReadingPosition, saveReadingPosition, nearestReadingAnchor } from '../src/lib/reader/position';
describe('reader navigation', () => {
	it('avoids existing heading anchors and repeated translated headings', () => {
		const used = new Set(['reader-history']);
		expect(headingAnchor('History', used)).toBe('reader-history-2');
		expect(headingAnchor('History', used)).toBe('reader-history-3');
		expect(headingAnchor('日本の歴史', used)).toBe('reader-日本の歴史');
	});
	it('recognizes citation targets without confusing backlinks or malformed escapes', () => {
		expect(citationNoteId('#cite_note-Smith%201-2')).toBe('cite_note-Smith 1-2');
		expect(citationNoteId('#cite_ref-1')).toBeNull();
		expect(citationNoteId('#cite_note-%zz')).toBeNull();
	});
	it('limits source destinations to web links', () => {
		expect(sourceDestination('https://www.publisher.test/book?q=1')?.domain).toBe('publisher.test');
		expect(sourceDestination('javascript:alert(1)')).toBeNull();
		expect(sourceDestination('#cite_ref-1')).toBeNull();
	});
});
describe('reading positions', () => {
	function memory() { let value: string | null = null; return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } }; }
	it('anchors within expanded sources instead of accumulating reflow from a distant heading', () => {
		const candidates = [{ id: 'References', top: -2400 }, { id: 'cite_note-22', top: 116 }, { id: 'cite_note-21', top: -18 }, { id: 'cite_note-23', top: 280 }];
		expect(nearestReadingAnchor(candidates, 120)).toEqual({ anchor: 'cite_note-22', offset: 4 });
		expect(nearestReadingAnchor([{ id: 'cite_note-22', top: 951 }], 955)).toEqual({ anchor: 'cite_note-22', offset: 4 });
		expect(nearestReadingAnchor([{ id: 'History', top: 500 }], 120)).toBeNull();
	});

	it('keeps the latest forty articles and survives missing/corrupt storage', () => {
		const store = memory();
		for (let i = 0; i < 45; i++) saveReadingPosition(store, `Article ${i}`, { anchor: 'History', offset: 12, ratio: .5, updated: i });
		expect(loadReadingPosition(store, 'Article 0')).toBeNull();
		expect(loadReadingPosition(store, 'toString')).toBeNull();
		expect(loadReadingPosition(null, 'Earth')).toBeNull();
		expect(loadReadingPosition(store, 'Article 44')?.anchor).toBe('History');
		expect(loadReadingPosition({ getItem: () => '{bad' }, 'Article')).toBeNull();
		expect(loadReadingPosition({ getItem: () => '{"Article":{"anchor":null,"offset":0,"ratio":3,"updated":1}}' }, 'Article')).toBeNull();
	});
	it('preserves bounded disclosure keys and accepts older positions without them', () => {
		const store = memory();
		saveReadingPosition(store, 'Sources article', { anchor: 'References', offset: 650, ratio: .9, updated: 1, disclosures: ['wh-sources:0', 'quick-facts:1'] });
		expect(loadReadingPosition(store, 'Sources article')?.disclosures).toEqual(['wh-sources:0', 'quick-facts:1']);
		const invalid = (disclosures: unknown) => ({ getItem: () => JSON.stringify({ Article: { anchor: null, offset: 0, ratio: .5, updated: 1, disclosures } }) });
		expect(loadReadingPosition(invalid(['script:0']), 'Article')).toBeNull();
		expect(loadReadingPosition(invalid(Array(65).fill('wh-sources:0')), 'Article')).toBeNull();
		expect(loadReadingPosition(invalid([null]), 'Article')).toBeNull();
	});

	it('does not interrupt reading when storage throws', () => {
		const store = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
		expect(() => saveReadingPosition(store, 'Earth', { anchor: null, offset: 0, ratio: 0, updated: 1 })).not.toThrow();
	});
});
