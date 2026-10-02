/**
 * The share card's design as a Takumi node tree: plain data, so it is testable without
 * the wasm renderer. Two compositions share one frame: a photo card (lead image panel on
 * the right) and a typographic card (no usable image) carried by the brand mark.
 */
import type { Node } from '@takumi-rs/wasm';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export const FONT = { serif: 'Newsreader', sans: 'Hanken Grotesk' } as const;

/** Nightstand tokens (src/app.css); the card renders outside the page, so values are literal. */
const C = {
	void: '#15110c',
	surface: '#1f1a13',
	hair: '#342d22',
	ink: '#ece4d6',
	read: '#cdbfa6',
	faint: '#9b8f76',
	accent: '#e0a14e',
	/** The accent at 40% over void: the ghost mark's dot, lit but quieter than the logo's. */
	ember: '#664b26'
} as const;

/** The lamplight wash the site and the static card use: one faint ember light from above. */
const WASH = 'radial-gradient(1200px 760px at 50% -12%, rgba(224,161,78,0.09), transparent 60%)';

const INSET = 24;
const PAD_X = 72;
const PAD_Y = 64;
const GUTTER = 56;
const PANEL = { width: 472, height: CARD_HEIGHT - 2 * INSET, radius: 20 } as const;
const PHOTO_COLUMN = CARD_WIDTH - PAD_X - GUTTER - PANEL.width - INSET;
const TEXT_COLUMN = 660;
const GHOST = { height: 470, right: 84 } as const;

export const MARK_SRC = 'tangent-mark';
export const MARK_GHOST_SRC = 'tangent-mark-ghost';

/** BrandMark's geometry (24×29 viewBox) with the ring/bar and the dot colored explicitly. */
function markSvg(stroke: string, dot: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 29" width="240" height="290"><line x1="1.25" y1="1.821" x2="22.75" y2="1.821" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"/><path d="M13.4214 27.7455C13.4235 28.4354 12.8662 28.9976 12.1763 29.0004C11.4862 29.0027 10.9241 28.4443 10.9214 27.7543L10.9038 22.7426C11.2658 22.7813 11.6339 22.8031 12.0063 22.8031C12.4806 22.8031 12.947 22.7678 13.4038 22.7055L13.4214 27.7455ZM11.2368 3.02771C10.991 3.2568 10.8372 3.58334 10.8384 3.94568L10.8413 5.02771C7.14273 5.5995 4.3083 8.85285 4.30811 12.7797C4.30811 16.7259 7.17074 19.9903 10.896 20.5385L10.9038 22.7426C5.85966 22.2026 1.9333 18.0027 1.93311 12.8998C1.93316 7.685 6.03344 3.41425 11.2368 3.02771ZM12.9546 3.04139C18.0726 3.51146 22.0786 7.74497 22.0786 12.8998C22.0784 17.9026 18.3049 22.0363 13.4038 22.7055L13.396 20.4906C16.9838 19.824 19.7036 16.6265 19.7036 12.7797C19.7034 8.91383 16.9565 5.70336 13.3423 5.05896L13.3384 3.93787C13.3371 3.5857 13.1897 3.26788 12.9546 3.04139ZM12.0845 2.69178C12.4222 2.69085 12.729 2.82412 12.9546 3.04139C12.6425 3.01272 12.3261 2.99648 12.0063 2.99646C11.7476 2.99647 11.4907 3.00886 11.2368 3.02771C11.4591 2.8207 11.7569 2.69299 12.0845 2.69178Z" fill="${stroke}"/><ellipse cx="12.0061" cy="2.1118" rx="2.148" ry="2.1118" fill="${dot}"/></svg>`;
}

/** SVG sources for the image keys above; the renderer passes them with every render. */
export const MARK_IMAGES = {
	[MARK_SRC]: markSvg(C.ink, C.accent),
	[MARK_GHOST_SRC]: markSvg(C.hair, C.ember)
} as const;

export type CardImageFit = 'cover' | 'contain';

/** A lead image the layout places; `src` keys the bytes passed to the renderer. */
export interface CardImageRef {
	src: string;
	width: number;
	height: number;
	fit: CardImageFit;
}

export interface CardContent {
	title: string;
	description: string | null;
	image: CardImageRef | null;
}

/** Smallest source, on its longer side, worth a panel; smaller ones read as blur. */
const MIN_IMAGE_SIDE = 320;
/** Most a photo may be enlarged to fill the panel before it goes soft. */
const MAX_COVER_SCALE = 2.25;
/** Most a contained image may be enlarged. */
const MAX_CONTAIN_SCALE = 2;
const CONTAIN_PADDING = 28;

/**
 * How an image of this size sits in the panel: photos fill it, everything else (diagrams,
 * maps, logos, small photos) is shown whole. Null when it is too small to show at all.
 */
export function cardImageFit(width: number, height: number, photo: boolean): CardImageFit | null {
	if (!(width > 0) || !(height > 0) || Math.max(width, height) < MIN_IMAGE_SIDE) return null;
	const coverScale = Math.max(PANEL.width / width, PANEL.height / height);
	return photo && coverScale <= MAX_COVER_SCALE ? 'cover' : 'contain';
}

/**
 * Type sizes and average advance per character in ems, measured on rendered cards and
 * rounded up so the estimates below err toward wrapping early.
 */
const TITLE = { lineHeight: 1.04, maxLines: 3, emPerChar: 0.47 } as const;
const PHOTO_TITLE_SIZES = [84, 76, 68, 60, 54, 48];
const TEXT_TITLE_SIZES = [112, 100, 88, 78, 68, 60, 54];
const DESCRIPTION = { size: 32, lineHeight: 1.28, gap: 22, maxLines: 2, emPerChar: 0.42 } as const;
/** BrandMark's lockup proportions: the mark 1.5x the wordmark's size, gap-2 (0.5em) apart. */
const WORDMARK_SIZE = 32;
const BRAND_HEIGHT = WORDMARK_SIZE * 1.5;
const MARK_WIDTH = Math.round((BRAND_HEIGHT * 24) / 29);
const FOOTER_SIZE = 22;
/** Least space kept between the body and the brand row above and the footer below. */
const BODY_MARGIN = 24;
/** Height the title and description share. */
const BODY_HEIGHT = CARD_HEIGHT - PAD_Y - (PAD_Y - 4) - BRAND_HEIGHT - FOOTER_SIZE - 2 * BODY_MARGIN;

/** Characters that fit on one line at `size` in `width` px. */
function charsPerLine(size: number, width: number, emPerChar: number): number {
	return Math.max(1, Math.floor(width / (size * emPerChar)));
}

/** Greedy word-wrap estimate of how many lines `text` takes at `size` in `width` px. */
export function estimateLines(text: string, size: number, width: number, emPerChar: number): number {
	const perLine = charsPerLine(size, width, emPerChar);
	let lines = 1;
	let used = 0;
	for (const word of text.split(' ')) {
		const length = Array.from(word).length;
		if (used > 0 && used + 1 + length <= perLine) {
			used += 1 + length;
			continue;
		}
		if (used > 0) lines += 1;
		lines += Math.ceil(length / perLine) - 1;
		used = length % perLine || perLine;
	}
	return lines;
}

/**
 * Largest of `sizes` at which the title fits in three lines without breaking a word and,
 * with the description under it, between the brand row and the footer. The smallest size
 * clamps instead, and the renderer then breaks a word too long for any line.
 */
export function titleSize(
	title: string,
	description: string | null,
	sizes: readonly number[],
	width: number
): number {
	const descriptionLines = description
		? Math.min(DESCRIPTION.maxLines, estimateLines(description, DESCRIPTION.size, width, DESCRIPTION.emPerChar))
		: 0;
	const room =
		BODY_HEIGHT -
		(descriptionLines && DESCRIPTION.gap + descriptionLines * DESCRIPTION.size * DESCRIPTION.lineHeight);
	const longestWord = Math.max(...title.split(' ').map((word) => Array.from(word).length));
	const fits = (size: number) => {
		const lines = estimateLines(title, size, width, TITLE.emPerChar);
		return (
			longestWord <= charsPerLine(size, width, TITLE.emPerChar) &&
			lines <= TITLE.maxLines &&
			lines * size * TITLE.lineHeight <= room
		);
	};
	return sizes.find(fits) ?? sizes[sizes.length - 1];
}

export function cardLayout(content: CardContent): Node {
	const image = content.image;
	const column = image ? PHOTO_COLUMN : TEXT_COLUMN;
	const size = titleSize(content.title, content.description, image ? PHOTO_TITLE_SIZES : TEXT_TITLE_SIZES, column);
	return {
		type: 'container',
		style: {
			position: 'relative',
			display: 'flex',
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			backgroundColor: C.void,
			backgroundImage: WASH,
			color: C.ink,
			fontFamily: FONT.serif
		},
		children: [
			...(image ? [panel(image)] : [frame(), ghostMark()]),
			{
				type: 'container',
				style: {
					position: 'relative',
					display: 'flex',
					flexDirection: 'column',
					width: column + PAD_X,
					height: CARD_HEIGHT,
					padding: `${PAD_Y}px 0 ${PAD_Y - 4}px ${PAD_X}px`
				},
				children: [brand(), body(content, size, column), footer()]
			}
		]
	};
}

function brand(): Node {
	return {
		type: 'container',
		style: { display: 'flex', alignItems: 'center', gap: WORDMARK_SIZE / 2 },
		children: [
			{
				type: 'image',
				src: MARK_SRC,
				width: MARK_WIDTH,
				height: BRAND_HEIGHT,
				style: { width: MARK_WIDTH, height: BRAND_HEIGHT }
			},
			{
				type: 'text',
				text: 'tangent',
				style: { fontSize: WORDMARK_SIZE, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1 }
			}
		]
	};
}

function body(content: CardContent, size: number, column: number): Node {
	const children: Node[] = [
		{
			type: 'text',
			text: content.title,
			style: {
				width: column,
				fontSize: size,
				fontWeight: 600,
				lineHeight: TITLE.lineHeight,
				letterSpacing: '-0.02em',
				textWrap: 'balance',
				// Only at the smallest size can a word outgrow the line (see titleSize).
				overflowWrap: 'break-word',
				lineClamp: TITLE.maxLines,
				textOverflow: 'ellipsis'
			}
		}
	];
	if (content.description) {
		children.push({
			type: 'text',
			text: content.description,
			style: {
				width: column,
				marginTop: DESCRIPTION.gap,
				fontSize: DESCRIPTION.size,
				fontStyle: 'italic',
				fontWeight: 400,
				lineHeight: DESCRIPTION.lineHeight,
				color: C.read,
				textWrap: 'pretty',
				lineClamp: DESCRIPTION.maxLines,
				textOverflow: 'ellipsis'
			}
		});
	}
	return {
		type: 'container',
		style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 },
		children
	};
}

function footer(): Node {
	return {
		type: 'text',
		text: 'tangent.page',
		style: {
			fontFamily: FONT.sans,
			fontSize: FOOTER_SIZE,
			fontWeight: 500,
			letterSpacing: '0.06em',
			color: C.faint,
			lineHeight: 1
		}
	};
}

function panel(image: CardImageRef): Node {
	const box = {
		position: 'absolute',
		top: INSET,
		right: INSET,
		width: PANEL.width,
		height: PANEL.height,
		borderRadius: PANEL.radius,
		overflow: 'hidden',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: C.surface
	} as const;
	if (image.fit === 'cover') {
		return {
			type: 'container',
			style: box,
			children: [
				{ type: 'image', src: image.src, style: { width: '100%', height: '100%', objectFit: 'cover' } },
				// A hairline keeps light photo edges from bleeding into the void.
				{
					type: 'container',
					style: {
						position: 'absolute',
						top: 0,
						left: 0,
						width: '100%',
						height: '100%',
						borderRadius: PANEL.radius,
						border: '1px solid rgba(236, 228, 214, 0.08)'
					}
				}
			]
		};
	}
	const scale = Math.min(
		(PANEL.width - 2 * CONTAIN_PADDING) / image.width,
		(PANEL.height - 2 * CONTAIN_PADDING) / image.height,
		MAX_CONTAIN_SCALE
	);
	const width = Math.round(image.width * scale);
	const height = Math.round(image.height * scale);
	return {
		type: 'container',
		style: { ...box, border: `1px solid ${C.hair}` },
		children: [
			{
				type: 'image',
				src: image.src,
				width,
				height,
				style: { width, height, borderRadius: 12 }
			}
		]
	};
}

/** The static card's hairline frame, for the typographic composition. */
function frame(): Node {
	return {
		type: 'container',
		style: {
			position: 'absolute',
			top: INSET,
			left: INSET,
			width: CARD_WIDTH - 2 * INSET,
			height: CARD_HEIGHT - 2 * INSET,
			borderRadius: 22,
			border: `1px solid ${C.hair}`
		}
	};
}

/** A large, quiet brand mark that anchors the typographic card's open right side. */
function ghostMark(): Node {
	const { height, right } = GHOST;
	const width = Math.round((height * 24) / 29);
	return {
		type: 'image',
		src: MARK_GHOST_SRC,
		width,
		height,
		style: { position: 'absolute', right, top: (CARD_HEIGHT - height) / 2, width, height }
	};
}
