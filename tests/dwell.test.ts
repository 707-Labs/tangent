import { describe, expect, it } from 'vitest';
import { DwellTracker } from '../src/lib/engagement/dwell';

const visible = { inView: true, pageVisible: true, pending: false, interacted: false };

describe('foreground card dwell', () => {
	it('excludes hidden-tab time and does not interpret hiding as a skip', () => {
		const tracker = new DwellTracker(350, 1400);
		tracker.update(visible, 0);
		expect(tracker.update({ ...visible, pageVisible: false }, 700)).toEqual({
			dwellMs: 700, skipped: false
		});
		tracker.update(visible, 60_000);
		expect(tracker.update({ ...visible, inView: false }, 60_500)).toEqual({
			dwellMs: 500, skipped: true
		});
	});

	it('emits one skip across repeat observers and revisits', () => {
		const tracker = new DwellTracker(350, 1400);
		tracker.update(visible, 100);
		expect(tracker.update({ ...visible, inView: false }, 600).skipped).toBe(true);
		expect(tracker.update({ ...visible, inView: false }, 650).skipped).toBe(false);
		tracker.update(visible, 700);
		expect(tracker.update({ ...visible, inView: false }, 1200).skipped).toBe(false);
	});

	it('retains reading split across foreground intervals', () => {
		const tracker = new DwellTracker(350, 1400);
		tracker.update(visible, 0);
		const first = tracker.update({ ...visible, pageVisible: false }, 2000);
		tracker.update(visible, 10_000);
		const second = tracker.update({ ...visible, inView: false }, 12_000);
		expect(first.dwellMs + second.dwellMs).toBe(4000);
		expect(first.skipped || second.skipped).toBe(false);
	});

	it('preserves long-read and explicit engagement signals without a skip', () => {
		for (const [duration, interacted] of [[4000, false], [700, true]] as const) {
			const tracker = new DwellTracker(350, 1400);
			tracker.update(visible, 100);
			expect(tracker.update({ ...visible, inView: false, interacted }, 100 + duration)).toEqual({
				dwellMs: duration, skipped: false
			});
		}
	});

	it('does not accrue pending or initially hidden cards', () => {
		const tracker = new DwellTracker(350, 1400);
		tracker.update({ ...visible, pending: true }, 0);
		tracker.update({ ...visible, pageVisible: false }, 1000);
		expect(tracker.update({ ...visible, inView: false }, 2000)).toEqual({
			dwellMs: 0, skipped: false
		});
	});

	it('flushes real reading time on cleanup without manufacturing a skip', () => {
		const tracker = new DwellTracker(350, 1400);
		tracker.update(visible, 100);
		expect(tracker.finish(800)).toBe(700);
		expect(tracker.finish(900)).toBe(0);
		expect(tracker.update({ ...visible, inView: false }, 1000).skipped).toBe(false);
	});
});
