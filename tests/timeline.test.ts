import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reflowGraphicalTimelines } from '../src/lib/wikipedia/timeline';
import { sanitizeArticleHtml, isSafeUrl } from '../src/lib/wikipedia/article';
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/timeline/${name}.html`, import.meta.url), 'utf8');
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
describe('graphical timeline natural flow', () => {
	it('retains the Nature timeline’s dense events, every link, and every named band', () => {
		const source = fixture('nature'), out = reflowGraphicalTimelines(source);
		expect(out).toContain('class="wh-tl-groups"');
		expect(out).toContain('0–1 billion years ago');
		expect(out).toContain('13 billion years ago and earlier');
		expect(out).not.toContain('13.8');
		expect(out).not.toMatch(/style=|wh-tl-track|wh-tl-lab/);
		for (const href of hrefs(source))
			expect(hrefs(out)).toContain(href);
		expect(out).toContain('<a href="./Ape">Earliest apes</a> / <a href="./Human">humans</a>');
		expect(out.indexOf('Earliest apes')).toBeLessThan(out.indexOf('Earliest mammals'));
		expect(out).toContain('Time periods');
		expect(out).toContain('Period begins');
	});
	it('normalizes signed Life source ticks to honest million-year age bands', () => {
		const source = fixture('life'), out = reflowGraphicalTimelines(source);
		expect(out).toContain('0–500 million years ago');
		expect(out).toContain('4,500 million years ago and earlier');
		expect(out).not.toContain('billion years ago');
		for (const href of hrefs(source))
			expect(hrefs(out)).toContain(href);
		expect(out).toContain('Source span:');
	});
	it('preserves Human annotations, including labels outside presentation tables', () => {
		const source = fixture('human'), out = reflowGraphicalTimelines(source);
		expect(out).toContain('million years ago');
		expect(out).not.toContain('billion years ago');
		for (const href of hrefs(source))
			expect(hrefs(out)).toContain(href);
		expect(out).toContain('H o m i n i d s');
		expect(out).toContain('P a r a n t h r o p u s');
		expect(out.split('<details class="wh-tl-periods">')[0]).not.toContain('H o m i n i d s');
		expect(out.split('<details class="wh-tl-periods">')[0]).not.toContain('P a r a n t h r o p u s');
		expect(out).toContain('Range not specified in the source label.');
	});
	it('keeps annotation bars with explicit heights as periods, never point milestones', () => {
		const source = fixture('human').replace('margin-top:21.000em;', 'margin-top:21.000em;height:5em;');
		const out = reflowGraphicalTimelines(source);
		const [milestones, periods] = out.split('<details class="wh-tl-periods">');
		expect(milestones).not.toContain('H o m i n i d s');
		expect(periods).toMatch(/H o m i n i d s<\/a><\/span><span class="wh-tl-period-range">Source span:/);
	});
	it('leaves unknown units, contradictory ticks, missing positions and broken tables untouched', () => {
		const source = fixture('nature');
		for (const bad of [source.replace('billion years ago', 'unknown years'), source.replace('billion years ago', 'billion years ago / million years ago'), source.replace('<span>−</span>13', '<span>+</span>13'), source.replace('top:0.329em', 'top:garbage'), source.replace(/<\/table>\s*$/, '')])
			expect(reflowGraphicalTimelines(bad)).toBe(bad);
	});
	it('supports pixel coordinates without inferring time from their magnitudes', () => {
		const source = fixture('nature').replace(/(top|height):([\d.-]+)em/g, '$1:$2px');
		const out = reflowGraphicalTimelines(source);
		expect(out).toContain('0–1 billion years ago');
		expect(out).toContain('13 billion years ago and earlier');
		expect(out).not.toContain('0.329 billion');
		expect(out).toContain('href="./Human"');
	});
	it('preserves named text entities without decoding escaped markup or double-encoded text', () => {
		const source = fixture('nature').replace('Earliest apes', 'Apes &ndash; humans &alpha; &eacute; &amp;ndash; &lt;img&gt;');
		const out = reflowGraphicalTimelines(source);
		expect(out).toContain('Apes &ndash; humans &alpha; &eacute; &amp;ndash; &lt;img&gt;');
		expect(out).not.toContain('<img>');
		const sanitized = sanitizeArticleHtml(source);
		expect(sanitized).toContain('&ndash; humans &alpha; &eacute; &amp;ndash;');
		expect(sanitized).not.toContain('<img>');
	});
	it('preserves named href entities and escaped quotes through the sanitizer', () => {
		const source = fixture('nature').replace('href="./Ape"', 'href="./Caf&eacute;?name=&quot;caf&eacute;&quot;&amp;literal=&amp;eacute;"');
		const out = reflowGraphicalTimelines(source);
		expect(out).toContain('href="./Caf&eacute;?name=&quot;caf&eacute;&quot;&amp;literal=&amp;eacute;"');
		expect(out).not.toContain('./Caf&amp;eacute;');
		const sanitized = sanitizeArticleHtml(source);
		expect(sanitized).toContain('href="https://en.wikipedia.org/wiki/Caf&eacute;?name=&quot;caf&eacute;&quot;&amp;literal=&amp;eacute;"');
		const unsafe = fixture('nature').replace('href="./Ape"', 'href="javascript&colon;alert(1)"');
		// Node has no HTMLRewriter; validate the exact URL against its production allowlist.
		expect(isSafeUrl(hrefs(reflowGraphicalTimelines(unsafe)).find(href => href.startsWith('javascript'))!)).toBe(false);
	});
	it('does not throw on invalid numeric entities or revive escaped markup', () => {
		const source = fixture('nature').replace('Earliest apes', '&#999999999; &lt;script&gt;');
		const out = reflowGraphicalTimelines(source);
		expect(out).toContain('� &lt;script&gt;');
		expect(out).not.toContain('<script>');
	});
	it('escapes decoded labels and hrefs without bypassing the authoritative sanitizer', () => {
		const source = fixture('nature').replace('href="./Ape"', 'href="javascript:alert(1)" onclick="alert(1)"').replace('Earliest apes', '&lt;img src=x onerror=alert(1)&gt; &amp; apes');
		const reflowed = reflowGraphicalTimelines(source);
		expect(reflowed).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; apes');
		expect(reflowed).not.toContain('onclick=');
		const out = sanitizeArticleHtml(source);
		expect(out).not.toContain('href="javascript:');
		expect(out).not.toContain('<img src=x');
		expect(out).toContain('https://en.wikipedia.org/wiki/Human');
	});
	it('reflows independent timelines without consuming surrounding article content', () => {
		const out = reflowGraphicalTimelines(`<p>Before</p>${fixture('nature')}<p>Between</p>${fixture('life')}<p>After</p>`);
		expect(out.match(/class="wh-tl"/g)).toHaveLength(2);
		expect(out).toContain('<p>Before</p>');
		expect(out).toContain('<p>Between</p>');
		expect(out).toContain('<p>After</p>');
	});
});
