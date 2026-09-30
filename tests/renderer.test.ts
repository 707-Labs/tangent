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

describe('readable source actions', () => {
	const sources = (body: string) => sanitizeArticleHtml(`<ol class="references"><li id="cite_note-1">${body}</li></ol>`);

	it('polishes a visible bibliography while preserving publication text, identifiers and prose links', () => {
		// Ancient Greek architecture uses an ordinary Sources list, outside its reference apparatus.
		const out = sanitizeArticleHtml(`<h3 id="Sources">Sources</h3><ul id="bibliography" class="source-list">
<li id="fletcher"><cite id="CITEREFFletcher1996" class="citation book cs1">Fletcher, Banister (1996) [1896]. Cruickshank, Dan (ed.). <a href="https://books.google.com/books?id=Gt1jTpXAThwC"><i>Sir Banister's A History of Architecture</i></a> (20th ed.). Oxford: Architectural Press. <a href="./Special:BookSources/0-7506-2267-9">ISBN 0-7506-2267-9</a>.</cite></li>
<li id="print"><cite class="citation book cs1">Boardman, John (1967). The Art and Architecture of Ancient Greece. London: Thames and Hudson.</cite></li>
<li id="catalog"><cite class="citation book cs1"><a href="https://worldcat.org/oclc/123">Book catalog</a>.</cite></li></ul>
<p>Ordinary prose <a href="https://example.test/history">History resource</a>.</p><ul><li>Ordinary list <a href="https://example.test/list">Resource</a></li></ul>`);
		expect(out).toContain('<h4 id="Sources">Sources</h4>');
		expect(out).toContain('<ul id="bibliography" class="wh-bibliography source-list">');
		expect(out).not.toContain('<details');
		expect(out.match(/class="wh-source-visit"/g)).toHaveLength(1);
		expect(out).toContain('class="wh-source-visit" href="https://books.google.com/books?id=Gt1jTpXAThwC"');
		for (const text of ['id="fletcher"', 'id="CITEREFFletcher1996"', "Sir Banister's A History of Architecture", 'ISBN 0-7506-2267-9', 'id="print"', 'London: Thames and Hudson.', 'id="catalog"', 'Book catalog', 'Ordinary prose', 'History resource', 'Ordinary list']) expect(out).toContain(text);
	});

	it('does not duplicate source actions inside reference disclosures or modify mixed prose lists', () => {
		const out = sanitizeArticleHtml('<ol class="references"><li><cite class="citation cs1"><a href="https://publisher.test/paper">Paper</a></cite></li></ol><ul><li><cite class="citation cs1"><a href="https://publisher.test/mention">Mention</a></cite></li><li>Ordinary prose</li></ul>');
		expect(out.match(/class="wh-source-visit"/g)).toHaveLength(1);
		expect(out).not.toContain('wh-bibliography');
	});

	it('keeps citation text and makes its original URL an explicit source action', () => {
		const out = sources('<cite id="CITEREFWriter2020">Writer (2020). <a href="https://www.publisher.test/paper?id=1&amp;page=2">Original title</a>. Journal, p. 12.</cite>');
		expect(out).toContain('Writer (2020).');
		expect(out).toContain('Original title');
		expect(out).toContain('Journal, p. 12.');
		expect(out).toContain('id="CITEREFWriter2020"');
		expect(out).toContain('class="wh-source-visit" href="https://www.publisher.test/paper?id=1&amp;page=2"');
		expect(out).toContain('Visit source <span>publisher.test</span>');
		expect(out).toContain('class="wh-disclosure-show">Show');
		expect(out).toContain('class="wh-disclosure-hide">Hide');
	});

	it('skips identifier and catalog links in favor of the linked publication', () => {
		const out = sources('<cite><a href="https://worldcat.org/oclc/123">Catalog entry</a><a href="https://doi.org/10.1234/abc">10.1234/abc</a><a href="https://publisher.test/book">Book title</a></cite>');
		expect(out).toContain('class="wh-source-visit" href="https://publisher.test/book"');
		expect(out.match(/class="wh-source-visit"/g)).toHaveLength(1);
		expect(out).toContain('https://worldcat.org/oclc/123');
	});

	it('does not invent a source action for print-only or catalog-only citations', () => {
		for (const body of ['<cite>Writer. Printed book, p. 2.</cite>', '<cite><a href="https://worldcat.org/oclc/123">Book catalog</a></cite>', '<cite><a href="./Special:BookSources/123">ISBN</a></cite>']) {
			expect(sources(body)).not.toContain('wh-source-visit');
		}
	});

	it('does not promote unsafe schemes, encoded script URLs or credentialed hosts', () => {
		for (const href of ['javascript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html,hello', 'https://user:password@publisher.test/a']) {
			expect(sources(`<cite><a href="${href}">Paper title</a></cite>`)).not.toContain('wh-source-visit');
		}
	});

	it('retains distinct backlinks and replaces arrow-only labels', () => {
		const out = sources('<span class="mw-cite-backlink"><a href="./Earth#cite_ref-1-0"><span>↑</span></a> <a href="./Earth#cite_ref-1-1"><span>2</span></a></span><cite>Original reference.</cite>');
		expect(out).toContain('Earth#cite_ref-1-0">Back to text 1</a>');
		expect(out).toContain('Earth#cite_ref-1-1">Back to text 2</a>');
		expect(out).not.toContain('↑');
		expect(out).toContain('id="cite_note-1"');
	});

	it('offers a source for a manually written reference with a substantive external link', () => {
		const out = sources('An original report: <a href="https://archive.test/report">Read the report</a>.');
		expect(out).toContain('class="wh-source-visit" href="https://archive.test/report"');
		expect(out).toContain('An original report:');
	});
});
