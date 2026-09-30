/** Reflow the graphical timeline family using source tick bands, never interpolated dates.
 * The source coordinates may be nonlinear. Coordinates establish order and band membership
 * only; the caption establishes units. Unsupported or incomplete scales remain untouched.
 * Output is still passed through the article sanitizer, which owns URL/security policy.
 */
interface Element {
	attrs: string;
	inner: string;
	end: number;
}
interface Tick {
	position: number;
	value: number;
}
interface Label {
	position: number;
	html: string;
	onset?: boolean;
}
interface Period extends Label {
	endPosition: number;
	nested: boolean;
}
interface Scale {
	ticks: Tick[];
	coordinateUnit: string;
	ageUnit: string;
}
export function reflowGraphicalTimelines(html: string): string {
	const opening = /<table\b[^>]*\bid=["']Container["'][^>]*>/gi;
	const output: string[] = [];
	let cursor = 0;
	for (let match = opening.exec(html); match; match = opening.exec(html)) {
		const element = readElement(html, match.index, 'table');
		if (!element)
			continue;
		const rendered = render(html.slice(match.index, element.end));
		if (!rendered) {
			opening.lastIndex = element.end;
			continue;
		}
		output.push(html.slice(cursor, match.index), rendered);
		cursor = element.end;
		opening.lastIndex = element.end;
	}
	output.push(html.slice(cursor));
	return output.join('');
}
function render(block: string): string | null {
	const scaleElement = byId(block, 'Scale');
	const timeline = byId(block, 'Timeline');
	const annotations = byId(block, 'Annotations');
	const caption = byId(block, 'Caption');
	if (!scaleElement || !timeline || !annotations || !caption)
		return null;
	const scale = parseScale(scaleElement.inner, caption.inner);
	if (!scale)
		return null;
	const periods: Period[] = [];
	for (const element of children(timeline.inner)) {
		const position = coordinate(element.attrs, 'top', scale.coordinateUnit);
		const height = coordinate(element.attrs, 'height', scale.coordinateUnit);
		const label = inline(element.inner);
		if (!visible(label))
			continue;
		if (position === null || height === null || height < 0)
			return null;
		const left = coordinate(element.attrs, 'left', 'em');
		if (left === null)
			return null;
		periods.push({ position, endPosition: position + height, html: label, nested: left >= 0.5 });
	}
	const labels: Label[] = [];
	const periodLabels: string[] = [];
	for (const element of children(annotations.inner)) {
		const label = inline(element.inner).replace(/^[\s←]+/, '').trim();
		if (!visible(label))
			continue;
		// annot-bar contains a duration label; margin-top positions its lettering,
		// not a dated milestone or either end of the corresponding colored band.
		if (/\bclass=["'][^"']*\bannot-bar\b/.test(element.attrs)) {
			const start = coordinate(element.attrs, 'top', scale.coordinateUnit)
				?? coordinate(element.attrs, 'margin-top', scale.coordinateUnit);
			const height = coordinate(element.attrs, 'height', scale.coordinateUnit);
			if (height !== null) {
				if (start === null || height < 0) return null;
				periods.push({ position: start, endPosition: start + height, html: label, nested: false });
			} else {
				periodLabels.push(label);
			}
			continue;
		}
		const position = coordinate(element.attrs, 'top', scale.coordinateUnit)
			?? coordinate(element.attrs, 'margin-top', scale.coordinateUnit);
		if (position === null)
			return null;
		labels.push({ position, html: label });
	}
	if (!labels.length)
		return null;
	for (const period of periods.filter(p => p.nested))
		labels.push({ position: period.endPosition, html: period.html, onset: true });
	labels.sort((a, b) => a.position - b.position);
	const title = inline(byId(block, 'Title')?.inner ?? '') || 'Timeline';
	const groups = new Map<number, Label[]>();
	for (const label of labels) {
		const index = bandIndex(label.position, scale.ticks);
		const group = groups.get(index) ?? [];
		group.push(label);
		groups.set(index, group);
	}
	const output = ['<div class="wh-tl"><div class="wh-tl-header">',
		`<h3 class="wh-tl-title">${title}</h3>`,
		`<p class="wh-tl-description">Recent to ancient, grouped by age. Spacing is not to scale. Scale: ${inline(caption.inner)}.</p></div><div class="wh-tl-groups">`];
	for (const [index, group] of groups) {
		output.push(`<section class="wh-tl-group"><h4 class="wh-tl-range">${escape(bandLabel(index, scale))}</h4><ol class="wh-tl-events">`);
		for (const label of group)
			output.push(`<li class="wh-tl-event${label.onset ? ' wh-tl-onset' : ''}">${label.onset ? '<span class="wh-tl-kind">Period begins</span>' : ''}<span class="wh-tl-event-label">${label.html}</span></li>`);
		output.push('</ol></section>');
	}
	output.push('</div>');
	if (periods.length || periodLabels.length) {
		output.push('<details class="wh-tl-periods"><summary>Time periods</summary><ul class="wh-tl-period-list">');
		for (const period of periods.sort((a, b) => a.position - b.position)) {
			const first = bandIndex(period.position, scale.ticks), last = bandIndex(period.endPosition, scale.ticks);
			const range = first === last ? bandLabel(first, scale) : `${bandLabel(first, scale)} through ${bandLabel(last, scale)}`;
			output.push(`<li><span class="wh-tl-event-label">${period.html}</span><span class="wh-tl-period-range">Source span: ${escape(range)}</span></li>`);
		}
		for (const label of periodLabels)
			output.push(`<li><span class="wh-tl-event-label">${label}</span><span class="wh-tl-period-range">Range not specified in the source label.</span></li>`);
		output.push('</ul></details>');
	}
	output.push('</div>');
	return output.join('');
}
function parseScale(html: string, caption: string): Scale | null {
	const units = [...visible(caption).matchAll(/\b(billion|million|thousand)\s+years\s+ago\b/gi)].map(match => match[1].toLowerCase());
	if (!units.length || new Set(units).size !== 1)
		return null;
	const ticks: Tick[] = [];
	let coordinateUnit = '';
	for (const element of children(html)) {
		const label = visible(element.inner).replace(/\s/g, '');
		const value = /^([−+-]?\d+(?:\.\d+)?)—$/.exec(label);
		if (!value)
			continue;
		const coord = /(?:^|[;\s"'])top:\s*(-?\d+(?:\.\d+)?)(em|px)(?:;|["'])/i.exec(element.attrs);
		if (!coord || (coordinateUnit && coordinateUnit !== coord[2]))
			return null;
		coordinateUnit = coord[2];
		ticks.push({ position: Number(coord[1]), value: Number(value[1].replace('−', '-')) });
	}
	ticks.sort((a, b) => a.position - b.position);
	if (ticks.length < 2 || ticks.some(t => t.value > 0))
		return null;
	for (let i = 1; i < ticks.length; i++)
		if (ticks[i].position <= ticks[i - 1].position || ticks[i].value >= ticks[i - 1].value)
			return null;
	return { ticks, coordinateUnit, ageUnit: `${units[0]} years ago` };
}
function bandIndex(position: number, ticks: Tick[]): number {
	if (position < ticks[0].position)
		return -1;
	for (let i = 0; i < ticks.length - 1; i++)
		if (position < ticks[i + 1].position)
			return i;
	return ticks.length - 1;
}
function bandLabel(index: number, scale: Scale): string {
	const { ticks, ageUnit } = scale;
	const format = (value: number): string => Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 10 });
	if (index < 0)
		return `More recent than ${format(ticks[0].value)} ${ageUnit}`;
	if (index === ticks.length - 1)
		return `${format(ticks[index].value)} ${ageUnit} and earlier`;
	return `${format(ticks[index].value)}–${format(ticks[index + 1].value)} ${ageUnit}`;
}
function coordinate(attrs: string, key: string, unit: string): number | null {
	const match = new RegExp(`(?:^|[;\\s"'])${key}:\\s*(-?\\d+(?:\\.\\d+)?)${unit}(?:;|["'])`, 'i').exec(attrs);
	return match ? Number(match[1]) : null;
}
function byId(html: string, id: string): Element | null {
	const match = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i').exec(html);
	return match ? readElement(html, match.index, match[1]) : null;
}
function readElement(html: string, start: number, tag: string): Element | null {
	const openEnd = html.indexOf('>', start);
	if (openEnd < 0)
		return null;
	const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
	pattern.lastIndex = start;
	let depth = 0;
	for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
		depth += match[1] ? -1 : 1;
		if (depth === 0)
			return { attrs: html.slice(start, openEnd + 1), inner: html.slice(openEnd + 1, match.index), end: pattern.lastIndex };
	}
	return null;
}
function children(html: string): Element[] {
	const elements: Element[] = [];
	const pattern = /<([a-z][\w-]*)\b[^>]*>/gi;
	for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
		if (['link', 'br', 'img', 'hr', 'meta', 'input', 'source'].includes(match[1].toLowerCase()))
			continue;
		const element = readElement(html, match.index, match[1]);
		if (!element)
			continue;
		elements.push(element);
		pattern.lastIndex = element.end;
	}
	return elements;
}
/** Retain every visible text run and anchor, flattening the fixed-position wrappers.
 * Decode then escape text and attributes; downstream sanitizer validates href protocols.
 */
function inline(html: string): string {
	html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
	return html.replace(/<[^>]+>|[^<]+/g, token => {
		if (!token.startsWith('<'))
			return escapeText(token);
		if (/^<\/a\s*>$/i.test(token))
			return '</a>';
		if (/^<a\b/i.test(token)) {
			const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(token);
			return `<a${href ? ` href="${escapeText(href[1] ?? href[2])}"` : ''}>`;
		}
		if (/^<br\b/i.test(token))
			return ' ';
		return '';
	}).trim();
}
/** Preserve named text entities the browser knows without decoding them into markup.
 * Splitting before decoding also preserves literal double-encoded entity text.
 */
function escapeText(value: string): string {
	return value.split(/(&[a-z][a-z0-9]*;)/gi).map(part => {
		const decoded = decode(part);
		return /^&[a-z][a-z0-9]*;$/i.test(part) && decoded === part ? part : escape(decoded);
	}).join('');
}
function visible(html: string): string { return decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
function decode(s: string): string {
	return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
		const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
		const key = entity.slice(1, -1).toLowerCase();
		if (names[key])
			return names[key];
		const number = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
		return number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '�';
	});
}
function escape(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
