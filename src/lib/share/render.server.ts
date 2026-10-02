/**
 * Share-card rasterizer: Takumi (Rust compiled to WebAssembly) lays out a node tree and
 * encodes it as a PNG, with no headless browser.
 *
 * Under workerd, `@takumi-rs/wasm/auto` resolves to an import of the package's `.wasm`
 * file, which wrangler bundles as a precompiled WebAssembly.Module (Workers refuse to
 * compile wasm from bytes at runtime). Under Node (vite dev) the same specifier
 * initializes the module from disk, so `init()` below returns immediately.
 *
 * Fonts are the Fontsource WOFF2 files the app already self-hosts. `read()` fetches them
 * through the ASSETS binding on Workers, once per isolate.
 */
import init, { Renderer, type Node } from '@takumi-rs/wasm';
import wasmModule from '@takumi-rs/wasm/auto';
import { read } from '$app/server';
import newsreaderSemibold from '@fontsource/newsreader/files/newsreader-latin-600-normal.woff2?url';
import newsreaderSemiboldExt from '@fontsource/newsreader/files/newsreader-latin-ext-600-normal.woff2?url';
import newsreaderItalic from '@fontsource/newsreader/files/newsreader-latin-400-italic.woff2?url';
import newsreaderItalicExt from '@fontsource/newsreader/files/newsreader-latin-ext-400-italic.woff2?url';
import newsreaderSemiboldViet from '@fontsource/newsreader/files/newsreader-vietnamese-600-normal.woff2?url';
import newsreaderItalicViet from '@fontsource/newsreader/files/newsreader-vietnamese-400-italic.woff2?url';
import hankenMedium from '@fontsource/hanken-grotesk/files/hanken-grotesk-latin-500-normal.woff2?url';
import { CARD_HEIGHT, CARD_WIDTH, FONT, MARK_IMAGES } from './layout';

interface FontFile {
	url: string;
	family: string;
	subset: 'latin' | 'latin-ext' | 'vietnamese';
	weight: number;
	style: 'normal' | 'italic';
}

/** Keep in step with ./glyphs, which keeps text these subsets can't draw off the card. */
const FONT_FILES: FontFile[] = [
	{ url: newsreaderSemibold, family: FONT.serif, subset: 'latin', weight: 600, style: 'normal' },
	{ url: newsreaderSemiboldExt, family: FONT.serif, subset: 'latin-ext', weight: 600, style: 'normal' },
	{ url: newsreaderSemiboldViet, family: FONT.serif, subset: 'vietnamese', weight: 600, style: 'normal' },
	{ url: newsreaderItalic, family: FONT.serif, subset: 'latin', weight: 400, style: 'italic' },
	{ url: newsreaderItalicExt, family: FONT.serif, subset: 'latin-ext', weight: 400, style: 'italic' },
	{ url: newsreaderItalicViet, family: FONT.serif, subset: 'vietnamese', weight: 400, style: 'italic' },
	// Only fixed ASCII labels use the sans, so its Latin subset is enough.
	{ url: hankenMedium, family: FONT.sans, subset: 'latin', weight: 500, style: 'normal' }
];

const SUBSET_RANK: Record<FontFile['subset'], number> = { latin: 0, 'latin-ext': 1, vietnamese: 2 };

let ready: Promise<Renderer> | null = null;

async function createRenderer(): Promise<Renderer> {
	await init({ module_or_path: wasmModule });
	const renderer = new Renderer();
	const files = await Promise.all(
		FONT_FILES.map(async (font) => ({ font, data: await read(font.url).arrayBuffer() }))
	);
	for (const { font, data } of files) {
		await renderer.registerFont({
			// Subsets register as distinct families; `font-family: Newsreader` expands to all
			// of them and each codepoint routes to the subset that covers it.
			name: `${font.family} ${font.subset}`,
			subsetOf: font.family,
			subsetRank: SUBSET_RANK[font.subset],
			data,
			weight: font.weight,
			style: font.style
		});
	}
	return renderer;
}

/** The isolate's renderer, created on first use. A failed setup is retried next time. */
function renderer(): Promise<Renderer> {
	ready ??= createRenderer().catch((error: unknown) => {
		ready = null;
		throw error;
	});
	return ready;
}

/** Image bytes the node tree references by `src`, so Takumi never fetches on its own. */
export interface CardImage {
	src: string;
	data: ArrayBuffer;
}

const MARKS = Object.entries(MARK_IMAGES).map(([src, svg]) => ({
	src,
	data: new TextEncoder().encode(svg)
}));

/** Rasterize a card layout to a 1200×630 PNG. */
export async function renderCardPng(node: Node, images: CardImage[] = []): Promise<Uint8Array<ArrayBuffer>> {
	const png = await (await renderer()).render(node, {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		format: 'png',
		images: [
			...MARKS,
			// Each card shows a different photo; keep one-off decodes out of the shared cache.
			...images.map((image) => ({ ...image, cache: 'none' as const }))
		]
	});
	// Typed as a view of any buffer, but the bytes are copied out of wasm memory into a
	// fresh ArrayBuffer, which is what Response bodies require.
	return png as Uint8Array<ArrayBuffer>;
}
