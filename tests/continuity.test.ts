import { describe, expect, it } from 'vitest';
import { loadRecent, rememberTangent, validTrail, locationFromUrl, locationUrl, validateLocation, recentForLocation } from '../src/lib/feed/continuity';
const node = { id: '1', title: 'Coffee', relation: 'seed' as const, fromTitle: '', isDetour: false, seen: true };
function memory(): Storage {
 const data = new Map<string, string>();
 return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => {data.delete(key);}, clear: () => data.clear(), key: (index) => [...data.keys()][index] ?? null, get length() { return data.size; } };
}
describe('tangent continuity', () => {
 it('round trips reader and waypoint URLs without dropping seed or other query fields', () => {
 const url = locationUrl(new URL('https://tangent.page/?seed=Coffee&other=keep'), { reader:'Tea & coffee', card:'a/b', scrollY:200 });
 expect(locationFromUrl(url)).toEqual({ reader:'Tea & coffee', card:'a/b', scrollY:0 });
 expect(url.searchParams.get('other')).toBe('keep');
 expect(locationUrl(url, {reader:null,card:null,scrollY:0}).searchParams.has('reader')).toBe(false);
 });
 it('preserves a remounted history snapshot including its within-card offset', () => {
 const history = { reader:'Coffee', card:'Coffee#7', scrollY:3200, offset:275 };
 expect(validateLocation(history) ?? locationFromUrl(new URL('https://tangent.page/?reader=Coffee&card=Coffee%237'))).toEqual(history);
 expect(validateLocation({ ...history, offset:-40 })).toEqual({...history,offset:-40});
 });
 it('rejects malformed history before URL/session fallback', () => {
 for (const invalid of [undefined, {}, {reader:null,card:null,scrollY:NaN}, {reader:null,card:null,scrollY:-1}, {reader:null,card:'x'.repeat(201),scrollY:0}, {reader:null,card:null,scrollY:0,offset:Infinity}]) expect(validateLocation(invalid)).toBeNull();
 expect(validateLocation({reader:null,card:null,scrollY:0})).toEqual({reader:null,card:null,scrollY:0});
 });
 it('restores the old seed chain for Back while leaving a fresh seed start fresh', () => {
 const recent = [{seedTitle:'Coffee', trail:[node, {...node,id:'old-tea',title:'Tea'}], updated:1}, {seedTitle:'Physics',trail:[{...node,id:'physics'}],updated:2}];
 expect(recentForLocation(recent, 'Coffee', 'old-tea', false)).toEqual(recent[0]);
 expect(recentForLocation(recent, 'Coffee', null, false)).toBeNull();
 expect(recentForLocation(recent, 'Coffee', 'unrelated-id', false)).toBeNull();
 expect(recentForLocation(recent, 'Physics', 'old-tea', false)).toBeNull();
 expect(recentForLocation(recent, 'Coffee', null, true)).toEqual(recent[0]);
 });
 it('keeps six recent tangents and updates matching seeds rather than duplicating', () => {
 const storage = memory();
 for(let i=0;i<9;i++) rememberTangent(String(i), [node], storage);
 expect(loadRecent(storage)).toHaveLength(6);
 rememberTangent('8', [{...node,title:'Tea'}], storage);
 expect(loadRecent(storage)[0].trail[0].title).toBe('Tea');
 expect(loadRecent(storage)).toHaveLength(6);
 });
 it('rejects malformed or oversized stored navigation and survives unavailable storage', () => {
 expect(validTrail([{...node,relation:'broken'}])).toBeNull();
 expect(validTrail(Array(301).fill(node))).toBeNull();
 const storage=memory(); storage.setItem('tangent-recent-v1','{broken'); expect(loadRecent(storage)).toEqual([]);
 expect(locationFromUrl(new URL('https://tangent.page/?reader='+ 'x'.repeat(501))).reader).toBeNull();
 });
});
