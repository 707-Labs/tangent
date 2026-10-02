/**
 * Stable map labels. Each label gets a zoom interval in which it may show, computed once from
 * world positions and screen-pixel sizes. Panning cannot change which labels show, and zooming
 * in never trades one label for another: a label appears at a fixed zoom and stays.
 */

/** A label anchored to a world point. Sizes and offsets are screen pixels; zoom bounds are camera k. */
export interface LabelSpec {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Offset from the anchor to the center of the label box. */
	offsetX?: number;
	offsetY?: number;
	/** Zoom from which this label may show. */
	min: number;
	/** Zoom at which this label stops showing (region names give way to articles). */
	max?: number;
	/** Shows across [min, max) whatever it collides with; later labels make way for it. */
	fixed?: boolean;
}

/** Zooms from start (inclusive) to end (exclusive); empty when start >= end. */
export interface LabelInterval { start: number; end: number }

export interface ScreenBox { x: number; y: number; width: number; height: number }

const PAD_X = 6;
const PAD_Y = 3;
/** A label fades over this zoom ratio at each end of its interval. */
export const LABEL_FADE = 1.12;

/** Zooms k >= 0 at which |delta * k + offset| < reach. */
function axisConflict(delta: number, offset: number, reach: number): LabelInterval {
	if (delta === 0) return Math.abs(offset) < reach ? { start: 0, end: Infinity } : { start: 0, end: 0 };
	const a = (-reach - offset) / delta;
	const b = (reach - offset) / delta;
	return { start: Math.max(0, Math.min(a, b)), end: Math.max(0, a, b) };
}

/** The zooms at which two label boxes overlap. Panning moves both boxes together, so only zoom matters. */
export function conflictRange(a: LabelSpec, b: LabelSpec): LabelInterval {
	const x = axisConflict(a.x - b.x, (a.offsetX ?? 0) - (b.offsetX ?? 0), (a.width + b.width) / 2 + PAD_X);
	const y = axisConflict(a.y - b.y, (a.offsetY ?? 0) - (b.offsetY ?? 0), (a.height + b.height) / 2 + PAD_Y);
	return { start: Math.max(x.start, y.start), end: Math.min(x.end, y.end) };
}

/**
 * Labels must be ordered by importance. A label's interval starts only after every collision
 * with a more important visible label is over, so the visible set at any zoom is collision-free
 * and a less important label can never displace a more important one. Labels that could only
 * start beyond maxZoom never show.
 */
export function labelIntervals(labels: readonly LabelSpec[], maxZoom = Infinity): LabelInterval[] {
	const placed: LabelInterval[] = [];
	for (let i = 0; i < labels.length; i++) {
		const label = labels[i];
		const end = label.max ?? Infinity;
		let start = label.min;
		for (let j = 0; j < i && !label.fixed && start < end && start <= maxZoom; j++) {
			const other = placed[j];
			if (other.start >= other.end) continue;
			const conflict = conflictRange(label, labels[j]);
			const from = Math.max(conflict.start, other.start);
			const to = Math.min(conflict.end, other.end);
			if (from < to && from < end && to > start) start = to;
		}
		placed.push(start <= maxZoom ? { start, end } : { start: Infinity, end: Infinity });
	}
	return placed;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Opacity from zoom alone: fades in after the interval starts and out before it ends. */
export function intervalAlpha(interval: LabelInterval, k: number): number {
	if (interval.start >= interval.end || k < interval.start || k >= interval.end) return 0;
	const fadeIn = interval.start <= 0 ? 1 : smoothstep(interval.start, interval.start * LABEL_FADE, k);
	const fadeOut = Number.isFinite(interval.end) ? 1 - smoothstep(interval.end / LABEL_FADE, interval.end, k) : 1;
	return fadeIn * fadeOut;
}

export function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
	return a.x < b.x + b.width + PAD_X && b.x < a.x + a.width + PAD_X &&
		a.y < b.y + b.height + PAD_Y && b.y < a.y + a.height + PAD_Y;
}

/** Ease a displayed opacity toward its target; time-based so frame rate does not change the fade. */
export function approach(current: number, target: number, elapsedMs: number, durationMs = 140): number {
	if (elapsedMs <= 0) return current;
	const next = current + (target - current) * (1 - Math.exp(-elapsedMs / (durationMs / 3)));
	return Math.abs(next - target) < 0.01 ? target : next;
}
