<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
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
	let candidates = $state<Candidate[]>([]);
	let trail = $state<NodeInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let stageW = $state(0);
	let stageH = $state(0);

	const ctx = $derived<DirectionContext | null>(
		center
			? {
					runEras: eraBuckets(center),
					runPlaces: placeTokens(center),
					runCategories: categoryTokenSet(center.categories)
				}
			: null
	);

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

	function polar(angle: number, r: number): { x: number; y: number } {
		const rad = ((angle - 90) * Math.PI) / 180;
		return { x: layout.cx + r * Math.cos(rad), y: layout.cy + r * Math.sin(rad) };
	}

	interface Placed {
		key: string;
		node: Candidate;
		sector: Sector;
		angle: number;
		r: number;
		x: number;
		y: number;
	}

	/** Fan the most prominent candidates into their sectors: candidates arrive in
	 *  reading-order prominence, so each sector fills with the strongest picks.
	 *  Angles are dealt out evenly among the active sectors so two sectors don't
	 *  huddle in one hemisphere while the rest of the circle sits empty. */
	const graph = $derived.by<{ nodes: Placed[]; sectors: { id: Sector; label: string; mid: number }[] }>(
		() => {
			if (!ctx || stageW === 0) return { nodes: [], sectors: [] };
			const bySector = new Map<Sector, Candidate[]>();
			for (const c of candidates) {
				const s = sectorOf(c, ctx);
				bySector.set(s, [...(bySector.get(s) ?? []), c]);
			}
			const active = SECTORS.filter((s) => bySector.has(s.id));
			const slice = 360 / active.length;
			// A lone sector (bare seeds classify almost everything wild) gets the whole
			// circle and a deeper cut so the stage doesn't look starved.
			const cap = active.length === 1 ? 10 : PER_SECTOR_CAP;
			const nodes: Placed[] = [];
			const sectors = active.map((s, si) => {
				const mid = si * slice;
				const list = (bySector.get(s.id) ?? []).slice(0, cap);
				const spread = active.length === 1 ? 320 : Math.min(64, slice * 0.72);
				list.forEach((c, i) => {
					const t = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
					const angle = mid + t * spread;
					const r = layout.R * (i % 2 === 0 ? 1 : 0.66);
					nodes.push({ key: c.title, node: c, sector: s.id, angle, r, ...polar(angle, r) });
				});
				return { ...s, mid };
			});
			return { nodes, sectors };
		}
	);

	/** The center's own era/place tokens, as navigable articles — the zoom-out
	 *  ladder ("1940s", "Belgium", "Europe" are all real Wikipedia pages). */
	const ladder = $derived.by<string[]>(() => {
		if (!center) return [];
		const rungs: string[] = [];
		for (const e of eraBuckets(center)) rungs.push(eraLabel(e));
		for (const p of placeTokens(center)) rungs.push(prettyPlace(p));
		return rungs.slice(0, 5);
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
		// Trail entries keep whatever the node knew when first visited — a bare one
		// (seed, ladder rung) re-hydrates so re-rooting back doesn't lose the visuals.
		if (!node.thumbnail) hydrate(node.title);
		try {
			const res = await fetch(`/api/links?from=${encodeURIComponent(node.title)}`);
			const data = (await res.json()) as { candidates?: Candidate[]; error?: string };
			if (mySeq !== seq) return;
			// Lists/indexes make dead-end nodes — the graph wants subjects, not directories.
			candidates = (data.candidates ?? []).filter(
				(c) => !c.isDisambiguation && !/^(Lists?|Timeline|Index|Outline) of /.test(c.title)
			);
			if (data.error) {
				error = 'Wikipedia is being slow — tap the node again to retry.';
			} else if (candidates.length === 0) {
				error = 'No links surfaced here — zoom out or step back along the trail.';
			}
		} catch {
			if (mySeq !== seq) return;
			candidates = [];
			error = 'Wikipedia is being slow — tap the node again to retry.';
		} finally {
			if (mySeq === seq) loading = false;
		}
	}

	/** Bare titles (the seed, ladder rungs) lack an image/description; fill them
	 *  in from /api/card without disturbing an already-hydrated center. */
	async function hydrate(title: string) {
		try {
			const res = await fetch(`/api/card?title=${encodeURIComponent(title)}`);
			const data = (await res.json()) as {
				article: { title: string; description: string | null; thumbnail: Thumbnail | null } | null;
			};
			if (!data.article || center?.title !== title) return;
			center = {
				...center,
				description: center.description ?? data.article.description,
				thumbnail: center.thumbnail ?? data.article.thumbnail
			};
		} catch {
			// Cosmetic enrichment only — the graph works from the title alone.
		}
	}

	function enterBare(title: string) {
		reRoot({ title, description: null, thumbnail: null, categories: [] });
		hydrate(title);
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
			article. Directions sharpen after your first hop.
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
		{#each graph.sectors as s (s.id)}
			{@const pos = polar(s.mid, layout.R * 1.32)}
			<span
				class="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-medium
					tracking-[0.14em] whitespace-nowrap uppercase
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

		{#each graph.nodes as p (p.key)}
			<div
				class="absolute origin-left border-t border-hair"
				style="left: {layout.cx}px; top: {layout.cy}px; width: {p.r -
					34}px; transform: rotate({p.angle - 90}deg); opacity: 0.7"
				in:fade={{ duration: 350, delay: 120 }}
				out:fade={{ duration: 120 }}
			></div>
		{/each}

		{#each graph.nodes as p (p.key)}
			<button
				type="button"
				onclick={() => reRoot(candToNode(p.node))}
				class="group absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col
					items-center gap-1.5"
				style="left: {p.x}px; top: {p.y}px"
				in:fade={{ duration: 300, delay: 180 }}
				out:fade={{ duration: 120 }}
			>
				{#if p.node.thumbnail}
					<img
						src={p.node.thumbnail.source}
						alt=""
						loading="lazy"
						class="size-11 rounded-full border border-hair object-cover transition-all
							group-hover:border-accent/60 group-active:scale-95"
					/>
				{:else}
					<span
						class="grid size-11 place-items-center rounded-full border border-hair
							bg-surface-2 text-sm text-faint transition-all group-hover:border-accent/60
							group-active:scale-95">{p.node.title.slice(0, 1)}</span
					>
				{/if}
				<span
					class="line-clamp-2 text-center text-xs leading-tight text-muted
						transition-colors group-hover:text-ink">{p.node.title}</span
				>
			</button>
		{/each}

		{#if center}
			<div
				class="pointer-events-none absolute flex w-40 -translate-x-1/2 -translate-y-1/2
					flex-col items-center gap-2 text-center"
				style="left: {layout.cx}px; top: {layout.cy}px"
			>
				{#if center.thumbnail}
					<img
						src={center.thumbnail.source}
						alt=""
						class="size-20 rounded-full border-2 border-accent/60 object-cover shadow-card
							{loading ? 'animate-pulse' : ''}"
					/>
				{:else}
					<span
						class="grid size-20 place-items-center rounded-full border-2 border-accent/60
							bg-surface font-display text-2xl text-ink shadow-card
							{loading ? 'animate-pulse' : ''}">{center.title.slice(0, 1)}</span
					>
				{/if}
				<span class="font-display text-base leading-tight font-semibold text-ink"
					>{center.title}</span
				>
				{#if center.description}
					<span class="line-clamp-2 text-xs text-faint">{center.description}</span>
				{/if}
			</div>
		{/if}

		{#if error}
			<p
				class="absolute bottom-3 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-full
					border border-hair bg-surface/90 px-4 py-2 text-xs text-muted"
				transition:fade
			>
				{error}
			</p>
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
