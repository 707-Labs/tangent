/**
 * Decoded sizes read from image headers, so a card can refuse a file before Takumi
 * allocates memory for it. Covers the formats cards accept: PNG, JPEG, GIF and WebP.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Pixels in the largest buffer decoding these bytes allocates (for a GIF, the larger of
 * its canvas and first frame), or null when the header is missing, truncated or zero-sized.
 */
export function decodedPixels(bytes: Uint8Array): number | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	try {
		if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte) && ascii(bytes, 12, 4) === 'IHDR') {
			return area(view.getUint32(16), view.getUint32(20));
		}
		if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegPixels(bytes, view);
		if (ascii(bytes, 0, 4) === 'GIF8') return gifPixels(bytes, view);
		if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpPixels(bytes, view);
	} catch {
		// DataView throws RangeError past the end of a truncated header.
	}
	return null;
}

/** The frame size in the first SOF segment, skipping the segments before it. */
function jpegPixels(bytes: Uint8Array, view: DataView): number | null {
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		if (marker === 0xff) {
			offset += 1; // fill byte
		} else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			offset += 2; // standalone marker, no length
		} else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			// SOF0–SOF15 (C4, C8 and CC are other segments): precision, height, width.
			return area(view.getUint16(offset + 7), view.getUint16(offset + 5));
		} else if (marker === 0xd9 || marker === 0xda) {
			return null; // end of image or start of scan before any frame header
		} else {
			offset += 2 + view.getUint16(offset + 2);
		}
	}
	return null;
}

/** The larger of the logical screen and the first frame, which the decoder buffers whole. */
function gifPixels(bytes: Uint8Array, view: DataView): number | null {
	const screen = area(view.getUint16(6, true), view.getUint16(8, true));
	const flags = bytes[10];
	// A global color table follows the screen descriptor: 3 bytes for each of 2^(n+1) colors.
	let offset = 13 + (flags & 0x80 ? 3 << ((flags & 0x07) + 1) : 0);
	while (offset < bytes.length) {
		const block = bytes[offset];
		if (block === 0x2c) {
			const frame = area(view.getUint16(offset + 5, true), view.getUint16(offset + 7, true));
			return screen === null || frame === null ? null : Math.max(screen, frame);
		}
		if (block !== 0x21) return null;
		// Extension: introducer, label, then data sub-blocks up to an empty one.
		offset += 2;
		while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
		offset += 1;
	}
	return null;
}

function webpPixels(bytes: Uint8Array, view: DataView): number | null {
	switch (ascii(bytes, 12, 4)) {
		case 'VP8 ':
			// Lossy: 14-bit sizes after the frame tag and start code.
			return area(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
		case 'VP8L': {
			// Lossless: 14-bit sizes minus one, packed after the signature byte.
			const bits = view.getUint32(21, true);
			return area((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
		}
		case 'VP8X':
			// Extended (alpha, animation): 24-bit canvas sizes minus one.
			return area(uint24(view, 24) + 1, uint24(view, 27) + 1);
		default:
			return null;
	}
}

function area(width: number, height: number): number | null {
	return width > 0 && height > 0 ? width * height : null;
}

function uint24(view: DataView, offset: number): number {
	return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
