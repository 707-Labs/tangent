<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { pushState, replaceState } from '$app/navigation';
	import { neighborhoodsIn, DISCOVERY_ROUTES, rankConnections, parseMapVisit, type Neighborhood } from '$lib/graph/discovery';
	import { Plus, Minus, Scan, X, Search, ArrowRight, RotateCw } from '@lucide/svelte';
	import type { Article, SearchResult } from '$lib/wikipedia/types';
	import { reader } from '$lib/reader/readerState.svelte';
	import ArticleReader from '$lib/components/ArticleReader.svelte';
	import { loadTrail, chainTip } from '$lib/feed/trail';
	import { graphAcquisitions } from '$lib/graph/acquire';
	import { parseAtlas, type AtlasArticle } from '$lib/graph/atlas';
	import { flight, glide, type Flight } from '$lib/graph/camera';
	import { approach } from '$lib/graph/labels';
	import { buildLabels, drawLabels, drawMap, easeFade, hitTest, labelFonts, litNodes, paintNebula, prepareGraph, readPalette, sameGeometry,
		type LabelHit, type LabelLayer, type MapGraph, type MapPalette, type Nebula } from '$lib/graph/render';
	import { REGIONS, initialWorld, atlasWorld, localSearch, importNode, canonicalizeNode, appendVisit, addNeighborhood, overviewCamera, mapTop, centeredCamera, zoomCamera, type Camera, type WorldNode } from '$lib/graph/world';

	/** Saved cameras from the earlier layout point at the wrong places, so visits use a new key. */
	const VISIT_KEY = 'tangent-map-visit:v2';
	const LEGACY_VISIT_KEY = 'tangent-map-visit';
	/** Zoom for arriving at an article: its name and its nearest neighbors' names are legible. */
	const ARRIVAL_ZOOM = 0.75;

	let nodes = $state.raw(initialWorld());
	let atlasArticles = $state.raw(new Map<string, AtlasArticle>());
	let atlasLoading = $state(true);
	let atlasReady: Promise<void> = Promise.resolve();
	let atlasController: AbortController | undefined;
	let canvas = $state<HTMLCanvasElement | null>(null);
	let themeVersion = $state(0);
	let fontVersion = $state(0);
	let fontsReady = false;
	let hoveredTitle = $state<string | null>(null);
	/** Article under keyboard focus in the accessible list; drawn like a hover. */
	let cursorTitle = $state<string | null>(null);
	let pointing = $state(false);
	let listed = $state<string[]>([]);
	let selected = $state<string | null>(null);
	let trail = $state<string[]>([]);
	let activeRegion = $state<string | null>(null);
	let activeNeighborhood = $state<string | null>(null);
	let routeId = $state<string | null>(null);
	let discoveryOpen = $state(false);
	let connectionsOpen = $state(false);
	let restoredCamera = false;
	let restoringSelection = false;
	/** A visit that opens on an article starts from the whole map and flies in once positions are known. */
	let arriving = false;
	let historyReady = $state(false);
	let mounted = false;
	let loading = $state(false);
	let error = $state<string | null>(null);
	let article = $state<Article | null>(null);
	let summaryError = $state(false);
	let width = $state(0);
	let height = $state(0);
	let stage = $state<HTMLDivElement | null>(null);
	let camera = $state.raw<Camera>({ x: 0, y: 0, k: 0.12 });
	let dragging = $state(false);
	let showingOverview = true;
	let disposed = false;
	let selectionVersion = 0;
	const acquisitions = graphAcquisitions();
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let listTimer: ReturnType<typeof setTimeout> | undefined;
	let prefetchActive = 0;
	const aliases = new Map<string, string>();
	function canonicalTitle(title: string) { return aliases.get(title) ?? title; }

	const byTitle = $derived(new Map(nodes.map((node) => [node.title, node])));
	const focus = $derived(selected ? byTitle.get(selected) ?? null : null);
	const viewport = $derived({ width, height });
	const connections = $derived(rankConnections(focus?.neighbors.map((title) => byTitle.get(title)).filter((node): node is WorldNode => !!node) ?? [], trail));
	const neighborhoods = $derived(neighborhoodsIn(byTitle, activeRegion ?? undefined));
	const activeRoute = $derived(DISCOVERY_ROUTES.find((item) => item.id === routeId));
	const routeIndex = $derived(activeRoute ? activeRoute.stops.findIndex((title) => title === selected) : -1);
	const currentRegion = $derived(REGIONS.find((item) => item.id === activeRegion));
	const currentNeighborhood = $derived(neighborhoods.find((item) => item.anchor === activeNeighborhood));

	// Canvas state lives outside Svelte: it changes every frame and nothing in the markup reads it.
	let graph: MapGraph | null = null;
	let palette: MapPalette | null = null;
	let nebula: Nebula | null = null;
	let layer: LabelLayer | null = null;
	let hits: LabelHit[] = [];
	let frameRequest = 0;
	let lastFrameAt = 0;
	let emphasis = 0;
	let fade: Float32Array | null = null;
	let lit: Uint8Array | null = null;
	let litKey = '';
	/** Link highlights fade out after the pointer leaves, so they keep their article until then. */
	const shownLinks = { focus: -1, focusLevel: 0, hover: -1, hoverLevel: 0 };
	let journey: { plan: Flight; started: number; target: Camera } | null = null;

	$effect(() => {
		const next = nodes;
		untrack(() => {
			// Selecting an article re-creates its node with new text; only geometry changes need a rebuild.
			if (graph && sameGeometry(graph.nodes, next)) graph = { ...graph, nodes: next };
			else {
				graph = null; nebula = null; layer = null; fade = null; litKey = '';
				Object.assign(shownLinks, { focus: -1, focusLevel: 0, hover: -1, hoverLevel: 0 });
			}
			requestRender();
		});
	});
	$effect(() => {
		void themeVersion; void fontVersion;
		untrack(() => { palette = null; nebula = null; layer = null; requestRender(); });
	});
	$effect(() => {
		void camera; void selected; void hoveredTitle; void cursorTitle; void trail.join('\n'); void connections; void width; void height; void canvas;
		untrack(requestRender);
	});

	function requestRender() {
		if (!frameRequest && !disposed) frameRequest = requestAnimationFrame(render);
	}

	function render(now: number) {
		frameRequest = 0;
		const target = canvas;
		if (!target || width <= 0 || height <= 0 || disposed) return;
		const elapsed = lastFrameAt ? Math.min(100, Math.max(0, now - lastFrameAt)) : 16;
		lastFrameAt = now;
		let animating = false;
		if (journey) {
			const progress = Math.max(0, (now - journey.started) / journey.plan.duration);
			camera = journey.plan.at(progress);
			if (progress >= 1) journey = null; else animating = true;
		}
		const context = target.getContext('2d');
		if (!context) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
		if (target.width !== pixelWidth || target.height !== pixelHeight) { target.width = pixelWidth; target.height = pixelHeight; }
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		palette ??= readPalette(document.documentElement);
		const map = graph ??= prepareGraph(nodes);
		nebula ??= paintNebula(map, palette);
		if (fontsReady) layer ??= buildLabels(map, palette, context);
		if (!fade || fade.length !== map.nodes.length) fade = new Float32Array(map.nodes.length);

		const indexOf = (title: string | null) => (title === null ? -1 : map.index.get(title) ?? -1);
		const focusIndex = indexOf(selected), hoverIndex = indexOf(hoveredTitle), cursorIndex = indexOf(cursorTitle);
		const goal = hoverIndex >= 0 || cursorIndex >= 0 ? 1 : focusIndex >= 0 ? 0.55 : 0;
		emphasis = approach(emphasis, goal, elapsed, 240);
		const key = `${focusIndex} ${hoverIndex} ${cursorIndex}`;
		if (key !== litKey) { litKey = key; lit = goal > 0 ? litNodes(map, [focusIndex, hoverIndex, cursorIndex]) : null; }
		if (easeFade(fade, lit, goal, elapsed) || emphasis !== goal) animating = true;
		for (const [name, index] of [['focus', focusIndex], ['hover', Math.max(hoverIndex, cursorIndex)]] as const) {
			const level = `${name}Level` as const;
			if (index >= 0) shownLinks[name] = index;
			shownLinks[level] = approach(shownLinks[level], index >= 0 ? 1 : 0, elapsed, 200);
			if (shownLinks[level] === 0) shownLinks[name] = -1;
			else if (shownLinks[level] !== 1) animating = true;
		}

		const trailIndices = trail.map(indexOf).filter((i) => i >= 0);
		const frame = { camera, width, height, emphasis, focus: focusIndex, hover: hoverIndex, cursor: cursorIndex, fade,
			links: [{ node: shownLinks.focus, accent: true, level: shownLinks.focusLevel },
				{ node: shownLinks.hover === shownLinks.focus ? -1 : shownLinks.hover, accent: false, level: shownLinks.hoverLevel }],
			trail: trailIndices, visited: new Set(trailIndices) };
		drawMap(context, map, nebula, palette, frame);
		if (layer) {
			const featured = [hoverIndex, focusIndex, cursorIndex, ...connections.slice(0, 8).map((node) => indexOf(node.title))];
			const result = drawLabels(context, map, layer, palette, frame, featured, elapsed);
			hits = result.hits;
			if (result.animating) animating = true;
		} else hits = [];
		scheduleList(map, hits);
		if (animating) requestRender(); else lastFrameAt = 0;
	}

	/** Mirrors legible names into a list that screen readers and the keyboard can reach. */
	function scheduleList(source: MapGraph, frameHits: readonly LabelHit[]) {
		clearTimeout(listTimer);
		listTimer = setTimeout(() => {
			if (disposed || source !== graph) return;
			const titles = new Set<string>();
			for (const hit of frameHits) if (hit.node >= 0 && titles.size < 40) titles.add(source.nodes[hit.node].title);
			if (cursorTitle) titles.add(cursorTitle);
			// Alphabetical order keeps the focused entry in place while the list changes around it.
			const next = [...titles].sort((a, b) => a.localeCompare(b));
			if (next.join('\n') !== listed.join('\n')) listed = next;
		}, 300);
	}

	function prefersReducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
	/** Where the camera is headed; history and gestures build on this rather than a frame mid-flight. */
	function restingCamera(): Camera { return journey?.target ?? camera; }
	function jump(next: Camera) { journey = null; camera = next; }
	function flyTo(next: Camera) {
		if (prefersReducedMotion() || width <= 0 || height <= 0) { jump(next); return; }
		journey = { plan: flight(camera, next, viewport), started: performance.now(), target: next };
		requestRender();
	}
	function glideTo(next: Camera, duration: number) {
		if (prefersReducedMotion()) { jump(next); return; }
		journey = { plan: glide(camera, next, duration), started: performance.now(), target: next };
		requestRender();
	}
	function zoomBy(factor: number, x = width / 2, y = height / 2) {
		arriving = false;
		glideTo(zoomCamera(restingCamera(), factor, { x, y }), 220);
	}
	function panBy(dx: number, dy: number) {
		arriving = false;
		const base = restingCamera();
		glideTo({ ...base, x: base.x + dx, y: base.y + dy }, 180);
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
				// A selection made before the atlas arrived was placed in a guessed region.
				if (node) activeRegion = node.region;
				if (node && !arriving && !showingOverview && !restoringSelection) flyTo(centeredCamera(node, viewport, restingCamera().k));
			}
		} catch { /* Existing live exploration remains available when the static atlas fails. */ }
		finally {
			clearTimeout(deadline);
			if (!disposed) { atlasLoading = false; arrive(); }
		}
	}
	function arrive() {
		if (!arriving || disposed) return;
		if (width <= 0 || height <= 0) { requestAnimationFrame(arrive); return; }
		arriving = false;
		if (!focus) return;
		showingOverview = false;
		flyTo(centeredCamera(focus, viewport, ARRIVAL_ZOOM));
	}

	function overview() { activeRegion = null; activeNeighborhood = null; arriving = false; closeSelection(); showingOverview = true; flyTo(overviewCamera(viewport)); }
	function showRegion(id: string) {
		const index = REGIONS.findIndex((item) => item.id === id);
		if (index < 0) return;
		const region = REGIONS[index];
		activeRegion = id;
		activeNeighborhood = null;
		discoveryOpen = true;
		showingOverview = false;
		arriving = false;
		closeSelection();
		// Fit the region's articles beside the browse menu and between the search panel and controls.
		const radius = Math.max(600, (graph?.regionRadius[index] || 900) * 1.15);
		const wide = width > 760;
		const left = wide ? 392 : 24, top = mapTop(viewport), bottom = 72, right = 24;
		const k = Math.min(0.7, Math.max(0.09, Math.min((width - left - right) / (2 * radius), (height - top - bottom) / (2 * radius))));
		flyTo({ x: left + (width - left - right) / 2 - region.x * k, y: top + (height - top - bottom) / 2 - region.y * k, k });
	}
	function showNeighborhood(item: Neighborhood) {
		const node = byTitle.get(item.anchor);
		if (!node) return;
		activeRegion = item.region; activeNeighborhood = item.anchor; discoveryOpen = false;
		select(node);
	}
	function startRoute(id: string) {
		const route = DISCOVERY_ROUTES.find((item) => item.id === id);
		if (!route) return;
		routeId = id; discoveryOpen = false; dive(route.stops[0]);
	}
	function center(node: WorldNode, zoom = Math.max(ARRIVAL_ZOOM, restingCamera().k)) {
		showingOverview = false;
		arriving = false;
		flyTo(centeredCamera(node, viewport, Math.min(1.3, zoom)));
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
				flyTo(centeredCamera(mergedNode, viewport, camera.k));
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
	function select(info: SearchResult | WorldNode, restore = false) {
		connectionsOpen = false;
		info = { ...info, title: canonicalTitle(info.title) };
		reader.restore(null);
		clearTimeout(idleTimer);
		if (mounted && !restore) replaceMapHistory();
		nodes = importNode(nodes, info);
		selected = info.title;
		activeRegion = byTitle.get(info.title)?.region ?? activeRegion;
		if (!restore && activeNeighborhood && info.title !== activeNeighborhood && !byTitle.get(activeNeighborhood)?.neighbors.includes(info.title)) activeNeighborhood = null;
		if (!restore) trail = appendVisit(trail, info.title);
		const node = nodes.find((item) => item.title === info.title)!;
		if (!restore) center(node);
		if (mounted && historyReady && !restore) { const url = new URL(window.location.href); url.searchParams.set('seed', info.title); url.searchParams.delete('reader'); pushState(url, { ...page.state, mapVisit: mapSnapshot() }); }
		searchOpen = false;
		article = atlasArticles.get(info.title) ?? null;
		void loadSelection(info.title, ++selectionVersion);
	}
	function dive(title: string) {
		title = canonicalTitle(title);
		reader.restore(null);
		nodes = importNode(nodes, { title, description: null, thumbnail: null }, focus ?? undefined);
		select(nodes.find((node) => node.title === title)!);
	}
	function closeSelection() {
		selectionVersion++;
		selected = null;
		reader.restore(null);
		// Overview/region callers also move the camera in this turn. Snapshot the final pose.
		if (mounted) queueMicrotask(() => {
			if (!mounted || !historyReady || selected) return;
			const url = new URL(window.location.href); url.searchParams.delete('seed'); url.searchParams.delete('reader');
			replaceState(url, { ...page.state, mapVisit: mapSnapshot() });
		});
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

	interface Pointer { startX: number; startY: number; x: number; y: number; touch: boolean }
	const pointers = new Map<number, Pointer>();
	let moved = false;
	let wheelPanUntil = 0;
	function localPoint(event: { clientX: number; clientY: number }) {
		const rect = stage!.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}
	function setHover(title: string | null, region = false) {
		pointing = title !== null || region;
		if (title === hoveredTitle) return;
		hoveredTitle = title;
		if (title) hover(title); else clearTimeout(hoverTimer);
	}
	function pointerDown(event: PointerEvent) {
		if (event.button !== 0 || !stage || (event.target as HTMLElement).closest('.map-overlay')) return;
		pointers.set(event.pointerId, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' });
		moved = pointers.size > 1;
		stage.setPointerCapture(event.pointerId);
	}
	function pointerMove(event: PointerEvent) {
		if (!stage) return;
		const prior = pointers.get(event.pointerId);
		if (!prior) {
			if (event.pointerType === 'touch') return;
			if ((event.target as HTMLElement).closest('.map-overlay') || !graph) { setHover(null); return; }
			const hit = hitTest(graph, hits, camera, localPoint(event), 10);
			setHover(hit && hit.node >= 0 ? graph.nodes[hit.node].title : null, hit?.node === -1);
			return;
		}
		const others = [...pointers].filter(([id]) => id !== event.pointerId).map(([, pointer]) => pointer);
		if (others.length === 1) {
			// Pinch: zoom by the change in finger spread about the old midpoint, then follow the midpoint.
			const other = others[0];
			const before = localPoint({ clientX: (prior.x + other.x) / 2, clientY: (prior.y + other.y) / 2 });
			const after = localPoint({ clientX: (event.clientX + other.x) / 2, clientY: (event.clientY + other.y) / 2 });
			const spread = Math.hypot(prior.x - other.x, prior.y - other.y);
			const zoomed = spread > 0 ? zoomCamera(camera, Math.hypot(event.clientX - other.x, event.clientY - other.y) / spread, before) : camera;
			jump({ ...zoomed, x: zoomed.x + after.x - before.x, y: zoomed.y + after.y - before.y });
		} else if (others.length === 0) {
			// Small movements stay clicks; once a drag starts it catches up with the whole movement.
			if (!moved && Math.hypot(event.clientX - prior.startX, event.clientY - prior.startY) <= (prior.touch ? 8 : 4)) return;
			jump({ ...camera, x: camera.x + event.clientX - prior.x, y: camera.y + event.clientY - prior.y });
		} else return;
		moved = true;
		dragging = true;
		arriving = false;
		setHover(null);
		pointers.set(event.pointerId, { ...prior, x: event.clientX, y: event.clientY });
	}
	function pointerUp(event: PointerEvent) {
		const prior = pointers.get(event.pointerId);
		pointers.delete(event.pointerId);
		if (pointers.size === 0) dragging = false;
		if (!prior || moved || pointers.size > 0 || event.type !== 'pointerup' || !stage || !graph) return;
		const hit = hitTest(graph, hits, camera, localPoint(event), prior.touch ? 22 : 10);
		if (!hit) return;
		if (hit.node >= 0) select(graph.nodes[hit.node]);
		else if (REGIONS[hit.region]) showRegion(REGIONS[hit.region].id);
	}
	/**
	 * Trackpads scroll in fine pixel steps and pan the map, as they do in design tools; wheel notches
	 * zoom, as they do on maps. Notches arrive as lines, as large whole pixels, or (Chrome and Safari
	 * on macOS) as multiples of 4.000244140625 pixels. A pan gesture keeps panning through its
	 * coarser momentum events.
	 */
	function fineScroll(event: WheelEvent): boolean {
		if (event.deltaMode !== 0) return false;
		if (event.deltaX !== 0) return true;
		const y = Math.abs(event.deltaY);
		if (y === 0) return true;
		if (y % 4.000244140625 === 0) return false;
		return !Number.isInteger(y) || y < 40;
	}
	function wheel(event: WheelEvent) {
		if ((event.target as HTMLElement).closest('.map-overlay') || !stage) return;
		event.preventDefault();
		arriving = false;
		const point = localPoint(event);
		const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
		const dx = event.deltaX * unit, dy = event.deltaY * unit;
		// Trackpad pinches arrive as ctrl + wheel.
		if (event.ctrlKey || event.metaKey) { jump(zoomCamera(camera, Math.exp(-dy * 0.01), point)); return; }
		const now = performance.now();
		if (fineScroll(event) || now < wheelPanUntil) {
			wheelPanUntil = now + 400;
			jump({ ...camera, x: camera.x - dx, y: camera.y - dy });
			return;
		}
		if (dy !== 0) zoomBy(1.25 ** (-Math.sign(dy) * Math.min(3, Math.max(1, Math.abs(dy) / 100))), point.x, point.y);
	}
	function keyboard(event: KeyboardEvent) {
		if ((event.target as HTMLElement).closest('input, button:not(.map-navigation), a, .map-overlay')) return;
		const offsets: Record<string, [number, number]> = { ArrowLeft: [120, 0], ArrowRight: [-120, 0], ArrowUp: [0, 120], ArrowDown: [0, -120] };
		if (offsets[event.key]) { event.preventDefault(); const [x, y] = offsets[event.key]; panBy(x, y); }
		else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.35); }
		else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.35); }
		else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); overview(); }
		else if (event.key === 'Escape') closeSelection();
	}
	function mapSnapshot() { return { selected, trail: [...trail], camera: { ...restingCamera() }, region: activeRegion, neighborhood: activeNeighborhood, reader: reader.current }; }
	function replaceMapHistory() {
		if (mounted && historyReady) replaceState('', { ...page.state, mapVisit: { ...mapSnapshot(), reader: new URL(window.location.href).searchParams.get('reader') } });
	}
	onMount(() => {
		mounted = true;
		reader.restore(null);
		atlasReady = loadAtlas();
		const themeObserver = new MutationObserver(() => { themeVersion++; });
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		// Canvas text does not load fonts by itself, and label placement needs the real widths.
		// Names wait briefly for the faces, then use fallbacks and re-measure if the faces arrive later.
		const fontFallback = setTimeout(() => { if (!fontsReady) { fontsReady = true; fontVersion++; } }, 1500);
		void Promise.allSettled(labelFonts(readPalette(document.documentElement)).map((font) => document.fonts.load(font))).then(() => {
			if (disposed) return;
			fontsReady = true;
			fontVersion++;
		});
		const requested = page.url.searchParams.get('seed');
		const stored = loadTrail();
		let saved = parseMapVisit(page.state.mapVisit);
		try {
			localStorage.removeItem(LEGACY_VISIT_KEY);
			saved ??= parseMapVisit(JSON.parse(localStorage.getItem(VISIT_KEY) ?? 'null'));
		} catch { /* Storage can be unavailable. */ }
		const title = requested ?? saved?.selected ?? (stored ? chainTip(stored.trail)?.title : null);
		if (saved && (!requested || requested === saved.selected)) {
			trail = saved.trail; activeRegion = saved.region; activeNeighborhood = saved.neighborhood;
			if (title) select({ title, description: null, thumbnail: null }, true);
			camera = saved.camera; showingOverview = false; restoredCamera = true; restoringSelection = true;
		} else if (title) { select({ title, description: null, thumbnail: null }, true); arriving = true; }
		reader.restore(new URL(window.location.href).searchParams.get('reader'));
		// Kit initializes its router after the mount microtask; defer the first shallow write.
		const initializeHistory = setTimeout(() => {
			if (!mounted) return;
			replaceState('', { ...page.state, mapVisit: mapSnapshot() });
			historyReady = true;
		}, 0);
		reader.onChange = (title) => {
			if (!historyReady) return;
			replaceMapHistory(); const url = new URL(window.location.href);
			if (title) url.searchParams.set('reader', title); else url.searchParams.delete('reader');
			pushState(url, { ...page.state, mapVisit: mapSnapshot() });
		};
		const target = stage;
		target?.addEventListener('wheel', wheel, { passive: false });
		return () => {
			clearTimeout(initializeHistory); clearTimeout(fontFallback); historyReady = false; reader.onChange = null; mounted = false;
			target?.removeEventListener('wheel', wheel); themeObserver.disconnect();
		};
	});
	$effect(() => {
		const ready = historyReady;
		const snapshot = parseMapVisit(page.state.mapVisit);
		const historyReader = page.state.mapVisit?.reader ?? null;
		if (!ready || !snapshot) return;
		untrack(() => {
			const resting = restingCamera();
			if (selected === snapshot.selected && reader.current === historyReader &&
				resting.x === snapshot.camera.x && resting.y === snapshot.camera.y && resting.k === snapshot.camera.k &&
				trail.join('\n') === snapshot.trail.join('\n')) return;
			trail = snapshot.trail; activeRegion = snapshot.region; activeNeighborhood = snapshot.neighborhood;
			if (snapshot.selected) select({ title: snapshot.selected, description: null, thumbnail: null }, true);
			else { selected = null; selectionVersion++; }
			arriving = false;
			flyTo(snapshot.camera);
			reader.restore(historyReader);
		});
	});

	$effect(() => {
		const resized = { width, height };
		if (width <= 0 || height <= 0) return;
		if (restoredCamera) { restoredCamera = false; return; }
		// Only viewport changes reframe; arriving metadata and camera gestures never do.
		untrack(() => jump(showingOverview || !focus ? overviewCamera(resized) : centeredCamera(focus, resized, restingCamera().k)));
	});
	$effect(() => {
		const saved = { selected, trail, camera, region: activeRegion, neighborhood: activeNeighborhood };
		if (width <= 0) return;
		const timer = setTimeout(() => {
			if (historyReady) replaceMapHistory();
			try { localStorage.setItem(VISIT_KEY, JSON.stringify({ ...saved, camera: restingCamera() })); } catch { /* Exploration works without storage. */ }
		}, 400);
		return () => clearTimeout(timer);
	});
	onDestroy(() => {
		disposed = true;
		selectionVersion++;
		acquisitions.dispose();
		atlasController?.abort();
		cancelAnimationFrame(frameRequest);
		clearTimeout(hoverTimer);
		clearTimeout(idleTimer);
		clearTimeout(listTimer);
		reader.restore(null);
	});
</script>

<svelte:head><title>Article map · Tangent</title></svelte:head>

<!-- A native background control provides keyboard navigation without changing screen-reader modes. -->
<div bind:this={stage} bind:clientWidth={width} bind:clientHeight={height}
	class="universe" class:dragging class:pointing={pointing && !dragging} class:reader-open={reader.isOpen} role="region" aria-label="Article map"
	onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp} onpointerleave={() => setHover(null)}>
	<button type="button" class="map-navigation" aria-label="Navigate article map. Arrow keys pan, plus and minus zoom, Home shows all topic regions." onkeydown={keyboard}></button>
	<canvas bind:this={canvas} class="point-cloud" aria-hidden="true"></canvas>

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
	<div class="map-overlay discovery">
		<nav aria-label="Map location"><button type="button" onclick={overview}>Wikipedia</button>{#if currentRegion}<span>/</span><button type="button" onclick={() => showRegion(currentRegion!.id)}>{currentRegion.label}</button>{/if}{#if currentNeighborhood}<span>/</span><span>{currentNeighborhood.label}</span>{/if}</nav>
		<button type="button" class="browse-toggle" aria-expanded={discoveryOpen} onclick={() => discoveryOpen = !discoveryOpen}>Browse {activeRegion ? 'neighborhoods' : 'topics & routes'}</button>
		{#if discoveryOpen}
		<div class="discovery-menu">
			{#if !activeRegion}<div class="topic-options">{#each REGIONS as region}<button type="button" onclick={() => showRegion(region.id)}>{region.label}</button>{/each}</div>{/if}
			{#if activeRegion}<h2>{currentRegion?.label}</h2><div class="topic-options">{#each neighborhoods as item}<button type="button" onclick={() => showNeighborhood(item)}>{item.label}</button>{/each}</div><p>Start at a landmark, then follow its connections.</p>{/if}
			<h2>Take a route</h2>{#each DISCOVERY_ROUTES as route}<button type="button" class="route-option" onclick={() => startRoute(route.id)}>{route.label}<span>{route.stops.length} stops</span></button>{/each}
			<p>Curated reading stops, not direct Wikipedia links.</p>
		</div>
		{/if}
	</div>
	{#if activeRoute && !reader.isOpen}<div class="map-overlay route-progress"><span>{activeRoute.label}</span><button type="button" onclick={() => routeId = null} aria-label="Leave curated route"><X size={16} /></button><div>{#each activeRoute.stops as title, index}<button type="button" class:current={selected === title} onclick={() => dive(title)} aria-label={`Route stop ${index + 1}: ${title}`}>{index + 1}</button>{/each}</div>{#if routeIndex >= 0 && routeIndex < activeRoute.stops.length - 1}<button type="button" class="route-next" onclick={() => dive(activeRoute!.stops[routeIndex + 1])}>Next: {activeRoute.stops[routeIndex + 1]} <ArrowRight size={14} /></button>{/if}</div>{/if}
	<div class="map-overlay controls">
		<button type="button" onclick={overview} title="Show topic regions"><Scan size={18} aria-hidden="true" /><span>Overview</span></button>
		<button type="button" onclick={() => { if (focus) center(focus); else overview(); }} aria-label="Recenter selected article" title="Recenter"><RotateCw size={18} /></button>
		<button type="button" onclick={() => zoomBy(1.35)} aria-label="Zoom in" title="Zoom in"><Plus size={18} /></button>
		<button type="button" onclick={() => zoomBy(1 / 1.35)} aria-label="Zoom out" title="Zoom out"><Minus size={18} /></button>
	</div>
	{#if !focus}
		<div class="map-overlay orientation"><h1>Explore Wikipedia</h1><p>{atlasLoading ? 'Opening the map…' : `${(atlasArticles.size || nodes.length).toLocaleString()} articles to explore. Search all Wikipedia.`}</p><p class="gesture-help">Choose a region. Drag to pan. Scroll or pinch to zoom.</p></div>
	{/if}
	{#if focus && !reader.isOpen}
		{#key focus.title}
		<aside class="map-overlay detail" class:connections-open={connectionsOpen} aria-label="Selected article">
			<button type="button" class="detail-close" onclick={closeSelection} aria-label="Close selected article"><X size={18} /></button>
			<p class="detail-region">Wikipedia article</p>
			<h1>{focus.title}</h1>
			<button type="button" class="connections-toggle" aria-expanded={connectionsOpen} aria-controls="map-next-connections" onclick={() => connectionsOpen = !connectionsOpen}>{connectionsOpen ? 'Hide connections' : `Connections (${connections.length})`}</button>
			{#if article?.extract}<p class="summary">{article.extract}</p>
			{:else if focus.description}<p class="summary">{focus.description}</p>
			{:else if summaryError}<p class="summary">Summary unavailable. You can still open the article.</p>
			{:else}<p class="summary">Loading summary…</p>{/if}
			<div class="detail-actions"><button type="button" onclick={() => reader.open(article?.title ?? focus!.title)}>Read article <ArrowRight size={16} /></button>
				<a href={`/?seed=${encodeURIComponent(article?.title ?? focus.title)}`}>Start tangent here</a></div>
			<div id="map-next-connections" class="next-connections"><h2>Where next?</h2>
			{#if loading}<p class="local-status" role="status">Finding connections…</p>{/if}
			{#if error}<p class="local-status" role="alert">{error}</p><button class="retry" type="button" onclick={() => { if (selected) void loadSelection(selected, ++selectionVersion); }}>Retry connections</button>{/if}
			{#if connections.length}<div class="connection-list">{#each connections.slice(0, 3) as node (node.title)}<button type="button" onclick={() => select(node)} onpointerenter={() => hover(node.title)} onpointerleave={() => clearTimeout(hoverTimer)}><span><strong>{node.title}</strong>{#if node.description}<small>{node.description}</small>{/if}</span><ArrowRight size={14} /></button>{/each}</div>{/if}
			{#if connections.length > 3}<details class="more-connections"><summary>More connections ({connections.length - 3})</summary><div class="connection-list">{#each connections.slice(3) as node (node.title)}<button type="button" onclick={() => select(node)}><span><strong>{node.title}</strong>{#if node.description}<small>{node.description}</small>{/if}</span><ArrowRight size={14} /></button>{/each}</div></details>{/if}
			</div>
			<p class="map-note">Lines are Wikipedia links in either direction, colored by topic region. The dotted path traces your visits. This atlas is a sample; search reaches beyond it.</p>
		</aside>
		{/key}
	{/if}
	{#if reader.isOpen}<div class="map-overlay graph-reader"><ArticleReader onDive={dive} /></div>{/if}
	{#if trail.length > 1 && !reader.isOpen}<nav class="map-overlay trail" aria-label="Map trail">{#each trail as title}<button type="button" class:current={selected === title} onclick={() => dive(title)}>{title}</button>{/each}</nav>{/if}
	<div class="map-overlay attribution"><a href="https://en.wikipedia.org" target="_blank" rel="noopener noreferrer">Wikipedia</a><span> · </span><a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a></div>
	<!-- The canvas names mirrored for the keyboard and screen readers; focus draws a ring on the map. -->
	<nav class="sr-only" aria-label="Articles in view">
		{#each listed as title (title)}
			<button type="button" onfocus={() => { cursorTitle = title; }} onblur={() => { if (cursorTitle === title) cursorTitle = null; }}
				onclick={() => { const node = byTitle.get(title); if (node) select(node); }}>{title}</button>
		{/each}
	</nav>
</div>

<style>
	.discovery { top: 76px; left: 16px; max-width: min(360px, calc(100% - 32px)); }
	.discovery nav { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: fit-content; max-width: 100%; margin-bottom: 4px; padding: 0 10px; border-radius: 9px; font-size: 12px; background: var(--color-void); color: var(--color-muted); }
	.discovery nav button { min-height: 32px; color: var(--color-spark); }
	.browse-toggle { min-height: 44px; padding: 8px 12px; border: 1px solid var(--color-hair); border-radius: 9px; background: var(--color-surface); font-size: 13px; }
	.discovery-menu { margin-top: 6px; max-height: 48dvh; overflow-y: auto; padding: 14px; border: 1px solid var(--color-hair); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-card); }
	.discovery-menu h2 { margin-top: 10px; font-size: 13px; font-weight: 600; }
	.discovery-menu p { margin-top: 8px; font-size: 11px; color: var(--color-faint); }
	.topic-options { display: flex; flex-wrap: wrap; gap: 5px; }
	.topic-options button { min-height: 44px; padding: 7px 10px; background: var(--color-surface-2); border-radius: 8px; font-size: 13px; }
	.route-option { display: flex; justify-content: space-between; width: 100%; min-height: 44px; gap: 8px; align-items: center; font-size: 13px; text-align: left; }
	.route-option span { color: var(--color-faint); font-size: 11px; }
	.route-progress { bottom: 82px; left: 16px; max-width: min(340px, calc(100% - 32px)); padding: 8px 12px; background: var(--color-surface); border: 1px solid var(--color-hair); border-radius: 12px; font-size: 12px; }
	.route-progress > button { float: right; min-height: 32px; min-width: 32px; }
	.route-progress div { display: flex; gap: 3px; }
	.route-progress div button { width: 44px; height: 44px; color: var(--color-muted); }
	.route-progress button.current { color: var(--color-accent); text-decoration: underline; }
	.route-progress > button.route-next { float: none; display: flex; align-items: center; gap: 6px; min-height: 44px; color: var(--color-spark); }
	.more-connections summary { min-height: 44px; padding-top: 14px; cursor: pointer; font-size: 12px; color: var(--color-spark); }
	.connection-list strong { font-weight: 500; color: var(--color-ink); }
	.connection-list small { display: block; margin-top: 2px; font-size: 11px; line-height: 1.4; }
	/* Clipping must not create a scroll container: focusing a reader link or disclosure
	   otherwise scrolls outlying map labels and pulls the reader beneath the app header. */
	.universe { position: relative; width: 100%; height: calc(100dvh - var(--app-header-height, 69px)); overflow: clip; background: var(--color-void); touch-action: none; isolation: isolate; outline-offset: -3px; }
	.universe.dragging, .universe.dragging .map-navigation { cursor: grabbing; }
	.universe.pointing .map-navigation { cursor: pointer; }
	.map-navigation { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; border: 0; cursor: grab; }
	.map-navigation:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -3px; }
	.point-cloud { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.map-overlay { position: absolute; z-index: 8; touch-action: auto; }
	/* Search results and the browse menu open over the panels below them. */
	.search-panel { top: 16px; left: 16px; z-index: 10; width: min(360px, calc(100% - 32px)); }
	.discovery { z-index: 9; }
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
	.detail { top: 16px; right: 16px; width: 310px; max-height: calc(100% - 100px); overflow-y: auto; border: 1px solid var(--color-hair); border-radius: 16px; background: var(--color-surface); box-shadow: var(--shadow-card); padding: 20px; }
	.connections-toggle { display: none; }
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
		.route-progress { bottom: 70px; }
		.universe:has(.route-progress) .detail { bottom: 204px; max-height: 40%; }
		.universe:has(.route-progress) .detail.connections-open { max-height: min(52%, calc(100% - 320px)); }
		.detail { top: auto; bottom: 78px; left: 12px; right: 12px; width: auto; max-height: 44%; padding: 16px; }
		.detail h1 { font-size: 22px; }
		.connections-toggle { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--color-spark); }
		.next-connections { display: none; }
		.connections-open .next-connections { display: block; }
		.detail.connections-open { max-height: 65%; }
		.connections-open .summary, .connections-open .map-note { display: none; }
		.summary { margin-top: 9px; -webkit-line-clamp: 3; line-clamp: 3; }
		.trail { display: none; }
		.graph-reader { width: 100%; }
		/* mapTop() in $lib/graph/world starts the open map below this card. */
		.orientation { left: 16px; right: auto; top: 174px; max-width: 220px; padding: 10px 12px; }
		.orientation .gesture-help { display: none; }
	}
	/* The shared reader takes over below its desktop breakpoint. Lift its containing
	   stacking context above the shell header so close and title remain reachable. */
	@media (max-width: 1023px) { .universe.reader-open { z-index: 30; } }
</style>
