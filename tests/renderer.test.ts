import { describe, expect, it } from 'vitest';
import { sanitizeArticleHtml } from '../src/lib/wikipedia/article';
import { localArticleAnchor } from '../src/lib/reader/anchors';

describe('article renderer content preservation', () => {
	it('keeps native media sources, subtitles and normalized posters without autoplay', () => {
		const out = sanitizeArticleHtml(`<div class="listen noprint"><audio autoplay preload="auto"><source src="//upload.wikimedia.org/a.mp3" type="audio/mpeg"/></audio></div>
<figure><video poster="//thumb.wikimedia.org/a.jpg" autoplay="autoplay"><source src="//upload.wikimedia.org/a.webm"/><track src="https://commons.wikimedia.org/subtitles.vtt" kind="subtitles" srclang="en"/></video><figcaption>Original caption</figcaption></figure>`);
		expect(out).not.toContain('autoplay');
		expect(out.match(/controls preload="none"/g)).toHaveLength(2);
		expect(out).toContain('poster="https://thumb.wikimedia.org/a.jpg"');
		expect(out).toContain('src="https://upload.wikimedia.org/a.mp3"');
		expect(out).toContain('<track');
		expect(out).toContain('Original caption');
	});

	it('retains MathML semantics, chemical formula images and baseline dimensions', () => {
		const out = sanitizeArticleHtml('<span class="mwe-math-element"><span class="mwe-math-mathml-a11y" style="display: none;"><math><semantics><mrow><mi>H</mi><msub><mi>O</mi><mn>2</mn></msub></mrow><annotation encoding="application/x-tex">H O_2</annotation></semantics></math></span><img class="mwe-math-fallback-image-inline" src="https://wikimedia.org/api/rest_v1/media/math/render/svg/abc" alt="H O_2" style="width:5ex;height:2ex;vertical-align:-0.3ex"/></span>');
		expect(out).toContain('<math>');
		expect(out).toContain('<annotation encoding="application/x-tex">H O_2');
		expect(out).toContain('vertical-align:-0.3ex');
	});

	it('preserves image maps and regions while marking the image for scrolling', () => {
		const out = sanitizeArticleHtml('<img src="//upload.wikimedia.org/solar.png" usemap="#SolarSystem" width="700" height="40"/><map name="SolarSystem"><area href="./Earth" shape="circle" coords="195,18,8" alt="Earth"/></map>');
		expect(out).toContain('<span class="wh-imagemap"><img');
		expect(out).toContain('usemap="#SolarSystem"');
		expect(out).toContain('name="SolarSystem"');
		expect(out).toContain('coords="195,18,8"');
		expect(out).toContain('href="https://en.wikipedia.org/wiki/Earth"');
	});

	it('wraps the outer reference container once and retains note ids and backlinks', () => {
		const out = sanitizeArticleHtml('<div class="reflist"><div class="mw-references-wrap"><ol class="references"><li id="cite_note-1"><a href="./Earth#cite_ref-1">Back</a><cite>Original source</cite></li></ol></div></div>');
		expect(out.match(/class="wh-sources"/g)).toHaveLength(1);
		expect(out).toContain('id="cite_note-1"');
		expect(out).toContain('Earth#cite_ref-1');
		expect(out).toContain('Original source');
	});

	it('does not collapse bibliography classes that only start with references', () => {
		const out = sanitizeArticleHtml('<div class="refbegin references-column-width"><ul><li>Bibliography</li></ul></div>');
		expect(out).not.toContain('wh-sources');
		expect(out).toContain('Bibliography');
	});

	it('keeps table spans, captions, nested lists, code and SVG geometry', () => {
		const out = sanitizeArticleHtml('<table class="wikitable"><caption>Data</caption><tr><th rowspan="2">Label</th><td colspan="2">Value</td></tr></table><dl><dt>Term</dt><dd><ol><li>One<ul><li>Nested</li></ul></li></ol></dd></dl><pre><code>a &lt; b</code></pre><svg viewBox="0 0 50 50"><path d="M0 0 L50 50"/></svg>');
		for (const value of ['<caption>Data', 'rowspan="2"', 'colspan="2"', '<dt>Term', '<li>Nested', 'a &lt; b', 'viewBox="0 0 50 50"', 'd="M0 0 L50 50"']) expect(out).toContain(value);
	});
});

describe('same-article anchor routing', () => {
	it('recognizes full Parsoid footnote links without diving again', () => {
		expect(localArticleAnchor('https://en.wikipedia.org/wiki/Quantum_mechanics#cite_note-1', 'Quantum mechanics')).toBe('#cite_note-1');
		expect(localArticleAnchor('#History', 'Earth')).toBe('#History');
	});
	it('keeps other articles and external fragments out of local navigation', () => {
		expect(localArticleAnchor('https://en.wikipedia.org/wiki/Sun#History', 'Earth')).toBeNull();
		expect(localArticleAnchor('https://example.org/wiki/Earth#History', 'Earth')).toBeNull();
		expect(localArticleAnchor('https://en.wikipedia.org/wiki/Earth', 'Earth')).toBeNull();
	});
});
