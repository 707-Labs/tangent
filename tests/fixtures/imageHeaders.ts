/** Image file headers with chosen dimensions, for code that reads sizes before decoding. */

function bytes(...parts: (number[] | string)[]): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)));
}

const u16be = (n: number) => [n >> 8, n & 0xff];
const u16le = (n: number) => [n & 0xff, n >> 8];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => u32be(n).reverse();
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];

export function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
	return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(width), u32be(height), [8, 2, 0, 0, 0], u32be(0));
}

/** A JFIF segment and an Exif segment (holding a decoy frame header) before the real one. */
export function jpegHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
	const decoy = [0xff, 0xc0, ...u16be(11), 8, ...u16be(9999), ...u16be(9999), 1, 1, 0x11, 0];
	return bytes(
		[0xff, 0xd8],
		[0xff, 0xe0, ...u16be(16)], 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
		[0xff, 0xe1, ...u16be(2 + 6 + decoy.length)], 'Exif', [0, 0], decoy,
		[0xff, 0xc2, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
	);
}

/** A global color table and a graphic control extension precede the first frame. */
export function gifHeader(screen: [number, number], frame: [number, number] = screen): Uint8Array<ArrayBuffer> {
	return bytes(
		'GIF89a', u16le(screen[0]), u16le(screen[1]), [0x80, 0, 0], [0, 0, 0, 255, 255, 255],
		[0x21, 0xf9, 4, 0, 10, 0, 0, 0],
		[0x2c, ...u16le(0), ...u16le(0), ...u16le(frame[0]), ...u16le(frame[1]), 0]
	);
}

export function webpHeader(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Uint8Array<ArrayBuffer> {
	const body =
		kind === 'VP8 '
			? [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height)]
			: kind === 'VP8L'
				? [0x2f, ...u32le((width - 1) | ((height - 1) << 14))]
				: [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
	return bytes('RIFF', u32le(4 + 8 + body.length), 'WEBP', kind, u32le(body.length), body);
}
