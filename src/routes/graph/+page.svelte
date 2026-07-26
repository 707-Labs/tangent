<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Plus, Minus, Scan } from '@lucide/svelte';
	import type { Candidate, Thumbnail } from '$lib/wikipedia/types';
	import {
		classifyDirection,
		eraBuckets,
		placeTokens,
		type DirectionContext
	} from '$lib/feed/directions';
	import { categoryTokenSet } from '$lib/feed/tokens';
	import { loadTrail, chainTip } from '$lib/feed/trail';
	import RelationIcon from '$lib/components/RelationIcon.svelte';

	/**
	 * /graph — the explorable knowledge canvas.
	 *
	 * A Figma-style infinite canvas: articles are nodes in a persistent world.
	 * Tapping a node expands its real candidate pool (the same /api/links the
	 * feed uses) radially away from its parent; visited neighborhoods stay where
	 * they are, so exploring builds a map instead of replacing a diagram.
	 * Already-charted articles get cross-edges instead of duplicates — the
	 * moment the rabbit hole visibly loops back on itself.
	 *
	 * Camera: scroll / two-finger pans, ctrl-or-cmd+scroll and pinch zoom to the
	 * cursor, drag pans, +/−/fit controls for discoverability. Labels fade out
	 * when zoomed far enough that only the constellation matters.
	 */

	/** What the graph knows about any node — a candidate, or a bare title. */
	interface NodeInfo {
		title: string;
		description: string | null;
		thumbnail: Thumbnail | null;
		categories: string[];
	}

	type Sector = 'wild' | 'place' | 'deeper' | 'theme' | 'era';

	/** Semantic order for sectors; each expansion deals its fan among the sectors
	 *  that actually have members. */
	const SECTORS: readonly { id: Sector; label: string }[] = [
		{ id: 'wild', label: 'Wild leap' },
		{ id: 'place', label: 'Same place, another time' },
		{ id: 'deeper', label: 'Deeper in' },
		{ id: 'theme', label: 'Pulling the thread' },
		{ id: 'era', label: 'Meanwhile, elsewhere' }
	];

	const PER_SECTOR_CAP = 4;
	/** World-unit fan radius for an expansion (outer ring; inner is 0.75×). */
	const RADIUS = 195;
	/** Nodes closer than this in world units are a collision — nudge outward. */
	const MIN_GAP = 80;
	/** Cap on cross-edges recorded per expansion, so a hub article doesn't
	 *  spider-web the whole canvas at once. */
	const CROSS_EDGE_CAP = 6;

	interface WorldNode {
		key: string;
		info: NodeInfo;
		x: number;
		y: number;
		parentKey: string | null;
		sector: Sector | null;
		expanded: boolean;
		/** Mount stagger within its expansion. */
		order: number;
		/** Sector labels of this node's own expansion, shown only while focused. */
		rosette?: { id: Sector; label: string; mid: number }[];
	}

	interface WorldEdge {
		key: string;
		from: string;
		to: string;
	}

	let nodes = $state<WorldNode[]>([]);
	let edges = $state<WorldEdge[]>([]);
	let focusKey = $state<string | null>(null);
	let visited = $state<string[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let stageW = $state(0);
	let stageH = $state(0);
	let stageEl = $state<HTMLDivElement | null>(null);

	/** Camera: screen = world × k + (x, y). */
	let cam = $state({ x: 0, y: 0, k: 1 });
	/** True while the camera is animating programmatically (focus jump / fit) —
	 *  gates the CSS transition so interactive pan/zoom stays 1:1. */
	let camTween = $state(false);
	let camReady = $state(false);
	let panning = $state(false);

	const byKey = $derived(new Map(nodes.map((n) => [n.key, n])));
	const focusNode = $derived(focusKey ? (byKey.get(focusKey) ?? null) : null);

	// Center the seed once the stage has measured itself.
	$effect(() => {
		if (!camReady && stageW > 0 && stageH > 0) {
			cam = { x: stageW / 2, y: stageH / 2, k: stageW < 480 ? 0.85 : 1 };
			camReady = true;
		}
	});

	function ctxFor(info: NodeInfo): DirectionContext {
		return {
			runEras: eraBuckets(info),
			runPlaces: placeTokens(info),
			runCategories: categoryTokenSet(info.categories)
		};
	}

	/** classifyDirection folds "shares both era and place" and "shares nothing"
	 *  into the same null — the graph wants them apart: the former is the
	 *  neighborhood (deeper), the latter a genuine wild leap. */
	function sectorOf(c: Candidate, dctx: DirectionContext): Sector {
		const dir = classifyDirection(c, dctx);
		if (dir !== null) return dir;
		const sharesEra = [...eraBuckets(c)].some((e) => dctx.runEras.has(e));
		const sharesPlace = [...placeTokens(c)].some((p) => dctx.runPlaces.has(p));
		return sharesEra && sharesPlace ? 'deeper' : 'wild';
	}

	function candToNode(c: Candidate): NodeInfo {
		return {
			title: c.title,
			description: c.description,
			thumbnail: c.thumbnail,
			categories: c.categories
		};
	}

	function bare(title: string): NodeInfo {
		return { title, description: null, thumbnail: null, categories: [] };
	}

	function polarFrom(ox: number, oy: number, angleDeg: number, r: number): { x: number; y: number } {
		const rad = (angleDeg * Math.PI) / 180;
		return { x: ox + r * Math.cos(rad), y: oy + r * Math.sin(rad) };
	}

	/** First collision-free spot along the angle, stepping outward. */
	function findSpot(
		ox: number,
		oy: number,
		angleDeg: number,
		r0: number,
		taken: { x: number; y: number }[]
	): { x: number; y: number } {
		let spot = polarFrom(ox, oy, angleDeg, r0);
		for (const bump of [0, 60, 120, 180]) {
			spot = polarFrom(ox, oy, angleDeg, r0 + bump);
			if (!taken.some((t) => Math.hypot(t.x - spot.x, t.y - spot.y) < MIN_GAP)) break;
		}
		return spot;
	}

	function hasEdge(a: string, b: string): boolean {
		return edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
	}

	/** Lay a node's fresh candidates out around it in world space. Children fan
	 *  away from the grandparent so growth pushes outward; the seed gets the full
	 *  circle. Titles already on the canvas become cross-edges, not duplicates. */
	function placeChildren(parentKey: string, candidates: Candidate[]) {
		const parent = byKey.get(parentKey);
		if (!parent) return;
		const dctx = ctxFor(parent.info);

		const onCanvas = new Set(nodes.map((n) => n.key));
		const fresh: Candidate[] = [];
		const crossEdges: WorldEdge[] = [];
		for (const c of candidates) {
			if (c.title === parentKey) continue;
			if (onCanvas.has(c.title)) {
				if (crossEdges.length < CROSS_EDGE_CAP && !hasEdge(parentKey, c.title)) {
					crossEdges.push({ key: `${parentKey}→${c.title}`, from: parentKey, to: c.title });
				}
				continue;
			}
			fresh.push(c);
		}

		const bySector = new Map<Sector, Candidate[]>();
		for (const c of fresh) {
			const s = sectorOf(c, dctx);
			bySector.set(s, [...(bySector.get(s) ?? []), c]);
		}
		const active = SECTORS.filter((s) => bySector.has(s.id));

		const grandparent = parent.parentKey ? byKey.get(parent.parentKey) : null;
		const outAngle = grandparent
			? (Math.atan2(parent.y - grandparent.y, parent.x - grandparent.x) * 180) / Math.PI
			: -90;
		const span = grandparent ? 260 : 360;
		const start = outAngle - span / 2;
		const slice = active.length > 0 ? span / active.length : span;
		const cap = active.length === 1 ? 8 : PER_SECTOR_CAP;

		let ring = 0;
		let order = 0;
		const placed: WorldNode[] = [];
		const newEdges: WorldEdge[] = [...crossEdges];
		const rosette = active.map((s, si) => ({
			id: s.id,
			label: s.label,
			mid: start + slice * (si + 0.5)
		}));
		active.forEach((s, si) => {
			const list = (bySector.get(s.id) ?? []).slice(0, cap);
			const mid = start + slice * (si + 0.5);
			const spread =
				active.length === 1 ? Math.min(300, span * 0.85) : Math.min(64, slice * 0.72);
			list.forEach((c, i) => {
				const t = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
				const angle = mid + t * spread;
				// Ring parity runs across sector boundaries so angular neighbors sit at
				// different radii and their labels stay apart.
				const r0 = ring++ % 2 === 0 ? RADIUS : RADIUS * 0.75;
				const spot = findSpot(parent.x, parent.y, angle, r0, [...nodes, ...placed]);
				placed.push({
					key: c.title,
					info: candToNode(c),
					x: spot.x,
					y: spot.y,
					parentKey,
					sector: s.id,
					expanded: false,
					order: order++
				});
				newEdges.push({ key: `${parentKey}→${c.title}`, from: parentKey, to: c.title });
			});
		});

		nodes = [
			...nodes.map((n) =>
				n.key === parentKey
					? { ...n, expanded: candidates.length > 0 ? true : n.expanded, rosette }
					: n
			),
			...placed
		];
		edges = [...edges, ...newEdges];
	}

	// Monotonic sequence guards stale responses when nodes are tapped in quick succession.
	let seq = 0;

	/** Focus a node: center the camera on it and, if unexplored, expand its
	 *  candidate pool in place. An errored expansion stays un-expanded, so
	 *  tapping again (or Retry) refetches. */
	async function expand(key: string, recenter = true) {
		const node = byKey.get(key);
		if (!node) return;
		focusKey = key;
		error = null;
		if (visited.at(-1) !== key) visited = [...visited, key];
		if (recenter && camReady) tweenCameraTo(node.x, node.y);
		if (node.expanded) return;

		const mySeq = ++seq;
		loading = true;
		try {
			// Bare nodes (the seed, ladder rungs) hydrate card + categories BEFORE
			// classification, so the first hop sectors immediately instead of fanning
			// everything into "wild".
			const needsHydration = !node.info.thumbnail || node.info.categories.length === 0;
			const [res] = await Promise.all([
				fetch(`/api/links?from=${encodeURIComponent(key)}`),
				needsHydration ? hydrate(key) : Promise.resolve()
			]);
			const data = (await res.json()) as { candidates?: Candidate[]; error?: string };
			if (mySeq !== seq) return;
			// Lists/indexes make dead-end nodes — the graph wants subjects, not directories.
			const filtered = (data.candidates ?? []).filter(
				(c) => !c.isDisambiguation && !/^(Lists?|Timeline|Index|Outline) of /.test(c.title)
			);
			if (data.error) {
				error = 'Wikipedia is being slow.';
			} else if (filtered.length === 0) {
				error = 'No links surfaced here — pull a different thread.';
			} else {
				placeChildren(key, filtered);
			}
		} catch {
			if (mySeq === seq) error = 'Wikipedia is being slow.';
		} finally {
			if (mySeq === seq) loading = false;
		}
	}

	/** Fill in a bare node's card and categories from /api/card. */
	async function hydrate(key: string) {
		try {
			const res = await fetch(`/api/card?title=${encodeURIComponent(key)}&categories=1`);
			const data = (await res.json()) as {
				article: { title: string; description: string | null; thumbnail: Thumbnail | null } | null;
				categories?: string[];
			};
			const article = data.article;
			if (!article) return;
			nodes = nodes.map((n) =>
				n.key === key
					? {
							...n,
							info: {
								...n.info,
								description: n.info.description ?? article.description,
								thumbnail: n.info.thumbnail ?? article.thumbnail,
								categories:
									n.info.categories.length > 0 ? n.info.categories : (data.categories ?? [])
							}
						}
					: n
			);
		} catch {
			// Cosmetic enrichment only — the graph works from the title alone.
		}
	}

	function retry() {
		if (focusKey) expand(focusKey, false);
	}

	/** A ladder rung ("1940s", "Belgium") joins the canvas above the focused
	 *  node, connected to it — zooming out grows the map upward. */
	function enterRung(title: string) {
		if (byKey.has(title)) {
			expand(title);
			return;
		}
		const f = focusNode;
		const spot = f
			? findSpot(f.x, f.y, -90, RADIUS * 1.25, nodes)
			: { x: 0, y: 0 };
		nodes = [
			...nodes,
			{ key: title, info: bare(title), x: spot.x, y: spot.y, parentKey: f?.key ?? null, sector: null, expanded: false, order: 0 }
		];
		if (f && !hasEdge(f.key, title)) {
			edges = [...edges, { key: `${f.key}→${title}`, from: f.key, to: title }];
		}
		expand(title);
	}

	/** The focused node's own era/place tokens, as navigable articles — the
	 *  zoom-out ladder ("1940s", "Belgium", "Europe" are all real pages). */
	const ladder = $derived.by<string[]>(() => {
		if (!focusNode) return [];
		const rungs: string[] = [];
		for (const e of eraBuckets(focusNode.info)) rungs.push(eraLabel(e));
		for (const p of placeTokens(focusNode.info)) rungs.push(prettyPlace(p));
		// A place's own name shows up in its tokens — a self-rung isn't a zoom-out.
		const self = focusNode.key.toLowerCase();
		return rungs.filter((r) => r.toLowerCase() !== self).slice(0, 5);
	});

	function prettyPlace(token: string): string {
		if (token === 'ussr') return 'USSR';
		return token.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
	}

	function ordinal(n: number): string {
		const v = n % 100;
		if (v >= 11 && v <= 13) return `${n}th`;
		return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
	}

	function eraLabel(bucket: string): string {
		const m = bucket.match(/^(\d+)c(-bc)?$/);
		return m ? `${ordinal(Number(m[1]))} century${m[2] ? ' BC' : ''}` : bucket;
	}

	// ---------- camera ----------

	let tweenTimer: ReturnType<typeof setTimeout> | undefined;

	function tweenCameraTo(wx: number, wy: number, kOverride?: number) {
		// Reading an expansion at 0.3× is squinting — zoom back in for the jump.
		const k = kOverride ?? (cam.k < 0.7 ? 1 : cam.k);
		camTween = true;
		cam = { x: stageW / 2 - wx * k, y: stageH / 2 - wy * k, k };
		clearTimeout(tweenTimer);
		tweenTimer = setTimeout(() => (camTween = false), 550);
	}

	function zoomAbout(sx: number, sy: number, factor: number) {
		const k = Math.min(2.5, Math.max(0.25, cam.k * factor));
		const f = k / cam.k;
		cam = { x: sx - (sx - cam.x) * f, y: sy - (sy - cam.y) * f, k };
	}

	function zoomButtons(factor: number) {
		camTween = false;
		zoomAbout(stageW / 2, stageH / 2, factor);
	}

	function fitAll() {
		if (nodes.length === 0) return;
		const pad = 150;
		const xs = nodes.map((n) => n.x);
		const ys = nodes.map((n) => n.y);
		const minX = Math.min(...xs) - pad;
		const maxX = Math.max(...xs) + pad;
		const minY = Math.min(...ys) - pad;
		const maxY = Math.max(...ys) + pad;
		const k = Math.min(
			1.2,
			Math.max(0.25, Math.min(stageW / (maxX - minX), stageH / (maxY - minY)))
		);
		camTween = true;
		cam = {
			x: stageW / 2 - ((minX + maxX) / 2) * k,
			y: stageH / 2 - ((minY + maxY) / 2) * k,
			k
		};
		clearTimeout(tweenTimer);
		tweenTimer = setTimeout(() => (camTween = false), 550);
	}

	// Figma semantics: plain scroll pans, ctrl-or-cmd+scroll (and trackpad
	// pinch, which browsers report as ctrl+wheel) zooms to the cursor.
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		camTween = false;
		if (e.ctrlKey || e.metaKey) {
			const rect = stageEl?.getBoundingClientRect();
			if (!rect) return;
			zoomAbout(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
		} else {
			cam = { ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY };
		}
	}

	// Drag pans; two pointers pinch. No pointer capture — capture would retarget
	// the click away from node buttons. Window listeners attach per-drag instead,
	// and dragDist suppresses the click that follows a real pan.
	const pointers = new Map<number, { x: number; y: number }>();
	let dragDist = 0;

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		camTween = false;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 1) {
			dragDist = 0;
			panning = true;
			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
			window.addEventListener('pointercancel', onPointerUp);
		}
	}

	function onPointerMove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (!prev) return;
		const cur = { x: e.clientX, y: e.clientY };
		if (pointers.size === 1) {
			cam = { ...cam, x: cam.x + cur.x - prev.x, y: cam.y + cur.y - prev.y };
			dragDist += Math.hypot(cur.x - prev.x, cur.y - prev.y);
		} else {
			const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
			if (other) {
				const rect = stageEl?.getBoundingClientRect();
				const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
				const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
				if (rect && d0 > 0) {
					zoomAbout(
						(cur.x + other.x) / 2 - rect.left,
						(cur.y + other.y) / 2 - rect.top,
						d1 / d0
					);
				}
				dragDist += 10;
			}
		}
		pointers.set(e.pointerId, cur);
	}

	function onPointerUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) {
			panning = false;
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
			// Reset AFTER the click this pointerup composes has been dispatched,
			// so onNodeClick still sees the drag distance.
			setTimeout(() => (dragDist = 0), 0);
		}
	}

	function onNodeClick(key: string) {
		if (dragDist > 6) return;
		expand(key);
	}

	onDestroy(() => {
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		clearTimeout(tweenTimer);
	});

	// ---------- transitions ----------

	/** New nodes fly outward from their parent; the seed just fades in. */
	function flyIn(_el: Element, { dx, dy, delay = 0 }: { dx: number; dy: number; delay?: number }) {
		return {
			delay,
			duration: 500,
			easing: cubicOut,
			css: (t: number, u: number) =>
				`transform: translate(-50%, -50%) translate(${u * dx}px, ${u * dy}px); opacity: ${t}`
		};
	}

	function growEdge(_el: Element, { len, delay = 0 }: { len: number; delay?: number }) {
		return { delay, duration: 500, easing: cubicOut, css: (t: number) => `width: ${t * len}px` };
	}

	onMount(() => {
		// Seed priority: explicit ?seed= -> the feed's live chain tip (persisted
		// trail) -> the house default. The nav affordance is a plain link, so
		// entering mid-feed opens the map of where you already are.
		const seedTitle =
			page.url.searchParams.get('seed')?.trim() ||
			chainTip(loadTrail()?.trail ?? [])?.title ||
			'Battle of the Bulge';
		nodes = [
			{ key: seedTitle, info: bare(seedTitle), x: 0, y: 0, parentKey: null, sector: null, expanded: false, order: 0 }
		];
		expand(seedTitle, false);
	});
</script>

<svelte:head>
	<title>Graph · Tangent</title>
</svelte:head>

<div class="relative left-1/2 w-screen -translate-x-1/2">
	<header class="mx-auto max-w-3xl px-4 text-center">
		<p class="text-xs font-medium tracking-widest text-faint uppercase">Playground</p>
		<h1 class="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
			The knowledge canvas
		</h1>
		<p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
			Tap a node to chart its connections — the map grows as you go. Drag or scroll to pan,
			pinch or <kbd class="rounded border border-hair bg-surface px-1 text-[11px]">⌘</kbd>+scroll
			to zoom.
		</p>

		{#if ladder.length > 0}
			<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
				<span class="text-xs font-medium tracking-widest text-faint uppercase">Zoom out</span>
				{#each ladder as rung (rung)}
					<button
						type="button"
						onclick={() => enterRung(rung)}
						class="rounded-full border border-hair bg-surface/60 px-3 py-1 text-xs
							font-medium text-muted transition-all hover:border-accent/50 hover:text-ink
							active:scale-95"
					>
						{rung}
					</button>
				{/each}
			</div>
		{/if}
	</header>

	<!-- The pannable viewport. Interactive for pointer pan/zoom only; every node
	     inside is a real button, so keyboard users tab the graph directly. -->
	<div
		bind:this={stageEl}
		bind:clientWidth={stageW}
		bind:clientHeight={stageH}
		role="application"
		aria-label="Knowledge canvas — drag to pan, buttons below to zoom"
		class="relative mt-2 touch-none overflow-hidden select-none
			{panning ? 'cursor-grabbing' : 'cursor-grab'}"
		style="height: calc(100dvh - 19rem); min-height: 460px"
		onpointerdown={onPointerDown}
		onwheel={onWheel}
	>
		<div
			class="absolute top-0 left-0 {camTween ? 'transition-transform duration-500 ease-out' : ''}
				{cam.k < 0.55 ? 'labels-hidden' : ''}"
			style="transform: translate({cam.x}px, {cam.y}px) scale({cam.k}); transform-origin: 0 0"
		>
			{#each edges as e (e.key)}
				{@const a = byKey.get(e.from)}
				{@const b = byKey.get(e.to)}
				{#if a && b}
					{@const len = Math.hypot(b.x - a.x, b.y - a.y) - 30}
					<div
						class="absolute origin-left border-t border-hair"
						style="left: {a.x}px; top: {a.y}px; width: {len}px;
							transform: rotate({Math.atan2(b.y - a.y, b.x - a.x)}rad); opacity: 0.7"
						in:growEdge={{ len, delay: 60 }}
						out:fade={{ duration: 150 }}
					></div>
				{/if}
			{/each}

			{#if focusNode?.rosette}
				{#each focusNode.rosette as s (s.id)}
					{@const pos = polarFrom(focusNode.x, focusNode.y, s.mid, RADIUS * 1.7)}
					<span
						class="node-label absolute -translate-x-1/2 -translate-y-1/2 rounded-full
							bg-void/70 px-1.5 text-[11px] font-medium tracking-[0.14em]
							whitespace-nowrap uppercase
							{s.id === 'wild' ? 'text-spark' : 'text-faint'}"
						style="left: {pos.x}px; top: {pos.y}px"
						transition:fade={{ duration: 250 }}
					>
						{s.label}
					</span>
				{/each}
			{/if}

			{#each nodes as n (n.key)}
				{@const isFocus = n.key === focusKey}
				{@const parent = n.parentKey ? byKey.get(n.parentKey) : null}
				<div
					class="absolute -translate-x-1/2 -translate-y-1/2"
					style="left: {n.x}px; top: {n.y}px; z-index: {isFocus ? 10 : 1}"
					in:flyIn={{
						dx: (parent?.x ?? n.x) - n.x,
						dy: (parent?.y ?? n.y) - n.y,
						delay: 60 + n.order * 35
					}}
					out:fade={{ duration: 150 }}
				>
					<button
						type="button"
						onclick={() => onNodeClick(n.key)}
						class="group flex flex-col items-center text-center
							{isFocus ? 'w-44 gap-2' : 'w-24 gap-1.5'}"
					>
						{#if n.info.thumbnail}
							<img
								src={n.info.thumbnail.source}
								alt=""
								loading="lazy"
								draggable="false"
								class="rounded-full object-cover transition-all duration-500
									{isFocus
									? 'size-16 border-2 border-accent/60 shadow-card'
									: 'size-11 border border-hair group-hover:border-accent/60 group-active:scale-95'}
									{isFocus && loading ? 'animate-pulse' : ''}
									{n.expanded || isFocus ? '' : 'opacity-80'}"
							/>
						{:else}
							<span
								class="grid place-items-center rounded-full transition-all duration-500
									{isFocus
									? 'size-16 border-2 border-accent/60 bg-surface font-display text-xl text-ink shadow-card'
									: 'size-11 border border-hair bg-surface-2 text-sm text-faint group-hover:border-accent/60 group-active:scale-95'}
									{isFocus && loading ? 'animate-pulse' : ''}"
								>{n.key.slice(0, 1)}</span
							>
						{/if}
						<span
							class="node-label leading-tight transition-all duration-300
								{isFocus
								? 'font-display text-base font-semibold text-ink'
								: 'line-clamp-2 text-xs text-muted group-hover:text-ink'}">{n.key}</span
						>
						{#if isFocus && n.info.description}
							<span class="node-label line-clamp-2 text-xs text-faint">{n.info.description}</span>
						{/if}
					</button>
				</div>
			{/each}
		</div>

		<!-- Camera controls: discoverable stand-ins for pinch / modifier-scroll. -->
		<div class="absolute right-3 bottom-3 z-20 flex flex-col gap-1">
			<button
				type="button"
				onclick={() => zoomButtons(1.3)}
				aria-label="Zoom in"
				class="grid size-9 place-items-center rounded-full border border-hair bg-surface/90
					text-muted transition-colors hover:text-ink"
			>
				<Plus class="size-4" aria-hidden="true" />
			</button>
			<button
				type="button"
				onclick={() => zoomButtons(0.77)}
				aria-label="Zoom out"
				class="grid size-9 place-items-center rounded-full border border-hair bg-surface/90
					text-muted transition-colors hover:text-ink"
			>
				<Minus class="size-4" aria-hidden="true" />
			</button>
			<button
				type="button"
				onclick={fitAll}
				aria-label="Fit the whole map"
				class="grid size-9 place-items-center rounded-full border border-hair bg-surface/90
					text-muted transition-colors hover:text-ink"
			>
				<Scan class="size-4" aria-hidden="true" />
			</button>
		</div>

		{#if error}
			<div
				class="absolute bottom-3 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 items-center
					gap-3 rounded-full border border-hair bg-surface/90 px-4 py-2"
				transition:fade
			>
				<span class="text-xs text-muted">{error}</span>
				<button
					type="button"
					onclick={retry}
					class="text-xs font-medium whitespace-nowrap text-accent transition-colors hover:text-ink"
				>
					Retry
				</button>
			</div>
		{/if}
	</div>

	<footer class="mx-auto max-w-3xl px-4 pb-4">
		{#if visited.length > 0}
			<div class="flex items-center gap-2">
				<span class="shrink-0 text-xs font-medium tracking-widest text-faint uppercase">Trail</span>
				<div class="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{#each visited as title, i (`${i}:${title}`)}
						{#if i > 0}
							<span class="shrink-0 text-faint" aria-hidden="true">›</span>
						{/if}
						<button
							type="button"
							onclick={() => expand(title)}
							class="shrink-0 rounded-full px-2 py-1 text-xs whitespace-nowrap transition-colors
								{title === focusKey ? 'font-medium text-ink' : 'text-muted hover:text-ink'}"
						>
							{title}
						</button>
					{/each}
				</div>
				{#if focusKey}
					<a
						href={`/?seed=${encodeURIComponent(focusKey)}`}
						class="inline-flex shrink-0 items-center gap-1.5 rounded-full border
							border-spark/30 bg-spark/5 px-3 py-1.5 text-xs font-medium text-spark
							transition-all hover:bg-spark/10 active:scale-95"
					>
						<RelationIcon relation="dive" class="size-3.5" />
						Start the feed here
					</a>
				{/if}
			</div>
		{/if}
	</footer>
</div>

<style>
	.node-label {
		transition: opacity 200ms ease;
	}
	.labels-hidden .node-label {
		opacity: 0;
	}
</style>
