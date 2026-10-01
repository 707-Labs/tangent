import { describe, expect, it } from 'vitest';
import { parseSaved, loadSaved, saveArticles, SAVED_LIMIT } from '../src/lib/saved/storage';

const entry = (title = 'Coffee', savedAt = 1) => ({ title, savedAt, description: 'Brewed beverage', thumbnail: null });

describe('saved articles', () => {
	it('rejects corrupt entries, deduplicates, and bounds a newest-first list', () => {
		const entries = Array.from({ length: SAVED_LIMIT + 5 }, (_, index) => entry(`Article ${index}`, index));
		const result = parseSaved([null, {}, { title: 'bad', savedAt: Infinity }, entry('Coffee'), entry('Coffee'), ...entries]);
		expect(result).toHaveLength(SAVED_LIMIT);
		expect(result[0].title).toBe(`Article ${SAVED_LIMIT + 4}`);
		expect(result.filter(item => item.title === 'Coffee')).toHaveLength(0);
		expect(parseSaved([entry(), entry()])).toHaveLength(1);
	});
	it('keeps saved titles without rendering untrusted image URLs', () => {
		expect(parseSaved([{ ...entry(), thumbnail: { source: 'javascript:alert(1)', width: 100, height: 100 } }])[0].thumbnail).toBeNull();
		expect(parseSaved([{ ...entry(), thumbnail: { source: 'https://upload.wikimedia.org/a.jpg', width: 100, height: 200 } }])[0].thumbnail?.height).toBe(200);
	});
	it('storage failures leave reading usable', () => {
		const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } } as unknown as Storage;
		expect(loadSaved(storage)).toEqual([]);
		expect(() => saveArticles([entry()], storage)).not.toThrow();
	});
});
