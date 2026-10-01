export interface ContentsEntry { id: string; label: string; level: number }
/** Keep Wikipedia's real anchors; create collision-free fallbacks only when missing. */
export function headingAnchor(label: string, used: Set<string>): string {
	const base = `reader-${label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'}`;
	let id = base;
	for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
	used.add(id);
	return id;
}
export function sourceDestination(href: string): { href: string; domain: string } | null {
	try {
		const url = new URL(href);
		if (!['https:', 'http:'].includes(url.protocol)) return null;
		return { href: url.href, domain: url.hostname.replace(/^www\./, '') };
	} catch { return null; }
}
export function citationNoteId(fragment: string): string | null {
	try { const id = decodeURIComponent(fragment.replace(/^#/, '')); return id.startsWith('cite_note-') ? id : null; }
	catch { return null; }
}
