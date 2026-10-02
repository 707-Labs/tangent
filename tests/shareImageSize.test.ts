import { describe, expect, it } from 'vitest';
import { decodedPixels } from '../src/lib/share/imageSize';
import { gifHeader, jpegHeader, pngHeader, webpHeader } from './fixtures/imageHeaders';

describe('decodedPixels', () => {
	it('reads PNG and JPEG sizes from their headers', () => {
		expect(decodedPixels(pngHeader(960, 640))).toBe(960 * 640);
		expect(decodedPixels(jpegHeader(960, 2880))).toBe(960 * 2880);
	});

	it('reads lossy, lossless and extended WebP sizes', () => {
		expect(decodedPixels(webpHeader('VP8 ', 960, 640))).toBe(960 * 640);
		expect(decodedPixels(webpHeader('VP8L', 900, 1200))).toBe(900 * 1200);
		expect(decodedPixels(webpHeader('VP8X', 16000, 9000))).toBe(16000 * 9000);
	});

	it("counts a GIF's first frame when it is larger than the canvas", () => {
		expect(decodedPixels(gifHeader([500, 400]))).toBe(500 * 400);
		expect(decodedPixels(gifHeader([100, 100], [8000, 8000]))).toBe(8000 * 8000);
	});

	it('gives up on truncated, zero-sized and unknown files', () => {
		expect(decodedPixels(pngHeader(960, 640).subarray(0, 20))).toBeNull();
		expect(decodedPixels(jpegHeader(960, 640).subarray(0, 30))).toBeNull();
		expect(decodedPixels(pngHeader(0, 640))).toBeNull();
		expect(decodedPixels(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
		expect(decodedPixels(new Uint8Array())).toBeNull();
	});
});
