<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { Plus, Minus, Scan, X, Search, ArrowRight, RotateCw } from '@lucide/svelte';
	import type { Article, SearchResult } from '$lib/wikipedia/types';
	import { reader } from '$lib/reader/readerState.svelte';
	import ArticleReader from '$lib/components/ArticleReader.svelte';
	import { loadTrail, chainTip } from '$lib/feed/trail';
	import { graphAcquisitions } from '$lib/graph/acquire';
	import { parseAtlas, type AtlasArticle } from '$lib/graph/atlas';
	import { REGIONS, initialWorld, atlasWorld, localSearch, hitNode, importNode, canonicalizeNode, appendVisit, addNeighborhood, project, visibleNodes, visibleLabels, overviewCamera, centeredCamera, zoomCamera, type Camera, type WorldNode } from '$lib/graph/world';

	let nodes = $state.raw(initialWorld());
	let atlasArticles = $state.raw(new Map<string, AtlasArticle>());
	let atlasLoading = $state(true);
	let atlasReady: Promise<void> = Promise.resolve();
	let atlasController: AbortController | undefined;
	let canvas = $state<HTMLCanvasElement | null>(null);
	let themeVersion = $state(0);
	let drawFrame = 0;
	let hoveredNode = $state.raw<WorldNode | null>(null);
	let selected = $state<string | null>(null);
	let trail = $state<string[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let article = $state<Article | null>(null);
	let summaryError = $state(false);
	let width = $state(0);
	let height = $state(0);
	let stage = $state<HTMLDivElement | null>(null);
	let camera = $state<Camera>({ x: 0, y: 0, k: 0.12 });
	let dragging = $state(false);
	let showingOverview = true;
	let disposed = false;
	let selectionVersion = 0;
	const acquisitions = graphAcquisitions();
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let prefetchActive = 0;
	const aliases = new Map<string, string>();
	function canonicalTitle(title: string) { return aliases.get(title) ?? title; }

	const byTitle = $derived(new Map(nodes.map((node) => [node.title, node])));
	const focus = $derived(selected ? byTitle.get(selected) ?? null : null);
	const viewport = $derived({ width, height });
	const visible = $derived(visibleNodes(nodes, camera, viewport, selected));
	const regionLabels = $derived(camera.k < 0.3 ? REGIONS.map((region) => ({ region, point: project(region, camera) }))
		.filter(({ point }) => point.x > -120 && point.x < width + 120 && point.y > -50 && point.y < height + 50) : []);
	const labels = $derived.by(() => {
		const reserved = regionLabels.map(({ region, point }) => {
			const labelWidth = region.label.length * 10 + 20;
			return { x: point.x - labelWidth / 2, y: point.y - 79, width: labelWidth, height: 44 };
		});
		if (focus) {
			const point = project(focus, camera);
			reserved.push({ x: point.x - 38, y: point.y - 38, width: 76, height: 76 });
		}
		return visibleLabels(visible, camera, selected, reserved);
	});
	const connections = $derived(focus?.neighbors.map((title) => byTitle.get(title)).filter((node): node is WorldNode => !!node) ?? []);
	const lines = $derived.by(() => {
		const pairs: { from: WorldNode; to: WorldNode; trail: boolean }[] = [];
		if (focus) for (const title of focus.neighbors.slice(0, 30)) {
			const destination = byTitle.get(title);
			if (destination) pairs.push({ from: focus, to: destination, trail: false });
		}
		for (let index = 1; index < trail.length; index++) {
			const from = byTitle.get(trail[index - 1]);
			const to = byTitle.get(trail[index]);
			if (from && to && from !== to) pairs.push({ from, to, trail: true });
		}
		return pairs.map((pair) => ({ ...pair, a: project(pair.from, camera), b: project(pair.to, camera) }));
	});
	const nightColors = ['#d5a76b', '#88a58a', '#9ca5ab', '#d99786', '#c8a287', '#bfb39c', '#b5b17b'];
	const dayColors = ['#805013', '#386a51', '#675943', '#795d47', '#8b504c', '#4c675d', '#636338'];
	$effect(() => {
		const target = canvas;
		const frameNodes = nodes;
		const frameCamera = camera;
		const frameViewport = viewport;
		void themeVersion;
		if (!target || width <= 0 || height <= 0) return;
		cancelAnimationFrame(drawFrame);
		drawFrame = requestAnimationFrame(() => drawUniverse(target, frameNodes, frameCamera, frameViewport));
	});
	function drawUniverse(target: HTMLCanvasElement, points: readonly WorldNode[], view: Camera, size: { width: number; height: number }) {
		const context = target.getContext('2d');
		if (!context) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		if (target.width !== Math.round(size.width * dpr) || target.height !== Math.round(size.height * dpr)) {
			target.width = Math.round(size.width * dpr);
			target.height = Math.round(size.height * dpr);
		}
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, size.width, size.height);
		const light = document.documentElement.dataset.theme === 'daylight';
		const regionColors = light ? dayColors : nightColors;
		for (let index = 0; index < REGIONS.length; index++) {
			const region = REGIONS[index];
			const center = project(region, view);
			const radius = Math.max(75, 1150 * view.k);
			const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
			glow.addColorStop(0, regionColors[index] + (light ? '14' : '18'));
			glow.addColorStop(1, regionColors[index] + '00');
			context.fillStyle = glow;
			context.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
			context.beginPath();
			for (const node of points) {
				if (node.region !== region.id) continue;
				const point = project(node, view);
				if (point.x < -5 || point.y < -5 || point.x > size.width + 5 || point.y > size.height + 5) continue;
				const r = node.hub ? 4 : Math.max(1.05, Math.min(2.5, view.k * 3));
				context.moveTo(point.x + r, point.y);
				context.arc(point.x, point.y, r, 0, Math.PI * 2);
			}
			context.fillStyle = regionColors[index];
			context.globalAlpha = light ? 0.85 : 0.8;
			context.fill();
			context.globalAlpha = 1;
		}
	}
	async function loadAtlas() {
		atlasController = new AbortController();
		const deadline = setTimeout(() => atlasController?.abort(), 12_000);
		try {
			const response = await fetch('/graph/atlas.v1.json', { signal: atlasController.signal });
			if (!response.ok) throw new Error('Atlas unavailable');
			const data = parseAtlas(await response.json());
			if (!data || disposed) return;
			for (const [alias, destination] of Object.entries(data.aliases)) aliases.set(alias, destination);
			atlasArticles = new Map(data.nodes.map((node) => [node.title, node]));
			let existing = nodes;
			for (const node of existing) {
				const destination = atlasArticles.get(canonicalTitle(node.title));
				if (destination && destination.title !== node.title) existing = canonicalizeNode(existing, node.title, destination);
			}
			nodes = atlasWorld(data.nodes, existing);
			if (selected) {
				selected = canonicalTitle(selected);
				trail = trail.reduce<string[]>((visits, visit) => appendVisit(visits, canonicalTitle(visit)), []);
				const node = nodes.find((item) => item.title === selected);
				if (node && !showingOverview) move(centeredCamera(node, viewport, camera.k), false);
			}
		} catch { /* Existing live exploration remains available when the static atlas fails. */ }
		finally { clearTimeout(deadline); if (!disposed) atlasLoading = false; }
	}

	// Canvas points, DOM labels, and hit testing share the same immediate camera.
	// Coordinate CSS transitions would separate labels from their actual points.
	function move(next: Camera, _smooth = false) { camera = next; }
	function overview() { closeSelection(); showingOverview = true; move(overviewCamera(viewport)); }
	function showRegion(id: string) {
		const region = REGIONS.find((item) => item.id === id);
		if (!region) return;
		showingOverview = false;
		closeSelection();
		const k = Math.min(0.7, Math.max(0.09, Math.min((width - 60) / 2200, (height - 150) / 2200)));
		move({ x: width / 2 - region.x * k, y: height / 2 - region.y * k, k });
	}
	function center(node: WorldNode, zoom = Math.max(0.75, camera.k)) {
		showingOverview = false;
		const k = Math.min(1.3, zoom);
		move(centeredCamera(node, viewport, k));
	}
	function zoom(factor: number, x = width / 2, y = height / 2) {
		move(zoomCamera(camera, factor, { x, y }), false);
	}

	// Only two speculative acquisitions may be active. Hover and one idle pair share the budget.
	function prefetch(title: string) {
		if (disposed || atlasLoading || atlasArticles.has(canonicalTitle(title)) || prefetchActive >= 2 || acquisitions.links.peek(title)) return;
		prefetchActive++;
		void acquisitions.links.get(title).catch(() => {}).finally(() => { prefetchActive--; });
	}
	function hover(title: string) {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => prefetch(title), 420);
	}
	async function loadSelection(title: string, version: number) {
		loading = true;
		error = null;
		summaryError = false;
		if (atlasLoading) await atlasReady;
		if (disposed || version !== selectionVersion) return;
		title = canonicalTitle(title);
		const stored = atlasArticles.get(title);
		if (stored) { article = stored; loading = false; return; }
		article = acquisitions.cards.peek(title) ?? null;
		void acquisitions.cards.get(title).then((value) => {
			if (disposed || version !== selectionVersion) return;
			article = atlasArticles.get(value.title) ?? value;
			if (atlasArticles.has(value.title)) clearTimeout(idleTimer);
			const previous = canonicalTitle(title);
			const previousNode = nodes.find((node) => node.title === previous);
			for (const [alias, destination] of aliases) if (destination === previous) aliases.set(alias, value.title);
			aliases.set(title, value.title);
			aliases.set(previous, value.title);
			nodes = canonicalizeNode(nodes, previous, { title: value.title, description: value.description, thumbnail: value.thumbnail });
			selected = value.title;
			const mergedNode = nodes.find((node) => node.title === value.title);
			// An earlier canonical placement may win a redirect merge. Keep selection in
			// view only when it actually moved; ordinary metadata never resets the camera.
			if (previousNode && mergedNode && (previousNode.x !== mergedNode.x || previousNode.y !== mergedNode.y)) {
				move(centeredCamera(mergedNode, viewport, camera.k));
			}
			trail = trail.reduce<string[]>((visits, visit) => appendVisit(visits, canonicalTitle(visit)), []);
		}).catch(() => { if (!disposed && version === selectionVersion) summaryError = true; });
		try {
			const candidates = await acquisitions.links.get(title);
			if (disposed || version !== selectionVersion) return;
			if (nodes.find((node) => node.title === canonicalTitle(title))?.atlas) return;
			nodes = addNeighborhood(nodes, canonicalTitle(title), candidates.map((candidate) => ({ ...candidate, title: canonicalTitle(candidate.title) })));
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				if (version !== selectionVersion || disposed) return;
				for (const candidate of candidates.slice(0, 2)) prefetch(candidate.title);
			}, 1400);
		} catch (failure) {
			if (!disposed && version === selectionVersion) error = failure instanceof Error ? failure.message : 'Connections unavailable. Try again.';
		} finally {
			if (!disposed && version === selectionVersion) loading = false;
		}
	}
	function select(info: SearchResult | WorldNode) {
		info = { ...info, title: canonicalTitle(info.title) };
		reader.close();
		clearTimeout(idleTimer);
		nodes = importNode(nodes, info);
		selected = info.title;
		trail = appendVisit(trail, info.title);
		const node = nodes.find((item) => item.title === info.title)!;
		center(node);
		searchOpen = false;
		article = atlasArticles.get(info.title) ?? null;
		void loadSelection(info.title, ++selectionVersion);
	}
	function dive(title: string) {
		title = canonicalTitle(title);
		reader.close();
		nodes = importNode(nodes, { title, description: null, thumbnail: null }, focus ?? undefined);
		select(nodes.find((node) => node.title === title)!);
	}
	function closeSelection() {
		selectionVersion++;
		selected = null;
		reader.close();
		loading = false;
		clearTimeout(idleTimer);
	}

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let resultsQuery = $state('');
	let searching = $state(false);
	let searchError = $state(false);
	let searchOpen = $state(false);
	let highlighted = $state(-1);
	const localResults = $derived(localSearch(nodes, query, aliases));
	const currentResults = $derived.by(() => {
		const merged = new Map(localResults.map((result) => [result.title, result]));
		if (resultsQuery === query.trim()) for (const result of results) {
			const title = canonicalTitle(result.title);
			if (!merged.has(title)) merged.set(title, { ...result, title });
		}
		return [...merged.values()].slice(0, 12);
	});
	$effect(() => {
		if (searchOpen && highlighted >= 0) document.getElementById(`map-result-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
	});
	$effect(() => {
		const value = query.trim();
		results = [];
		resultsQuery = '';
		highlighted = -1;
		searchError = false;
		if (value.length < 2) { searching = false; return; }
		const controller = new AbortController();
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: controller.signal });
				if (!response.ok) throw new Error('Search unavailable');
				const payload = await response.json() as { results: SearchResult[] };
				if (controller.signal.aborted) return;
				results = payload.results;
				resultsQuery = value;
			} catch {
				if (!controller.signal.aborted) searchError = true;
			} finally { if (!controller.signal.aborted) searching = false; }
		}, 230);
		return () => { clearTimeout(timer); controller.abort(); };
	});
	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const result = currentResults[highlighted >= 0 ? highlighted : 0];
		// Use actual search results; don't invent a clickable article from arbitrary text.
		if (result) select(result);
		else searchOpen = true;
	}

	interface Pointer { x: number; y: number; nodeButton: boolean }
	const pointers = new Map<number, Pointer>();
	let pinchDistance = 0;
	let moved = false;
	let blockClickUntil = 0;
	function pointerDown(event: PointerEvent) {
		if (event.button !== 0 || (event.target as HTMLElement).closest('.map-overlay')) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, nodeButton: !!(event.target as HTMLElement).closest('[data-node]') });
		moved = pointers.size > 1;
		pinchDistance = 0;
		// Node buttons retain ordinary clicks; capture only background drags initially.
		if (!(event.target as HTMLElement).closest('[data-node]')) stage?.setPointerCapture(event.pointerId);
	}
	function pointerMove(event: PointerEvent) {
		const prior = pointers.get(event.pointerId);
		if (!stage) return;
		if (!prior) {
			if ((event.target as HTMLElement).closest('.map-overlay, [data-node]')) { hoveredNode = null; return; }
			const rect = stage.getBoundingClientRect();
			const node = hitNode(nodes, camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
			if (node?.title !== hoveredNode?.title) { hoveredNode = node; if (node) hover(node.title); }
			return;
		}
		hoveredNode = null;
		const dx = event.clientX - prior.x;
		const dy = event.clientY - prior.y;
		if (Math.hypot(dx, dy) > 2) {
			moved = true;
			dragging = true;
			stage.setPointerCapture(event.pointerId);
		}
		pointers.set(event.pointerId, { ...prior, x: event.clientX, y: event.clientY });
		const active = [...pointers.values()];
		if (active.length === 2) {
			const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y);
			const rect = stage.getBoundingClientRect();
			if (pinchDistance > 0) zoom(distance / pinchDistance, (active[0].x + active[1].x) / 2 - rect.left, (active[0].y + active[1].y) / 2 - rect.top);
			pinchDistance = distance;
		} else { move({ ...camera, x: camera.x + dx, y: camera.y + dy }, false); }
	}
	function pointerUp(event: PointerEvent) {
		const prior = pointers.get(event.pointerId);
		pointers.delete(event.pointerId);
		pinchDistance = 0;
		if (moved) blockClickUntil = performance.now() + 180;
		if (pointers.size === 0) dragging = false;
		if (prior && !prior.nodeButton && !moved && pointers.size === 0 && event.type === 'pointerup' && stage) {
			const rect = stage.getBoundingClientRect();
			const node = hitNode(nodes, camera, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.pointerType === 'touch' ? 22 : 14);
			if (node) select(node);
		}
	}
	function wheel(event: WheelEvent) {
		if ((event.target as HTMLElement).closest('.map-overlay')) return;
		event.preventDefault();
		const rect = stage!.getBoundingClientRect();
		if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.008), event.clientX - rect.left, event.clientY - rect.top);
		else move({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY }, false);
	}
	function keyboard(event: KeyboardEvent) {
		if ((event.target as HTMLElement).closest('input, button:not(.map-navigation), a, .map-overlay')) return;
		const offsets: Record<string, [number, number]> = { ArrowLeft: [90, 0], ArrowRight: [-90, 0], ArrowUp: [0, 90], ArrowDown: [0, -90] };
		if (offsets[event.key]) { event.preventDefault(); const [x, y] = offsets[event.key]; move({ ...camera, x: camera.x + x, y: camera.y + y }, false); }
		else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.35); }
		else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.35); }
		else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); overview(); }
		else if (event.key === 'Escape') closeSelection();
	}
	onMount(() => {
		reader.close();
		atlasReady = loadAtlas();
		const themeObserver = new MutationObserver(() => { themeVersion++; });
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		const requested = page.url.searchParams.get('seed');
		const stored = loadTrail();
		const title = requested ?? (stored ? chainTip(stored.trail)?.title : null);
		if (title) select({ title, description: null, thumbnail: null });
		const target = stage;
		target?.addEventListener('wheel', wheel, { passive: false });
		return () => { target?.removeEventListener('wheel', wheel); themeObserver.disconnect(); };
	});
	$effect(() => {
		const resized = { width, height };
		if (width <= 0 || height <= 0) return;
		// Only viewport changes reframe; arriving metadata and camera gestures never do.
		untrack(() => move(showingOverview || !focus ? overviewCamera(resized) : centeredCamera(focus, resized, camera.k), false));
	});
	onDestroy(() => {
		disposed = true;
		selectionVersion++;
		acquisitions.dispose();
		atlasController?.abort();
		cancelAnimationFrame(drawFrame);
		clearTimeout(hoverTimer);
		clearTimeout(idleTimer);
		reader.close();
	});
</script>

<svelte:head><title>Article map · Tangent</title></svelte:head>

<!-- A native background control provides keyboard navigation without changing screen-reader modes. -->
<div bind:this={stage} bind:clientWidth={width} bind:clientHeight={height}
	class="universe" class:dragging class:reader-open={reader.isOpen} role="region" aria-label="Article map"
	onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}>
	<button type="button" class="map-navigation" aria-label="Navigate article map. Arrow keys pan, plus and minus zoom, Home shows all topic regions." onkeydown={keyboard}></button>
	<canvas bind:this={canvas} class="point-cloud" aria-hidden="true"></canvas>
	<svg class="connections" width={width} height={height} aria-hidden="true">
		{#each lines as line}<line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} class:trail-line={line.trail} />{/each}
	</svg>
	{#each regionLabels as { region, point }}
		<button type="button" class="region-name map-overlay" style="left:{point.x}px;top:{point.y - 35}px" onclick={() => showRegion(region.id)} aria-label={`Explore ${region.label}`}>{region.label}</button>
	{/each}
	{#each visible as item (item.node.title)}
		{@const node = item.node}
		{#if labels.has(node.title) || node.hub || node.title === selected}
			<button type="button" data-node={node.title} class="world-node" class:focused={node.title === selected} class:landmark={node.hub}
				style="left:{item.x}px;top:{item.y}px" aria-label={node.title} aria-pressed={node.title === selected}
				title={node.title} onclick={() => { if (performance.now() >= blockClickUntil) select(node); }}
				onpointerenter={() => hover(node.title)} onpointerleave={() => clearTimeout(hoverTimer)}>
				<span class="orb" class:visited={trail.includes(node.title)}></span>
				{#if labels.has(node.title)}<span class="node-label">{node.title}</span>{/if}
			</button>
		{/if}
	{/each}

	<div class="map-overlay search-panel">
		<form onsubmit={submitSearch}>
			<Search size={18} aria-hidden="true" />
			<input bind:value={query} placeholder="Find any Wikipedia article" aria-label="Search all Wikipedia articles"
				role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && query.trim().length >= 2}
				aria-controls={searchOpen && query.trim().length >= 2 ? 'map-search-results' : undefined}
				aria-activedescendant={searchOpen && currentResults[highlighted] ? `map-result-${highlighted}` : undefined}
				onfocus={() => { searchOpen = true; }} oninput={() => { searchOpen = true; }}
				onblur={() => { searchOpen = false; highlighted = -1; }}
				onkeydown={(event) => {
					if (event.key === 'ArrowDown') { event.preventDefault(); searchOpen = true; highlighted = Math.min(highlighted + 1, currentResults.length - 1); }
					else if (event.key === 'ArrowUp') { event.preventDefault(); highlighted = Math.max(-1, highlighted - 1); }
					else if (event.key === 'Escape') { searchOpen = false; highlighted = -1; }
				}} />
		</form>
		{#if searchOpen && query.trim().length >= 2}
			<ul id="map-search-results" role="listbox">
				{#if !currentResults.length && searching}<li role="presentation" class="search-status">Searching Wikipedia…</li>
				{:else if !currentResults.length && searchError}<li role="presentation" class="search-status">Search unavailable. Try another query.</li>
				{:else if !currentResults.length}<li role="presentation" class="search-status">No matches. Try another title.</li>
				{:else}{#each currentResults as result, index (result.title)}
					<li id="map-result-{index}" role="option" aria-selected={index === highlighted}>
						<button type="button" tabindex="-1" class:highlighted={index === highlighted}
							onpointerdown={(event) => event.preventDefault()} onclick={() => select(result)}>
							<strong>{result.title}</strong><span>{result.description ?? 'Wikipedia article'}</span>
						</button>
					</li>
				{/each}{/if}
			</ul>
		{/if}
		<p class="sr-only" role="status">{searching ? 'Searching Wikipedia' : searchError ? 'Search unavailable' : `${currentResults.length} results`}</p>
	</div>
	<div class="map-overlay controls">
		<button type="button" onclick={overview} title="Show topic regions"><Scan size={18} aria-hidden="true" /><span>Overview</span></button>
		<button type="button" onclick={() => { if (focus) center(focus); else overview(); }} aria-label="Recenter selected article" title="Recenter"><RotateCw size={18} /></button>
		<button type="button" onclick={() => zoom(1.35)} aria-label="Zoom in" title="Zoom in"><Plus size={18} /></button>
		<button type="button" onclick={() => zoom(1 / 1.35)} aria-label="Zoom out" title="Zoom out"><Minus size={18} /></button>
	</div>
	{#if !focus}
		<div class="map-overlay orientation"><h1>Explore Wikipedia</h1><p>{atlasLoading ? 'Opening the map…' : `${(atlasArticles.size || nodes.length).toLocaleString()} articles to explore. Search all Wikipedia.`}</p><p class="gesture-help">Choose a region. Drag to pan. Pinch or Ctrl + scroll to zoom.</p></div>
	{/if}
	{#if hoveredNode && !reader.isOpen}<div class="map-overlay point-preview" aria-hidden="true"><strong>{hoveredNode.title}</strong><span>{hoveredNode.description ?? 'Wikipedia article'}</span></div>{/if}
	{#if focus && !reader.isOpen}
		{#key focus.title}
		<aside class="map-overlay detail" aria-label="Selected article">
			<button type="button" class="detail-close" onclick={closeSelection} aria-label="Close selected article"><X size={18} /></button>
			<p class="detail-region">Wikipedia article</p>
			<h1>{focus.title}</h1>
			{#if article?.extract}<p class="summary">{article.extract}</p>
			{:else if focus.description}<p class="summary">{focus.description}</p>
			{:else if summaryError}<p class="summary">Summary unavailable. You can still open the article.</p>
			{:else}<p class="summary">Loading summary…</p>{/if}
			<div class="detail-actions"><button type="button" onclick={() => reader.open(article?.title ?? focus!.title)}>Read article <ArrowRight size={16} /></button>
				<a href={`/?seed=${encodeURIComponent(article?.title ?? focus.title)}`}>Start tangent here</a></div>
			<h2>Connections</h2>
			{#if loading}<p class="local-status" role="status">Finding connections…</p>{/if}
			{#if error}<p class="local-status" role="alert">{error}</p><button class="retry" type="button" onclick={() => { if (selected) void loadSelection(selected, ++selectionVersion); }}>Retry connections</button>{/if}
			{#if connections.length}<div class="connection-list">{#each connections.slice(0, 20) as node (node.title)}<button type="button" onclick={() => select(node)} onpointerenter={() => hover(node.title)} onpointerleave={() => clearTimeout(hoverTimer)}>{node.title}<ArrowRight size={14} /></button>{/each}</div>{/if}
			<p class="map-note">Solid lines show discovered connections. Dotted lines trace your visits. Topic regions are starting points.</p>
		</aside>
		{/key}
	{/if}
	{#if reader.isOpen}<div class="map-overlay graph-reader"><ArticleReader onDive={dive} /></div>{/if}
	{#if trail.length > 1 && !reader.isOpen}<nav class="map-overlay trail" aria-label="Map trail">{#each trail as title}<button type="button" class:current={selected === title} onclick={() => dive(title)}>{title}</button>{/each}</nav>{/if}
	<div class="map-overlay attribution"><a href="https://en.wikipedia.org" target="_blank" rel="noopener noreferrer">Wikipedia</a><span> · </span><a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a></div>
</div>

<style>
	/* Clipping must not create a scroll container: focusing a reader link or disclosure
	   otherwise scrolls outlying map labels and pulls the reader beneath the app header. */
	.universe { position: relative; width: 100%; height: calc(100dvh - var(--app-header-height, 69px)); overflow: clip; background: var(--color-void); touch-action: none; isolation: isolate; outline-offset: -3px; }
	.universe.dragging { cursor: grabbing; }
	.map-navigation { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; border: 0; cursor: grab; }
	.map-navigation:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -3px; }
	.point-cloud, .connections { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.connections line { stroke: var(--color-hair-strong); stroke-width: 1; opacity: .45; }
	.connections line.trail-line { stroke: var(--color-accent); opacity: .6; stroke-dasharray: 3 5; }
	.world-node { position: absolute; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; transform: translate(-50%, -50%); padding: 0; background: transparent; border: 0; color: var(--color-ink); z-index: 2; }
	.orb { display: block; width: 11px; height: 11px; border-radius: 50%; background: var(--color-muted); border: 1px solid var(--color-hair-strong); box-shadow: 0 0 15px color-mix(in srgb, var(--color-muted) 15%, transparent); transition: background .15s, transform .15s; }
	.landmark .orb { width: 23px; height: 23px; background: var(--color-spark); box-shadow: 0 0 35px color-mix(in srgb, var(--color-spark) 22%, transparent); }
	.focused { z-index: 4; }
	.focused .orb { width: 27px; height: 27px; background: var(--color-accent); outline: 1px solid var(--color-accent); outline-offset: 5px; }
	.orb.visited { border: 2px solid var(--color-accent); }
	.world-node:hover .orb, .world-node:focus-visible .orb { transform: scale(1.25); background: var(--color-accent); }
	.node-label { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); max-width: 170px; width: max-content; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 4px; font-size: 12px; line-height: 20px; background: color-mix(in srgb, var(--color-void) 88%, transparent); pointer-events: none; }
	.region-name { position: absolute; transform: translate(-50%, -100%); font-family: var(--font-display); font-size: 17px; color: var(--color-spark); min-height: 44px; padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--color-void) 65%, transparent); }
	.region-name:hover { color: var(--color-accent); background: var(--color-surface); }
	.map-overlay { position: absolute; z-index: 8; touch-action: auto; }
	.search-panel { top: 16px; left: 16px; width: min(360px, calc(100% - 32px)); }
	.search-panel form { display: flex; align-items: center; gap: 9px; border: 1px solid var(--color-hair-strong); border-radius: 12px; background: var(--color-surface); padding: 0 13px; box-shadow: var(--shadow-card); }
	.search-panel input { min-width: 0; width: 100%; height: 46px; border: 0; outline: 0; font-size: 14px; color: var(--color-ink); background: transparent; }
	.search-panel ul { margin-top: 6px; border: 1px solid var(--color-hair); border-radius: 12px; overflow: auto; max-height: min(380px, 55dvh); background: var(--color-surface); box-shadow: var(--shadow-card); }
	.search-panel li button { display: flex; flex-direction: column; align-items: start; gap: 2px; width: 100%; padding: 10px 13px; text-align: left; min-height: 44px; }
	.search-panel li button:hover, .search-panel li button.highlighted { background: var(--color-surface-2); }
	.search-panel strong { font-size: 14px; font-weight: 500; }
	.search-panel li span { font-size: 12px; color: var(--color-muted); }
	.search-status { padding: 14px; color: var(--color-muted); font-size: 13px; }
	.controls { left: 16px; bottom: 18px; display: flex; padding: 3px; border: 1px solid var(--color-hair); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-card); }
	.controls button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-width: 44px; min-height: 44px; border-radius: 8px; font-size: 13px; }
	.controls button:first-child { padding-inline: 10px; }
	.controls button:hover { background: var(--color-surface-2); }
	.orientation { right: 16px; top: 16px; max-width: 290px; padding: 14px 16px; border: 1px solid var(--color-hair); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-card); }
	.orientation h1 { font-family: var(--font-display); font-size: 23px; font-weight: 600; }
	.orientation p { color: var(--color-muted); font-size: 13px; margin-top: 5px; }
	.orientation .gesture-help { color: var(--color-faint); font-size: 11px; margin-top: 12px; }
	.point-preview { left: 16px; bottom: 82px; max-width: min(340px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border: 1px solid var(--color-hair); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-card); pointer-events: none; }
	.point-preview strong { font-size: 13px; font-weight: 500; }
	.point-preview span { color: var(--color-muted); font-size: 11px; }
	.detail { top: 16px; right: 16px; width: 310px; max-height: calc(100% - 100px); overflow-y: auto; border: 1px solid var(--color-hair); border-radius: 16px; background: var(--color-surface); box-shadow: var(--shadow-card); padding: 20px; }
	.detail-close { position: absolute; right: 5px; top: 5px; display: grid; place-items: center; width: 40px; height: 40px; }
	.detail-region { font-size: 11px; color: var(--color-faint); padding-right: 25px; }
	.detail h1 { font-family: var(--font-display); font-size: 25px; line-height: 1.15; margin-top: 6px; padding-right: 10px; overflow-wrap: anywhere; }
	.summary { color: var(--color-muted); font-size: 13px; line-height: 1.55; margin-top: 14px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; line-clamp: 5; overflow: hidden; }
	.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
	.detail-actions button, .detail-actions a { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 44px; padding: 8px 12px; border-radius: 9px; font-size: 12px; background: var(--color-surface-2); color: var(--color-ink); }
	.detail-actions button { background: var(--color-accent); color: var(--color-void); }
	.detail h2 { font-size: 13px; font-weight: 600; margin-top: 20px; }
	.local-status, .retry { font-size: 12px; margin-top: 9px; color: var(--color-muted); }
	.retry { min-height: 44px; text-decoration: underline; }
	.connection-list { display: flex; flex-direction: column; margin-top: 8px; }
	.connection-list button { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; text-align: left; font-size: 12px; color: var(--color-muted); border-bottom: 1px solid var(--color-hair); padding-block: 7px; }
	.connection-list button:hover { color: var(--color-accent); }
	.map-note { margin-top: 15px; font-size: 10px; line-height: 1.5; color: var(--color-faint); }
	.trail { bottom: 18px; left: 280px; right: 16px; display: flex; gap: 5px; overflow-x: auto; max-width: calc(100% - 300px); background: var(--color-surface); border: 1px solid var(--color-hair); border-radius: 10px; padding: 3px; }
	.trail button { flex-shrink: 0; min-height: 44px; padding: 5px 10px; font-size: 12px; color: var(--color-muted); white-space: nowrap; border-radius: 7px; }
	.trail button.current { color: var(--color-accent); background: var(--color-surface-2); }
	.graph-reader { top: 0; right: 0; z-index: 12; height: 100%; width: min(680px, 65%); --reader-top: 0px; --reader-height: 100%; background: var(--color-surface); overflow-y: auto; }
	.attribution { bottom: 1px; right: 12px; font-size: 10px; color: var(--color-faint); }
	.attribution a:hover { color: var(--color-ink); }
	@media (max-width: 760px) {
		.detail { top: auto; bottom: 78px; left: 12px; right: 12px; width: auto; max-height: 36%; padding: 16px; }
		.detail h1 { font-size: 22px; }
		.summary { margin-top: 9px; -webkit-line-clamp: 3; line-clamp: 3; }
		.trail { display: none; }
		.graph-reader { width: 100%; }
		.orientation { left: 16px; right: auto; top: 84px; max-width: 220px; padding: 10px 12px; }
		.orientation .gesture-help { display: none; }
	}
	/* The shared reader takes over below its desktop breakpoint. Lift its containing
	   stacking context above the shell header so close and title remain reachable. */
	@media (max-width: 1023px) { .universe.reader-open { z-index: 30; } }
</style>
