import { afterEach, expect, it, vi } from 'vitest';
import type { Article } from '../src/lib/wikipedia/types';
vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/engagement/profile.svelte', () => ({ profile: { recordSeen: vi.fn(), recordClickthrough: vi.fn(), tokenWeights: {}, tokenAvoidWeights: {}, tokenDocFreq: {}, taste:'balanced' } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('loads an older trail waypoint on demand at its original position without appending a new trail entry', async () => {
 vi.stubGlobal('$state', <T>(value:T)=>value);
 const request = vi.fn(() => Promise.resolve(Response.json({ article: { title:'Earlier', extract:'Resolved', description:null, thumbnail:null, wikiUrl:'https://en.wikipedia.org/wiki/Earlier', lang:'en', tokens:[] } satisfies Article })));
 vi.stubGlobal('fetch', request);
 const { feed } = await import('../src/lib/feed/feedState.svelte');
 feed.trail = [{id:'old',title:'Earlier',relation:'seed',fromTitle:'',seen:true,isDetour:false}, {id:'new',title:'Later',relation:'link',fromTitle:'Earlier',seen:true,isDetour:false}];
 feed.cards = [{id:'new',article:{title:'Later',extract:'',description:null,thumbnail:null,wikiUrl:'',lang:'en',tokens:[]}, connection:{relation:'link',fromTitle:'Earlier'}}];
 expect(await feed.ensureCard('old')).toBe(true);
 expect(feed.cards.map((card)=>card.id)).toEqual(['old','new']);
 expect(feed.trail).toHaveLength(2);
 expect(await feed.ensureCard('old')).toBe(true);
 expect(request).toHaveBeenCalledTimes(1);
 expect(await feed.ensureCard('missing')).toBe(false);
});
