import { describe, expect, it } from 'vitest';
import { flight, glide } from '../src/lib/graph/camera';
import { zoomCamera } from '../src/lib/graph/world';

const viewport = { width: 1200, height: 800 };
/** World point at the middle of the viewport. */
const middle = (camera: { x: number; y: number; k: number }) => ({ x: (600 - camera.x) / camera.k, y: (400 - camera.y) / camera.k });

describe('map camera flights', () => {
	it('starts and ends exactly at the given cameras', () => {
		const from = { x: 100, y: -40, k: 0.14 }, to = { x: -900, y: 300, k: 0.75 };
		const path = flight(from, to, viewport);
		expect(path.at(0)).toEqual(from);
		expect(path.at(1)).toEqual(to);
		expect(path.at(1.4)).toEqual(to);
	});

	it('pulls back on long trips so the destination comes into view, then closes in', () => {
		const from = { x: 600 - 2000 * 0.75, y: 400, k: 0.75 }, to = { x: 600 + 2000 * 0.75, y: 400, k: 0.75 };
		const path = flight(from, to, viewport);
		expect(path.at(0.5).k).toBeLessThan(0.3);
		const halfway = middle(path.at(0.5));
		expect(halfway.x).toBeCloseTo(0, 0);
		expect(halfway.y).toBeCloseTo(0, 5);
		expect(path.duration).toBeGreaterThan(380);
		expect(path.duration).toBeLessThanOrEqual(1300);
	});

	it('zooms in place when only the zoom changes, and keeps short trips quick', () => {
		const from = { x: 600, y: 400, k: 0.2 };
		const to = { x: 600, y: 400, k: 0.8 };
		const path = flight(from, to, viewport);
		for (const t of [0.25, 0.5, 0.75]) {
			expect(middle(path.at(t)).x).toBeCloseTo(0, 6);
			expect(path.at(t).k).toBeGreaterThan(0.2);
			expect(path.at(t).k).toBeLessThan(0.8);
		}
		expect(flight(from, { ...from, x: 610 }, viewport).duration).toBe(380);
	});

	it('glides a zoom about the pointer without the pointed-at spot drifting', () => {
		const from = { x: 230, y: -180, k: 0.4 };
		const pointer = { x: 97, y: 510 };
		const spot = { x: (pointer.x - from.x) / from.k, y: (pointer.y - from.y) / from.k };
		const to = zoomCamera(from, 1.25 ** 2, pointer);
		const path = glide(from, to, 220);
		for (const t of [0, 0.1, 0.5, 0.9, 1]) {
			const camera = path.at(t);
			expect(spot.x * camera.k + camera.x).toBeCloseTo(pointer.x, 6);
			expect(spot.y * camera.k + camera.y).toBeCloseTo(pointer.y, 6);
		}
		expect(path.at(1)).toEqual(to);
		const pan = glide(from, { ...from, x: from.x + 120 }, 180);
		expect(pan.at(0.5).k).toBe(from.k);
		expect(pan.at(0.5).x).toBeGreaterThan(from.x + 60);
	});
});
