/** Device-local reading positions; a small bounded store, safe when storage is disabled. */
export interface ReadingPosition { anchor: string | null; offset: number; ratio: number; updated: number; disclosures?: string[] }
/** Nearby anchors keep width-dependent reflow from accumulating across a source list. */
export function nearestReadingAnchor(candidates: { id: string; top: number }[], viewportTop: number): { anchor: string; offset: number } | null {
	const preceding = candidates.filter(candidate => candidate.top <= viewportTop + 24);
	const nearest = preceding.reduce<{ id: string; top: number } | null>((best, candidate) => !best || candidate.top > best.top ? candidate : best, null);
	return nearest ? { anchor: nearest.id, offset: viewportTop - nearest.top } : null;
}
const KEY = 'tangent:reading-positions:v1';
const LIMIT = 40;
type Positions = Record<string, ReadingPosition>;
export function readingStorage(): Storage | null {
	try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function read(storage: Pick<Storage, 'getItem'>): Positions {
	try {
		const raw: unknown = JSON.parse(storage.getItem(KEY) ?? '{}');
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
		return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, ReadingPosition] => {
			const value = entry[1] as Partial<ReadingPosition> | null;
			return !!value && (value.anchor === null || typeof value.anchor === 'string') &&
				Number.isFinite(value.offset) && Number.isFinite(value.updated) &&
				(value.disclosures === undefined || (Array.isArray(value.disclosures) && value.disclosures.length <= 64 && value.disclosures.every(key => typeof key === 'string' && /^(wh-sources|wh-bibliography|quick-facts):\d{1,4}$/.test(key)))) &&
				typeof value.ratio === 'number' && value.ratio >= 0 && value.ratio <= 1;
		}));
	} catch { return {}; }
}
export function loadReadingPosition(storage: Pick<Storage, 'getItem'> | null, title: string): ReadingPosition | null {
	if (!storage) return null;
	const positions = read(storage);
	return Object.hasOwn(positions, title) ? positions[title] : null;
}
export function saveReadingPosition(storage: Pick<Storage, 'getItem' | 'setItem'> | null, title: string, position: ReadingPosition): void {
	if (!storage) return;
	try {
		const entries = Object.entries({ ...read(storage), [title]: position }).sort((a, b) => b[1].updated - a[1].updated).slice(0, LIMIT);
		storage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
	} catch { /* Private browsing/quota must never prevent reading. */ }
}
