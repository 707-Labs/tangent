import { ATLAS_BOUNDS } from './atlas';
import { REGIONS, type Camera, type WorldNode } from './world';
import { approach, boxesOverlap, intervalAlpha, labelIntervals, type LabelInterval, type ScreenBox } from './labels';

/**
 * Region hues for the map, in REGIONS order (history, nature, science, arts, people, places,
 * technology). They are data colors, not UI tokens: muted, warm-leaning and distinct from their
 * ring neighbors, with no purple or cyan.
 */
const REGION_COLORS = {
	night: ['#dca463', '#8fb487', '#8ea9c2', '#d18a9c', '#dc8f74', '#d6cbb3', '#bfb66b'],
	day: ['#8a5512', '#336b3f', '#365a7a', '#93415a', '#9b4529', '#6b5d45', '#66601c'],
	contrast: ['#ffc06e', '#9be39a', '#9cc4ff', '#ff9ab8', '#ff9a7a', '#f2ead8', '#e6dc6e']
} as const;

/** Region names give way to article names at this zoom. */
export const REGION_LABEL_MAX = 0.42;
/** Within each region, the article ranked r by links may be named from ARTICLE_ZOOM * sqrt(r + 1). */
const ARTICLE_ZOOM = 0.08;
const MAX_ZOOM = 2.3;
const LABEL_WIDTH = 180;
const LABEL_GAP = 7;
const ARTICLE_HEIGHT = 15;
const REGION_HEIGHT = 30;
/** Each stroke covers this many edges, so dense areas build up a little where strokes overlap. */
const STROKE_BATCH = 500;
const ARC_BEND = 0.16;
/** Receding points and names keep this much less than full opacity. */
const POINT_RECEDE = 0.6;
const FADE_LEVELS = 8;

export interface MapPalette {
	dark: boolean;
	background: string;
	ink: string;
	muted: string;
	accent: string;
	bodyFont: string;
	displayFont: string;
	regions: readonly string[];
	/** Region hues drawn toward the ink, so names stand apart from their own points. */
	regionNames: readonly string[];
}

/** Mixes two #rrggbb colors; anything else returns the first unchanged. */
function mix(a: string, b: string, amount: number): string {
	const pattern = /^#[0-9a-f]{6}$/i;
	if (!pattern.test(a) || !pattern.test(b)) return a;
	const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
	return `#${[1, 3, 5].map((at) => Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * amount)
		.toString(16).padStart(2, '0')).join('')}`;
}

export function readPalette(root: HTMLElement): MapPalette {
	const style = getComputedStyle(root);
	const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	const theme = root.dataset.theme;
	const dark = theme !== 'daylight';
	const ink = value('--color-ink', '#ece4d6');
	const regions = theme === 'high-contrast' ? REGION_COLORS.contrast : dark ? REGION_COLORS.night : REGION_COLORS.day;
	return {
		dark,
		background: value('--color-void', '#15110c'),
		ink,
		muted: value('--color-muted', '#a89c8a'),
		accent: value('--color-accent', '#e0a14e'),
		bodyFont: value('--font-body', 'sans-serif'),
		displayFont: value('--font-display', 'serif'),
		regions,
		regionNames: regions.map((color) => mix(color, ink, 0.4))
	};
}

/** Typed-array view of the world, rebuilt only when nodes change. */
export interface MapGraph {
	nodes: readonly WorldNode[];
	index: ReadonlyMap<string, number>;
	x: Float64Array;
	y: Float64Array;
	/** REGIONS index, or -1 for an unknown region. */
	region: Int8Array;
	degree: Uint16Array;
	/** Node indices grouped by REGIONS index, with unknown regions last. */
	members: readonly Uint32Array[];
	/** Edge indices touching each node. */
	incident: readonly number[][];
	edgeA: Uint32Array;
	edgeB: Uint32Array;
	/** Edges within one region, grouped by REGIONS index. */
	intra: readonly Uint32Array[];
	/** Edges between regions, drawn as gentle arcs through a control point. */
	cross: Uint32Array;
	isCross: Uint8Array;
	controlX: Float64Array;
	controlY: Float64Array;
	/** Distance from each region's center that holds most of its articles. */
	regionRadius: Float64Array;
}

export function prepareGraph(nodes: readonly WorldNode[]): MapGraph {
	const count = nodes.length;
	const index = new Map(nodes.map((node, i) => [node.title, i]));
	const regionIndex = new Map(REGIONS.map((region, i) => [region.id, i]));
	const x = new Float64Array(count), y = new Float64Array(count);
	const region = new Int8Array(count), degree = new Uint16Array(count);
	const incident: number[][] = nodes.map(() => []);
	const from: number[] = [], to: number[] = [];
	const seen = new Set<number>();
	nodes.forEach((node, i) => {
		x[i] = node.x; y[i] = node.y;
		region[i] = regionIndex.get(node.region) ?? -1;
		for (const title of node.neighbors) {
			const j = index.get(title);
			if (j === undefined || j === i) continue;
			const low = Math.min(i, j), high = Math.max(i, j);
			const key = low * count + high;
			if (seen.has(key)) continue;
			seen.add(key);
			incident[low].push(from.length); incident[high].push(from.length);
			from.push(low); to.push(high);
		}
	});
	for (let i = 0; i < count; i++) degree[i] = Math.min(65535, incident[i].length);
	const edgeA = Uint32Array.from(from), edgeB = Uint32Array.from(to);
	const intraLists: number[][] = REGIONS.map(() => []);
	const crossList: number[] = [];
	const isCross = new Uint8Array(from.length);
	const controlX = new Float64Array(from.length), controlY = new Float64Array(from.length);
	for (let e = 0; e < from.length; e++) {
		const a = edgeA[e], b = edgeB[e];
		if (region[a] >= 0 && region[a] === region[b]) { intraLists[region[a]].push(e); continue; }
		crossList.push(e);
		isCross[e] = 1;
		// Bow each arc away from the middle of the map so long links do not all cross at one point.
		const mx = (x[a] + x[b]) / 2, my = (y[a] + y[b]) / 2;
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const length = Math.hypot(dx, dy) || 1;
		let nx = -dy / length, ny = dx / length;
		if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
		controlX[e] = mx + nx * length * ARC_BEND;
		controlY[e] = my + ny * length * ARC_BEND;
	}
	const groups: number[][] = [...REGIONS.map(() => []), []];
	for (let i = 0; i < count; i++) groups[region[i] >= 0 ? region[i] : REGIONS.length].push(i);
	const regionRadius = Float64Array.from(REGIONS, (center, r) => {
		const distances = groups[r].map((i) => Math.hypot(x[i] - center.x, y[i] - center.y)).sort((a, b) => a - b);
		return distances.length ? distances[Math.floor(distances.length * 0.85)] : 0;
	});
	return { nodes, index, x, y, region, degree, members: groups.map((group) => Uint32Array.from(group)), incident,
		edgeA, edgeB, intra: intraLists.map((list) => Uint32Array.from(list)), cross: Uint32Array.from(crossList),
		isCross, controlX, controlY, regionRadius };
}

/** Soft regional light, painted once into a small world-space texture and scaled per frame. */
export interface Nebula { canvas: HTMLCanvasElement; scale: number; left: number; top: number }

export function paintNebula(graph: MapGraph, palette: MapPalette): Nebula | null {
	const scale = 1 / 8;
	const margin = 500;
	const left = ATLAS_BOUNDS.minX - margin, top = ATLAS_BOUNDS.minY - margin;
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil((ATLAS_BOUNDS.maxX - ATLAS_BOUNDS.minX + 2 * margin) * scale);
	canvas.height = Math.ceil((ATLAS_BOUNDS.maxY - ATLAS_BOUNDS.minY + 2 * margin) * scale);
	const context = canvas.getContext('2d');
	if (!context) return null;
	const radius = Math.round(240 * scale);
	const sprites = palette.regions.map((color) => {
		const sprite = document.createElement('canvas');
		sprite.width = sprite.height = radius * 2;
		const paint = sprite.getContext('2d');
		if (paint) {
			const gradient = paint.createRadialGradient(radius, radius, 0, radius, radius, radius);
			gradient.addColorStop(0, color);
			gradient.addColorStop(1, `${color}00`);
			paint.fillStyle = gradient;
			paint.fillRect(0, 0, radius * 2, radius * 2);
		}
		return sprite;
	});
	context.globalAlpha = palette.dark ? 0.035 : 0.03;
	for (let i = 0; i < graph.nodes.length; i++) {
		const region = graph.region[i];
		if (region < 0) continue;
		context.drawImage(sprites[region], (graph.x[i] - left) * scale - radius, (graph.y[i] - top) * scale - radius);
	}
	return { canvas, scale, left, top };
}

/** Points grow gently with zoom so the overview reads as a field and close views as places. */
function pointScale(k: number): number {
	return Math.max(0.75, Math.min(2, Math.sqrt(k / 0.35)));
}

/** Screen radius of a point: well-linked articles read larger. */
export function pointRadius(graph: MapGraph, i: number, k: number): number {
	const base = (1.3 + 0.27 * Math.sqrt(graph.degree[i])) * pointScale(k);
	return graph.nodes[i].hub ? base * 1.35 + 1 : base;
}

export interface MapLabel {
	/** Node index, or -1 for a region name. */
	node: number;
	region: number;
	text: string;
	font: string;
	/** 0 region name, 1 major article, 2 article. */
	tier: 0 | 1 | 2;
	x: number;
	y: number;
	width: number;
	height: number;
	offsetY: number;
	interval: LabelInterval;
}

export interface LabelLayer {
	labels: MapLabel[];
	/** Label index for each node, or -1. */
	byNode: Int32Array;
	/** Eased visibility for labels that give way to highlighted names. */
	shown: Float32Array;
}

function labelFont(palette: MapPalette, tier: 0 | 1 | 2, emphasis = false): string {
	if (tier === 0) return `500 24px ${palette.displayFont}`;
	return `${emphasis ? 600 : tier === 1 ? 500 : 400} ${emphasis ? 13 : 12}px ${palette.bodyFont}`;
}

/** Every face the map draws with; canvas text does not load fonts by itself. */
export function labelFonts(palette: MapPalette): string[] {
	return [labelFont(palette, 0), labelFont(palette, 1), labelFont(palette, 2), labelFont(palette, 1, true)];
}

function fitText(context: CanvasRenderingContext2D, text: string, limit: number): { text: string; width: number } {
	const width = context.measureText(text).width;
	if (width <= limit) return { text, width };
	let low = 0, high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (context.measureText(`${text.slice(0, middle).trimEnd()}…`).width <= limit) low = middle;
		else high = middle - 1;
	}
	const fitted = `${text.slice(0, low).trimEnd()}…`;
	return { text: fitted, width: context.measureText(fitted).width };
}

/**
 * Measures every name once and assigns its zoom interval. Region names come first and always
 * show below REGION_LABEL_MAX (at the narrowest overview neighbors sit a few pixels apart);
 * then each region's articles by link count, interleaved so every region gains names at the same pace.
 */
export function buildLabels(graph: MapGraph, palette: MapPalette, context: CanvasRenderingContext2D): LabelLayer {
	const labels: MapLabel[] = [];
	context.font = labelFont(palette, 0);
	REGIONS.forEach((region, r) => {
		const width = context.measureText(region.label).width;
		labels.push({ node: -1, region: r, text: region.label, font: context.font, tier: 0, x: region.x, y: region.y,
			width: width + 8, height: REGION_HEIGHT, offsetY: 0, interval: { start: 0, end: REGION_LABEL_MAX } });
	});
	const articles: { label: MapLabel; min: number }[] = [];
	for (const members of graph.members) {
		const ranked = [...members].sort((a, b) => Number(graph.nodes[b].hub) - Number(graph.nodes[a].hub) ||
			graph.degree[b] - graph.degree[a] || (graph.nodes[a].title < graph.nodes[b].title ? -1 : 1));
		ranked.forEach((i, rank) => {
			const tier = rank < 12 ? 1 : 2;
			context.font = labelFont(palette, tier);
			const fitted = fitText(context, graph.nodes[i].title, LABEL_WIDTH);
			articles.push({ min: ARTICLE_ZOOM * Math.sqrt(rank + 1), label: { node: i, region: graph.region[i], text: fitted.text,
				font: context.font, tier, x: graph.x[i], y: graph.y[i], width: fitted.width + 4, height: ARTICLE_HEIGHT,
				offsetY: LABEL_GAP + ARTICLE_HEIGHT / 2, interval: { start: 0, end: 0 } } });
		});
	}
	articles.sort((a, b) => a.min - b.min || graph.degree[b.label.node] - graph.degree[a.label.node] ||
		(a.label.text < b.label.text ? -1 : 1));
	labels.push(...articles.map(({ label }) => label));
	const intervals = labelIntervals(labels.map((label, i) => ({ x: label.x, y: label.y, width: label.width, height: label.height,
		offsetY: label.offsetY, min: i < REGIONS.length ? 0 : articles[i - REGIONS.length].min, max: label.tier === 0 ? REGION_LABEL_MAX : undefined,
		fixed: label.tier === 0 })), MAX_ZOOM);
	const byNode = new Int32Array(graph.nodes.length).fill(-1);
	labels.forEach((label, i) => {
		label.interval = intervals[i];
		if (label.node >= 0) byNode[label.node] = i;
	});
	return { labels, byNode, shown: new Float32Array(labels.length).fill(1) };
}

export interface MapFrame {
	camera: Camera;
	width: number;
	height: number;
	/** 0 to 1: how far the link fabric and nebula recede behind highlighted neighborhoods. */
	emphasis: number;
	focus: number;
	hover: number;
	/** Keyboard focus in the accessible article list. */
	cursor: number;
	/** Per node, 0 to 1: how far it recedes. Eased by the caller so highlights fade rather than switch. */
	fade: Float32Array | null;
	/** Articles whose links are drawn whole, with 0 to 1 strength so they can fade out. */
	links: readonly { node: number; accent: boolean; level: number }[];
	trail: readonly number[];
	visited: ReadonlySet<number>;
}

interface WorldRect { left: number; top: number; right: number; bottom: number }

function worldRect(frame: MapFrame, marginPx: number): WorldRect {
	const { x, y, k } = frame.camera;
	const margin = marginPx / k;
	return { left: -x / k - margin, top: -y / k - margin, right: (frame.width - x) / k + margin, bottom: (frame.height - y) / k + margin };
}

function traceEdge(context: CanvasRenderingContext2D, graph: MapGraph, e: number, camera: Camera, view: WorldRect | null): boolean {
	const a = graph.edgeA[e], b = graph.edgeB[e];
	const ax = graph.x[a], ay = graph.y[a], bx = graph.x[b], by = graph.y[b];
	const curved = graph.isCross[e] === 1;
	const cx = curved ? graph.controlX[e] : ax, cy = curved ? graph.controlY[e] : ay;
	if (view && (Math.max(ax, bx, cx) < view.left || Math.min(ax, bx, cx) > view.right ||
		Math.max(ay, by, cy) < view.top || Math.min(ay, by, cy) > view.bottom)) return false;
	const { k } = camera;
	context.moveTo(ax * k + camera.x, ay * k + camera.y);
	if (curved) context.quadraticCurveTo(cx * k + camera.x, cy * k + camera.y, bx * k + camera.x, by * k + camera.y);
	else context.lineTo(bx * k + camera.x, by * k + camera.y);
	return true;
}

function strokeEdges(context: CanvasRenderingContext2D, graph: MapGraph, edges: ArrayLike<number>, camera: Camera, view: WorldRect | null) {
	let batch = 0;
	context.beginPath();
	for (let n = 0; n < edges.length; n++) {
		if (!traceEdge(context, graph, edges[n], camera, view)) continue;
		if (++batch === STROKE_BATCH) { context.stroke(); context.beginPath(); batch = 0; }
	}
	if (batch) context.stroke();
}

/** Nebula, link fabric, visit path and points. Labels draw separately, above everything. */
export function drawMap(context: CanvasRenderingContext2D, graph: MapGraph, nebula: Nebula | null, palette: MapPalette, frame: MapFrame) {
	const { camera, emphasis, fade } = frame;
	const { k } = camera;
	context.clearRect(0, 0, frame.width, frame.height);
	const view = worldRect(frame, 16);
	const recede = 1 - 0.72 * emphasis;
	// Full strength at the overview; the haze and long arcs recede once a region fills the view.
	const close = Math.max(0, Math.min(1, (k - 0.2) / 0.5));
	if (nebula) {
		context.globalAlpha = (1 - 0.45 * emphasis) * (1 - 0.7 * close);
		const scale = k / nebula.scale;
		context.drawImage(nebula.canvas, nebula.left * k + camera.x, nebula.top * k + camera.y, nebula.canvas.width * scale, nebula.canvas.height * scale);
	}

	context.lineCap = 'round';
	context.lineWidth = Math.max(0.5, Math.min(1, 0.3 + k * 0.6));
	context.globalAlpha = (palette.dark ? 0.16 : 0.2) * recede;
	for (let r = 0; r < REGIONS.length; r++) {
		context.strokeStyle = palette.regions[r];
		strokeEdges(context, graph, graph.intra[r], camera, view);
	}
	context.strokeStyle = palette.muted;
	context.globalAlpha = (palette.dark ? 0.07 : 0.09) * recede * (1 - 0.5 * close);
	strokeEdges(context, graph, graph.cross, camera, view);

	// Links of the hovered and selected articles, drawn whole so they lead off screen.
	context.lineWidth = Math.max(1, Math.min(1.6, 0.6 + k));
	for (const link of frame.links) {
		if (link.node < 0 || link.level <= 0) continue;
		// Hubs with many links draw each one lighter, so their rays stay distinct where they converge.
		const crowd = Math.min(1, 6 / Math.sqrt(graph.incident[link.node].length));
		context.strokeStyle = link.accent ? palette.accent : palette.ink;
		context.globalAlpha = (link.accent ? 0.75 : 0.55) * crowd * link.level * Math.max(emphasis, 0.35);
		strokeEdges(context, graph, graph.incident[link.node], camera, null);
	}

	if (frame.trail.length > 1) {
		context.setLineDash([2, 5]);
		context.lineWidth = 1.5;
		context.strokeStyle = palette.accent;
		context.globalAlpha = 0.8;
		context.beginPath();
		frame.trail.forEach((i, step) => {
			const sx = graph.x[i] * k + camera.x, sy = graph.y[i] * k + camera.y;
			if (step) context.lineTo(sx, sy); else context.moveTo(sx, sy);
		});
		context.stroke();
		context.setLineDash([]);
	}

	// Points batch by region and by fade level, so a highlight costs a few fills rather than one per point.
	const scale = pointScale(k);
	const opacity = palette.dark ? 0.92 : 0.95;
	for (let group = 0; group < graph.members.length; group++) {
		const members = graph.members[group];
		const paths: Path2D[] = [];
		for (let n = 0; n < members.length; n++) {
			const i = members[n];
			const px = graph.x[i], py = graph.y[i];
			if (px < view.left || px > view.right || py < view.top || py > view.bottom) continue;
			const base = (1.3 + 0.27 * Math.sqrt(graph.degree[i])) * scale;
			const radius = graph.nodes[i].hub ? base * 1.35 + 1 : base;
			const sx = px * k + camera.x, sy = py * k + camera.y;
			const path = paths[fade ? Math.round(fade[i] * (FADE_LEVELS - 1)) : 0] ??= new Path2D();
			path.moveTo(sx + radius, sy);
			path.arc(sx, sy, radius, 0, Math.PI * 2);
		}
		context.fillStyle = group < REGIONS.length ? palette.regions[group] : palette.muted;
		paths.forEach((path, level) => {
			context.globalAlpha = opacity * (1 - POINT_RECEDE * level / (FADE_LEVELS - 1));
			context.fill(path);
		});
	}

	const ring = (i: number, gap: number, color: string, width: number, alpha: number) => {
		const radius = pointRadius(graph, i, k) + gap;
		context.beginPath();
		context.arc(graph.x[i] * k + camera.x, graph.y[i] * k + camera.y, radius, 0, Math.PI * 2);
		context.strokeStyle = color;
		context.lineWidth = width;
		context.globalAlpha = alpha;
		context.stroke();
	};
	for (const i of frame.visited) if (i !== frame.focus) ring(i, 2.5, palette.accent, 1.25, 0.85);
	if (frame.hover >= 0 && frame.hover !== frame.focus) ring(frame.hover, 4, palette.ink, 1.5, 0.9);
	if (frame.cursor >= 0 && frame.cursor !== frame.focus) ring(frame.cursor, 5, palette.accent, 2, 1);
	if (frame.focus >= 0) {
		const i = frame.focus;
		const radius = pointRadius(graph, i, k) + 1.5;
		context.beginPath();
		context.arc(graph.x[i] * k + camera.x, graph.y[i] * k + camera.y, radius, 0, Math.PI * 2);
		context.fillStyle = palette.accent;
		context.globalAlpha = 1;
		context.fill();
		ring(i, 6, palette.accent, 1.5, 0.9);
	}
	context.globalAlpha = 1;
}

export interface LabelHit extends ScreenBox {
	/** Node index, or -1 for a region name. */
	node: number;
	region: number;
}

interface TextLine { text: string; font: string; color: string }
/** `soft` names lift off the map on a blurred shadow rather than an outline. */
interface PlacedLabel { box: ScreenBox; line: TextLine; detail?: TextLine; alpha: number; soft?: boolean }

const DETAIL_HEIGHT = 15;
const EDGE_MARGIN = 8;

function drawText(context: CanvasRenderingContext2D, palette: MapPalette, items: readonly PlacedLabel[]) {
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.lineJoin = 'round';
	context.strokeStyle = palette.background;
	context.lineWidth = 3.5;
	context.shadowColor = palette.background;
	let font = '';
	const write = (line: TextLine, x: number, y: number, alpha: number, soft: boolean) => {
		if (line.font !== font) { context.font = line.font; font = line.font; }
		context.globalAlpha = alpha;
		context.fillStyle = line.color;
		if (soft) {
			// Two passes thicken the shadow into a halo without a visible outline.
			context.shadowBlur = 12;
			context.fillText(line.text, x, y);
			context.fillText(line.text, x, y);
			context.shadowBlur = 0;
			return;
		}
		context.strokeText(line.text, x, y);
		context.fillText(line.text, x, y);
	};
	for (const item of items) {
		const x = item.box.x + item.box.width / 2;
		const titleHeight = item.box.height - (item.detail ? DETAIL_HEIGHT : 0);
		write(item.line, x, item.box.y + titleHeight / 2, item.alpha, item.soft === true);
		if (item.detail) write(item.detail, x, item.box.y + titleHeight + DETAIL_HEIGHT / 2, item.alpha, item.soft === true);
	}
	context.globalAlpha = 1;
}

/**
 * Names from the precomputed intervals, plus highlighted names: the hovered article (with its
 * description), the selected article and its leading connections. Interval names that would
 * collide with a highlighted name step aside with a short fade. Returns the hit boxes of legible
 * names and whether any fade is still running.
 */
export function drawLabels(context: CanvasRenderingContext2D, graph: MapGraph, layer: LabelLayer, palette: MapPalette,
	frame: MapFrame, highlighted: readonly number[], elapsedMs: number): { hits: LabelHit[]; animating: boolean } {
	const { camera, width, height, fade } = frame;
	const { k } = camera;
	const featured: PlacedLabel[] = [];
	const featuredNodes = new Set<number>();
	const hits: LabelHit[] = [];
	for (const i of highlighted) {
		if (i < 0 || featuredNodes.has(i)) continue;
		const primary = i === frame.focus || i === frame.hover || i === frame.cursor;
		const font = labelFont(palette, 1, primary);
		context.font = font;
		const title = fitText(context, graph.nodes[i].title, primary ? 240 : LABEL_WIDTH);
		const description = i === frame.hover && i !== frame.focus ? graph.nodes[i].description : null;
		let detail: (TextLine & { width: number }) | undefined;
		if (description) {
			context.font = `400 11px ${palette.bodyFont}`;
			const fitted = fitText(context, description, 260);
			detail = { text: fitted.text, font: context.font, color: palette.muted, width: fitted.width };
		}
		const sx = graph.x[i] * k + camera.x, sy = graph.y[i] * k + camera.y;
		const gap = Math.max(LABEL_GAP, pointRadius(graph, i, k) + (i === frame.focus ? 8 : 4));
		const boxWidth = Math.max(title.width, detail?.width ?? 0) + 4;
		const box = { x: sx - boxWidth / 2, y: sy + gap, width: boxWidth, height: (primary ? 17 : ARTICLE_HEIGHT) + (detail ? DETAIL_HEIGHT : 0) };
		if (box.x > width || box.x + box.width < 0 || box.y > height || box.y + box.height < 0) continue;
		if (!primary && featured.some((other) => boxesOverlap(other.box, box))) continue;
		featuredNodes.add(i);
		featured.push({ box, line: { text: title.text, font, color: i === frame.focus ? palette.accent : palette.ink }, detail, alpha: 1 });
		hits.push({ ...box, node: i, region: graph.region[i] });
	}

	let animating = false;
	const placed: PlacedLabel[] = [];
	for (let n = 0; n < layer.labels.length; n++) {
		const label = layer.labels[n];
		const alpha = intervalAlpha(label.interval, k);
		if (alpha === 0) { layer.shown[n] = 1; continue; }
		let sx = label.x * k + camera.x, edge = 1;
		const sy = label.y * k + camera.y + label.offsetY;
		if (label.tier === 0) {
			// Region names slide inward to stay whole at the sides, fading out once their center passes the edge.
			const half = label.width / 2;
			const over = Math.max(EDGE_MARGIN + half - sx, sx + half - (width - EDGE_MARGIN), 0);
			if (over > 0) { sx += sx < width / 2 ? over : -over; edge = Math.max(0, Math.min(1, 2 - over / half)); }
		}
		const box = { x: sx - label.width / 2, y: sy - label.height / 2, width: label.width, height: label.height };
		if (box.x > width || box.x + box.width < 0 || box.y > height || box.y + box.height < 0) { layer.shown[n] = 1; continue; }
		const yields = featuredNodes.has(label.node) || featured.some((item) => boxesOverlap(item.box, box));
		const shown = approach(layer.shown[n], yields ? 0 : 1, elapsedMs);
		layer.shown[n] = shown;
		if (shown !== (yields ? 0 : 1)) animating = true;
		const dim = label.tier === 0 || !fade ? 1 : 1 - POINT_RECEDE * fade[label.node];
		const visible = alpha * shown * dim * edge;
		if (visible < 0.02) continue;
		const color = label.tier === 0 ? palette.regionNames[label.region] : label.tier === 1 ? palette.ink : palette.muted;
		placed.push({ box, line: { text: label.text, font: label.font, color }, alpha: visible, soft: label.tier === 0 });
		if (visible >= 0.35) hits.push({ ...box, node: label.node, region: label.region });
	}
	placed.sort((a, b) => (a.line.font < b.line.font ? -1 : a.line.font > b.line.font ? 1 : 0));
	drawText(context, palette, placed);
	drawText(context, palette, featured);
	return { hits, animating };
}

/** Names first (they are what people aim for), then the nearest point within reach. */
export function hitTest(graph: MapGraph, hits: readonly LabelHit[], camera: Camera, point: { x: number; y: number }, reach: number): { node: number; region: number } | null {
	for (let h = 0; h < hits.length; h++) {
		const box = hits[h];
		if (point.x >= box.x - 2 && point.x <= box.x + box.width + 2 && point.y >= box.y - 2 && point.y <= box.y + box.height + 2) {
			return { node: box.node, region: box.region };
		}
	}
	let best = -1, bestDistance = Infinity;
	for (let i = 0; i < graph.nodes.length; i++) {
		const dx = graph.x[i] * camera.k + camera.x - point.x, dy = graph.y[i] * camera.k + camera.y - point.y;
		const distance = dx * dx + dy * dy;
		const limit = Math.max(reach, pointRadius(graph, i, camera.k) + 4);
		if (distance <= limit * limit && distance < bestDistance) { bestDistance = distance; best = i; }
	}
	return best >= 0 ? { node: best, region: graph.region[best] } : null;
}

/**
 * Eases each node's fade toward its target: lit nodes toward 0, the rest toward `goal`.
 * Returns whether any node is still moving.
 */
export function easeFade(fade: Float32Array, lit: Uint8Array | null, goal: number, elapsedMs: number, durationMs = 240): boolean {
	const step = 1 - Math.exp(-elapsedMs / (durationMs / 3));
	let moving = false;
	for (let i = 0; i < fade.length; i++) {
		const target = lit && lit[i] === 1 ? 0 : goal;
		const value = fade[i];
		if (value === target) continue;
		const next = value + (target - value) * step;
		fade[i] = Math.abs(next - target) < 0.01 ? target : next;
		if (fade[i] !== target) moving = true;
	}
	return moving;
}

/** True when two node lists would produce the same graph, so text-only updates skip a rebuild. */
export function sameGeometry(previous: readonly WorldNode[], next: readonly WorldNode[]): boolean {
	if (previous.length !== next.length) return false;
	for (let i = 0; i < next.length; i++) {
		const a = previous[i], b = next[i];
		if (a === b) continue;
		if (a.title !== b.title || a.x !== b.x || a.y !== b.y || a.region !== b.region || a.hub !== b.hub ||
			a.neighbors.length !== b.neighbors.length) return false;
		if (a.neighbors !== b.neighbors && a.neighbors.some((title, j) => title !== b.neighbors[j])) return false;
	}
	return true;
}

/** Selected and hovered articles with their links. */
export function litNodes(graph: MapGraph, centers: readonly number[]): Uint8Array {
	const lit = new Uint8Array(graph.nodes.length);
	for (const center of centers) {
		if (center < 0) continue;
		lit[center] = 1;
		for (const e of graph.incident[center]) { lit[graph.edgeA[e]] = 1; lit[graph.edgeB[e]] = 1; }
	}
	return lit;
}
