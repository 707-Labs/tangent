import { describe, expect, it } from 'vitest';
import { exploreChoices } from '../src/lib/feed/explore';
import { disinterest, undoDisinterest } from '../src/lib/engagement/feedback';
import type { Article, Candidate } from '../src/lib/wikipedia/types';

const article: Article = { title: 'Coffee', description: 'Brewed beverage', extract: '', thumbnail: null, wikiUrl: '', lang: 'en', tokens: [] };
const candidate = (title: string, patch: Partial<Candidate> = {}): Candidate => ({ title, description: null, thumbnail: null, relation: 'related', isDisambiguation: false, categories: [], position: 0, ...patch });

describe('Explore chooser', () => {
	it('offers three distinct unseen destinations and excludes the source and disambiguation', () => {
		const pool = [candidate('Coffee'), candidate('Tea'), candidate('Tea'), candidate('Seen'), candidate('Ambiguous', { isDisambiguation: true }), candidate('Caffeine'), candidate('Coffeehouse'), candidate('Espresso')];
		const choices = exploreChoices(article, pool, new Set(['Seen']));
		expect(choices).toHaveLength(3);
		expect(choices.map(choice => choice.candidate.title)).toEqual(['Tea', 'Caffeine', 'Coffeehouse']);
	});
	it('prefers a concrete new subject to generic restatements', () => {
		const pool = [candidate('Coffee preparation', { description: 'Process of turning beans into a beverage' }), candidate('Coffeehouse', { description: 'Establishment serving coffee' }), candidate('Coffee production'), candidate('Coffee processing')];
		expect(exploreChoices(article, pool, new Set())[0].candidate.title).toBe('Coffeehouse');
	});
	it('only labels an era or place when the metadata supports it', () => {
		const source = { ...article, description: 'Ancient city in Italy in the 1st century BC' };
		const pool = [candidate('Pompeii', { description: 'Ancient city in Italy' }), candidate('Battle', { description: 'Battle in the 1st century BC' }), candidate('Unrelated')];
		const choices = exploreChoices(source, pool, new Set());
		expect(choices.find(choice => choice.candidate.title === 'Pompeii')?.connection).toBe('Same place');
		expect(choices.find(choice => choice.candidate.title === 'Battle')?.connection).toBe('Same era');
		expect(choices.find(choice => choice.candidate.title === 'Unrelated')?.connection).toBe('Related topic');
	});
	it('does not let early generic definitions crowd out named destinations', () => {
		const pool = [candidate('Coffee roasting', { description: 'Process of heating green coffee beans', position: 0 }),
			candidate('Caffeinated drink', { description: 'Type of drink', position: 2 }),
			candidate('Coffee preparation', { description: 'Process of turning coffee beans into a beverage', position: 8 }),
			candidate('Coffea canephora', { description: 'Species of coffee plant', position: 15 }),
			candidate('Yaupon tea', { description: 'Beverage made from yaupon holly', position: 16 }),
			candidate('Alfred Peet', { description: 'Dutch-American businessman', position: 19 })];
		expect(exploreChoices(article, pool, new Set()).map(choice => choice.candidate.title)).toEqual(['Alfred Peet', 'Coffea canephora', 'Yaupon tea']);
	});
});

describe('explicit disinterest undo', () => {
	it('undoes actual capped increments while keeping subsequent feedback', () => {
		const result = disinterest({ coffee: 1.7, history: 0.4 }, ['coffee', 'coffee', 'tea'], 0.8, 1.8);
		expect(result.weights).toEqual({ coffee: 1.8, history: 0.4, tea: 0.8 });
		const undone = undoDisinterest({ ...result.weights, geography: 0.5, tea: 1.2 }, result.delta);
		expect(undone.coffee).toBeCloseTo(1.7);
		expect(undone.tea).toBeCloseTo(0.4);
		expect(undone.geography).toBe(0.5);
	});
});
