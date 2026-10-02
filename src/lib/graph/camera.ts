import type { Camera, Viewport } from './world';

export interface Flight {
	duration: number;
	/** Camera at progress t in [0, 1]. */
	at(t: number): Camera;
}

const RHO = Math.SQRT2;

/**
 * Smooth zoom-and-pan between two cameras (van Wijk and Nuij, "Smooth and efficient zooming
 * and panning"): far destinations pull back to show where you are going, then close in. Both
 * cameras are interpreted around the viewport center, so a flight never drifts sideways.
 */
export function flight(from: Camera, to: Camera, viewport: Viewport, durationRange: [number, number] = [380, 1300]): Flight {
	const cx = viewport.width / 2;
	const cy = viewport.height / 2;
	const size = Math.max(1, viewport.width);
	// View center in world units and view width in world units.
	const ux0 = (cx - from.x) / from.k, uy0 = (cy - from.y) / from.k, w0 = size / from.k;
	const ux1 = (cx - to.x) / to.k, uy1 = (cy - to.y) / to.k, w1 = size / to.k;
	const dx = ux1 - ux0, dy = uy1 - uy0;
	const d2 = dx * dx + dy * dy;
	let path: (s: number) => [number, number, number];
	let length: number;
	if (d2 < 1e-6) {
		length = Math.abs(Math.log(w1 / w0)) / RHO;
		const direction = Math.sign(Math.log(w1 / w0));
		path = (s) => [ux0 + (s / (length || 1)) * dx, uy0 + (s / (length || 1)) * dy, w0 * Math.exp(direction * RHO * s)];
	} else {
		const d1 = Math.sqrt(d2);
		const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1);
		const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1);
		const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
		const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
		length = (r1 - r0) / RHO;
		const coshr0 = Math.cosh(r0);
		path = (s) => {
			const u = w0 / (RHO ** 2 * d1) * (coshr0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
			return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / Math.cosh(RHO * s + r0)];
		};
	}
	const duration = Math.max(durationRange[0], Math.min(durationRange[1], length * 520));
	return {
		duration,
		at(t) {
			if (t >= 1) return { ...to };
			if (t <= 0 || !Number.isFinite(length) || length === 0) return t <= 0 ? { ...from } : { ...to };
			const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
			const [ux, uy, w] = path(eased * length);
			const k = size / w;
			return { x: cx - ux * k, y: cy - uy * k, k };
		}
	};
}

/**
 * Short eased move for direct input (wheel, zoom buttons, arrow keys). It holds still the one
 * screen point both cameras agree on, so a zoom at the pointer keeps that spot under it the whole way.
 */
export function glide(from: Camera, to: Camera, duration: number): Flight {
	const scaled = Math.abs(to.k / from.k - 1) > 1e-6;
	const px = scaled ? (from.x * to.k - to.x * from.k) / (to.k - from.k) : 0;
	const py = scaled ? (from.y * to.k - to.y * from.k) / (to.k - from.k) : 0;
	return {
		duration,
		at(t) {
			if (t >= 1) return { ...to };
			if (t <= 0) return { ...from };
			const eased = 1 - (1 - t) ** 3;
			if (!scaled) return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, k: from.k };
			const k = from.k * (to.k / from.k) ** eased;
			return { x: px - (px - from.x) * k / from.k, y: py - (py - from.y) * k / from.k, k };
		}
	};
}
