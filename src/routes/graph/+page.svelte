<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Candidate, Thumbnail } from '$lib/wikipedia/types';
	import {
		classifyDirection,
		eraBuckets,
		placeTokens,
		type DirectionContext
	} from '$lib/feed/directions';
	import { categoryTokenSet } from '$lib/feed/tokens';
	import RelationIcon from '$lib/components/RelationIcon.svelte';

	/**
	 * /graph — zoom-out playground.
	 *
	 * A standalone sandbox for the "explorable knowledge graph" idea: the current
	 * article sits at the center, its real candidate pool (the same /api/links the
	 * feed uses) fans out into five directional sectors, and the center's own era/place
	 * tokens become a tappable "zoom out" ladder (Battle of the Bulge → 1940s →
	 * Belgium). Deliberately not wired into the feed — this route exists to feel
	 * the physics before committing to an ambient minimap.
	 *
	 * Motion model: center and satellites live in ONE keyed list, so a tapped node
	 * keeps its DOM element and glides to the middle via a left/top transition;
	 * satellites shared between consecutive pools glide to their new sector, new
	 * ones fly out from the center, departed ones fade.
	 */

	/** What the graph knows about any node — a candidate, or a bare title. */
	interface NodeInfo {
		title: string;
		description: string | null;
		thumbnail: Thumbnail | null;
		categories: string[];
	}

	type Sector = 'wild' | 'place' | 'deeper' | 'theme' | 'era';

	/** Semantic order for sectors; angles are dealt out dynamically among the
	 *  sectors that actually have members, starting from 12 o'clock (wild leaps
	 *  fly up and out when present). */
	const SECTORS: readonly { id: Sector; label: string }[] = [
		{ id: 'wild', label: 'Wild leap' },
		{ id: 'place', label: 'Same place, another time' },
		{ id: 'deeper', label: 'Deeper in' },
		{ id: 'theme', label: 'Pulling the thread' },
		{ id: 'era', label: 'Meanwhile, elsewhere' }
	];

	const PER_SECTOR_CAP = 4;

	let center = $state<NodeInfo | null>(null);
	/**
	 * Layout snapshot: the satellites plus the context they were classified
	 * against. Updated only when a fetch resolves (or the center's categories
	 * hydrate in), never on tap — so tapping a node glides it to the middle
	 * without the old satellites re-shuffling against a context they weren't
	 * fetched for.
	 */
	let pool = $state<{ ctx: DirectionContext; candidates: Candidate[] } | null>(null);
	let trail = $state<NodeInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let stageW = $state(0);
	let stageH = $state(0);

	function ctxFor(node: NodeInfo): DirectionContext {
		return {
			runEras: eraBuckets(node),
			runPlaces: placeTokens(node),
			runCategories: categoryTokenSet(node.categories)
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

	const layout = $derived({
		cx: stageW / 2,
		cy: stageH * 0.5,
		R: Math.min(stageW, stageH) * 0.37
	});

	/** Narrow stages can't fit two rings of four-per-sector (or the radial sector
	 *  labels) without piling onto the center card — thin the fan instead of
	 *  shrinking it. */
	const compact = $derived(stageW > 0 && stageW < 480);

	/** Compact stages stretch the fan vertically — a phone screen is an ellipse's
	 *  worth of room, not a circle's. */
	function polar(angle: number, r: number): { x: number; y: number } {
		const rad = ((angle - 90) * Math.PI) / 180;
		const stretch = compact ? 1.3 : 1;
		return { x: layout.cx + r * Math.cos(rad), y: layout.cy + r * Math.sin(rad) * stretch };
	}

	interface Placed {
		key: string;
		node: NodeInfo;
		role: 'center' | 'satellite';
		sector: Sector | null;
		x: number;
		y: number;
		/** Edge from the center, derived from the FINAL position so it holds under
		 *  the elliptical stretch: rot is atan2 degrees, len stops short of the avatar. */
		edge: { rot: number; len: number } | null;
		order: number;
	}

	/** Fan the most prominent candidates into their sectors: candidates arrive in
	 *  reading-order prominence, so each sector fills with the strongest picks.
	 *  Angles are dealt out evenly among the active sectors so two sectors don't
	 *  huddle in one hemisphere while the rest of the circle sits empty. */
	const graph = $derived.by<{ nodes: Placed[]; sectors: { id: Sector; label: string; mid: number }[] }>(
		() => {
			if (!center || stageW === 0) return { nodes: [], sectors: [] };
			const nodes: Placed[] = [
				{
					key: center.title,
					node: center,
					role: 'center',
					sector: null,
					x: layout.cx,
					y: layout.cy,
					edge: null,
					order: 0
				}
			];
			const bySector = new Map<Sector, Candidate[]>();
			const seen = new Set([center.title]);
			if (pool) {
				for (const c of pool.candidates) {
					if (seen.has(c.title)) continue;
					seen.add(c.title);
					const s = sectorOf(c, pool.ctx);
					bySector.set(s, [...(bySector.get(s) ?? []), c]);
				}
			}
			const active = SECTORS.filter((s) => bySector.has(s.id));
			if (active.length === 0) return { nodes, sectors: [] };
			const slice = 360 / active.length;
			// A lone sector (an unclassifiable pool) gets the whole circle and a
			// deeper cut so the stage doesn't look starved.
			const cap = active.length === 1 ? (compact ? 6 : 10) : compact ? 2 : PER_SECTOR_CAP;
			let ring = 0;
			let order = 0;
			const sectors = active.map((s, si) => {
				const mid = si * slice;
				const list = (bySector.get(s.id) ?? []).slice(0, cap);
				// Compact fans use half the slice, which (at two per sector) spaces
				// every angular neighbor evenly — including across sector boundaries.
				const spread =
					active.length === 1 ? 320 : compact ? slice * 0.5 : Math.min(64, slice * 0.72);
				list.forEach((c, i) => {
					const t = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
					const angle = mid + t * spread;
					// Ring parity runs across sector boundaries, so angular neighbors —
					// including the last node of one sector and the first of the next —
					// sit at different radii and their labels stay apart. Compact stages
					// keep one ring: the inner one lands on the center card's text.
					const r = layout.R * (compact || ring++ % 2 === 0 ? 1 : 0.72);
					const pos = polar(angle, r);
					nodes.push({
						key: c.title,
						node: candToNode(c),
						role: 'satellite',
						sector: s.id,
						...pos,
						edge: {
							rot: (Math.atan2(pos.y - layout.cy, pos.x - layout.cx) * 180) / Math.PI,
							len: Math.hypot(pos.x - layout.cx, pos.y - layout.cy) - 34
						},
						order: order++
					});
				});
				return { ...s, mid };
			});
			// Stable DOM order across re-roots: keyed elements then move as little as
			// possible, which keeps their left/top transitions gliding instead of
			// restarting. Stacking is handled by z-index, not document order.
			nodes.sort((a, b) => a.key.localeCompare(b.key));
			return { nodes, sectors };
		}
	);

	const edges = $derived(
		graph.nodes.flatMap((p) => (p.edge ? [{ key: p.key, edge: p.edge, order: p.order }] : []))
	);

	/** The center's own era/place tokens, as navigable articles — the zoom-out
	 *  ladder ("1940s", "Belgium", "Europe" are all real Wikipedia pages). */
	const ladder = $derived.by<string[]>(() => {
		if (!center) return [];
		const rungs: string[] = [];
		for (const e of eraBuckets(center)) rungs.push(eraLabel(e));
		for (const p of placeTokens(center)) rungs.push(prettyPlace(p));
		// A place's own name shows up in its tokens — a self-rung isn't a zoom-out.
		const self = center.title.toLowerCase();
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

	function candToNode(c: Candidate): NodeInfo {
		return {
			title: c.title,
			description: c.description,
			thumbnail: c.thumbnail,
			categories: c.categories
		};
	}

	/** New satellites fly outward from the center; a node mounting at the center
	 *  itself (the seed, a trail hop) has nowhere to fly from and just fades in. */
	function flyFromCenter(_el: Element, { x, y, delay = 0 }: { x: number; y: number; delay?: number }) {
		const dx = layout.cx - x;
		const dy = layout.cy - y;
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

	// Monotonic sequence guards stale responses when nodes are tapped in quick succession.
	let seq = 0;

	/** Re-root the graph. `backTo >= 0` re-roots at an existing trail index
	 *  (truncating forward history, browser-back style); otherwise appends. */
	async function reRoot(node: NodeInfo, backTo = -1) {
		const mySeq = ++seq;
		center = node;
		trail = backTo >= 0 ? trail.slice(0, backTo + 1) : [...trail, node];
		loading = true;
		error = null;
		// Bare nodes (the seed, ladder rungs, early trail entries) hydrate their
		// card — and their categories, which is what lets sectorOf classify the
		// first hop instead of fanning everything into "wild".
		if (!node.thumbnail || node.categories.length === 0) hydrate(node.title, mySeq);
		try {
			const res = await fetch(`/api/links?from=${encodeURIComponent(node.title)}`);
			const data = (await res.json()) as { candidates?: Candidate[]; error?: string };
			if (mySeq !== seq) return;
			// Lists/indexes make dead-end nodes — the graph wants subjects, not directories.
			const filtered = (data.candidates ?? []).filter(
				(c) => !c.isDisambiguation && !/^(Lists?|Timeline|Index|Outline) of /.test(c.title)
			);
			// The center may have hydrated categories while this call was in flight —
			// classify against its current state, not the tap-time snapshot.
			pool = { ctx: ctxFor(center ?? node), candidates: filtered };
			if (data.error) {
				error = 'Wikipedia is being slow.';
			} else if (filtered.length === 0) {
				error = 'No links surfaced here — zoom out or step back along the trail.';
			}
		} catch {
			if (mySeq !== seq) return;
			pool = null;
			error = 'Wikipedia is being slow.';
		} finally {
			if (mySeq === seq) loading = false;
		}
	}

	/** Fill in a bare node's card and categories from /api/card. Trail entries
	 *  keep whatever the node knew when first visited, so re-rooting back to a
	 *  bare one re-hydrates rather than losing the visuals. */
	async function hydrate(title: string, forSeq: number) {
		try {
			const res = await fetch(`/api/card?title=${encodeURIComponent(title)}&categories=1`);
			const data = (await res.json()) as {
				article: { title: string; description: string | null; thumbnail: Thumbnail | null } | null;
				categories?: string[];
			};
			const cur = center;
			if (!data.article || !cur || cur.title !== title) return;
			center = {
				...cur,
				description: cur.description ?? data.article.description,
				thumbnail: cur.thumbnail ?? data.article.thumbnail,
				categories: cur.categories.length > 0 ? cur.categories : (data.categories ?? [])
			};
			// Re-classify the satellites against the richer context — on a fresh
			// seed this is the moment the undirected fan resolves into sectors.
			if (forSeq === seq && pool) pool = { ...pool, ctx: ctxFor(center) };
		} catch {
			// Cosmetic enrichment only — the graph works from the title alone.
		}
	}

	function retry() {
		if (center) reRoot(center, trail.length - 1);
	}

	function enterBare(title: string) {
		reRoot({ title, description: null, thumbnail: null, categories: [] });
	}

	onMount(() => {
		enterBare(page.url.searchParams.get('seed')?.trim() || 'Battle of the Bulge');
	});
</script>

<svelte:head>
	<title>Graph playground · Tangent</title>
</svelte:head>

<div class="relative left-1/2 w-screen -translate-x-1/2">
	<header class="mx-auto max-w-3xl px-4 text-center">
		<p class="text-xs font-medium tracking-widest text-faint uppercase">Playground</p>
		<h1 class="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
			The zoom-out graph
		</h1>
		<p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
			Tap a node to travel. Tap a rung on the ladder to zoom out to the era or place holding this
			article.
		</p>

		{#if ladder.length > 0}
			<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
				<span class="text-xs font-medium tracking-widest text-faint uppercase">Zoom out</span>
				{#each ladder as rung (rung)}
					<button
						type="button"
						onclick={() => enterBare(rung)}
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

	<div
		class="relative mt-2 overflow-hidden"
		style="height: calc(100dvh - 19rem); min-height: 460px"
		bind:clientWidth={stageW}
		bind:clientHeight={stageH}
	>
		{#each compact ? [] : graph.sectors as s (s.id)}
			{@const pos = polar(s.mid, layout.R * 1.55)}
			<span
				class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-void/70 px-1.5
					text-[11px] font-medium tracking-[0.14em] whitespace-nowrap uppercase
					transition-all duration-500 ease-out
					{s.id === 'wild' ? 'text-spark' : 'text-faint'}"
				style="left: {Math.min(Math.max(pos.x, 90), stageW - 90)}px; top: {Math.min(
					Math.max(pos.y, 14),
					stageH - 14
				)}px"
				transition:fade={{ duration: 250 }}
			>
				{s.label}
			</span>
		{/each}

		{#each edges as p (p.key)}
			<div
				class="absolute origin-left border-t border-hair transition-all duration-500 ease-out"
				style="left: {layout.cx}px; top: {layout.cy}px; width: {p.edge.len}px;
					transform: rotate({p.edge.rot}deg); opacity: {loading ? 0.3 : 0.7}"
				in:growEdge={{ len: p.edge.len, delay: 60 + p.order * 35 }}
				out:fade={{ duration: 150 }}
			></div>
		{/each}

		{#each graph.nodes as p (p.key)}
			<div
				class="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
				style="left: {p.x}px; top: {p.y}px; z-index: {p.role === 'center' ? 10 : 1};
					opacity: {loading && p.role === 'satellite' ? 0.35 : 1}"
				in:flyFromCenter={{ x: p.x, y: p.y, delay: 60 + p.order * 35 }}
				out:fade={{ duration: 150 }}
			>
				<button
					type="button"
					onclick={() => (p.role === 'satellite' ? reRoot(p.node) : retry())}
					disabled={p.role === 'center' && !error}
					class="group flex flex-col items-center text-center
						{p.role === 'center' ? 'w-44 gap-2' : 'w-24 gap-1.5'}"
				>
					{#if p.node.thumbnail}
						<img
							src={p.node.thumbnail.source}
							alt=""
							loading="lazy"
							class="rounded-full object-cover transition-all duration-500
								{p.role === 'center'
								? 'size-20 border-2 border-accent/60 shadow-card'
								: 'size-11 border border-hair group-hover:border-accent/60 group-active:scale-95'}
								{p.role === 'center' && loading ? 'animate-pulse' : ''}"
						/>
					{:else}
						<span
							class="grid place-items-center rounded-full transition-all duration-500
								{p.role === 'center'
								? 'size-20 border-2 border-accent/60 bg-surface font-display text-2xl text-ink shadow-card'
								: 'size-11 border border-hair bg-surface-2 text-sm text-faint group-hover:border-accent/60 group-active:scale-95'}
								{p.role === 'center' && loading ? 'animate-pulse' : ''}"
							>{p.node.title.slice(0, 1)}</span
						>
					{/if}
					<span
						class="leading-tight transition-all duration-300
							{p.role === 'center'
							? 'font-display text-base font-semibold text-ink'
							: 'line-clamp-2 text-xs text-muted group-hover:text-ink'}">{p.node.title}</span
					>
					{#if p.role === 'center' && p.node.description}
						<span class="line-clamp-2 text-xs text-faint" transition:fade={{ duration: 200 }}
							>{p.node.description}</span
						>
					{/if}
				</button>
			</div>
		{/each}

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
		{#if trail.length > 0}
			<div class="flex items-center gap-2">
				<span class="shrink-0 text-xs font-medium tracking-widest text-faint uppercase">Trail</span>
				<div class="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{#each trail as node, i (`${i}:${node.title}`)}
						{#if i > 0}
							<span class="shrink-0 text-faint" aria-hidden="true">›</span>
						{/if}
						<button
							type="button"
							onclick={() => reRoot(node, i)}
							class="shrink-0 rounded-full px-2 py-1 text-xs whitespace-nowrap transition-colors
								{i === trail.length - 1
								? 'font-medium text-ink'
								: 'text-muted hover:text-ink'}"
						>
							{node.title}
						</button>
					{/each}
				</div>
				{#if center}
					<a
						href={`/?seed=${encodeURIComponent(center.title)}`}
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
