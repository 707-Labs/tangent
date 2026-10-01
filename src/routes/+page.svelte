<script lang="ts">
	import { uniqueImageCardIds } from '$lib/feed/images';
	import { tick, onMount, untrack } from 'svelte';
	import { afterNavigate, beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { loadRecent, recentForLocation, locationFromUrl, locationUrl, validateLocation, type TangentLocation } from '$lib/feed/continuity';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { feed } from '$lib/feed/feedState.svelte';
	import { reader } from '$lib/reader/readerState.svelte';
	import { trailPanel } from '$lib/feed/trailPanel.svelte';
	import { loadTrail, saveTrail } from '$lib/feed/trail';
	import type { FeedCard } from '$lib/feed/types';
	import { randomSeed } from '$lib/seeds';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import TangentDivider from '$lib/components/TangentDivider.svelte';
	import FootLine from '$lib/components/FootLine.svelte';
	import ArticleReader from '$lib/components/ArticleReader.svelte';
	import TrailPanel from '$lib/components/TrailPanel.svelte';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import ActionHint from '$lib/components/ActionHint.svelte';

	// Shallow history retains Kit's loaded page URL, which can differ from the
	// address bar on a cross-route Back. The address bar identifies this tangent.
	let browserSeed = $state<string | null | undefined>(browser ? new URL(window.location.href).searchParams.get('seed') : undefined);
	const seedParam = $derived(browserSeed === undefined ? page.url.searchParams.get('seed') : browserSeed);
	afterNavigate(() => { browserSeed = new URL(window.location.href).searchParams.get('seed'); });
	let exhaustedImageCards = $state<Set<string>>(new Set());

	// Rehydrate an existing session or start fresh. Runs on mount and whenever
	// seedParam changes. rehydrate() returns false when no matching trail exists,
	// in which case start() kicks off a fresh feed. The cancelled flag stops a
	// superseded run from starting the feed it was navigated away from.
	$effect(() => {
		const seed = seedParam;
		exhaustedImageCards = new Set();
		// A new seed means a new feed — don't leave a stale article open beside it
		// (the reader is a singleton and would otherwise orphan onto the new/errored page).
		reader.restore(null);
		let cancelled = false;
		untrack(() => void (async () => {
			const activeUrl = browser ? new URL(window.location.href) : page.url;
			if (browser && seed) {
				const waypoint = (validateLocation(page.state.tangent) ?? locationFromUrl(activeUrl)).card;
				const recent = recentForLocation(loadRecent(), seed, waypoint, activeUrl.searchParams.get('resume') === '1');
				if (recent) saveTrail(recent.seedTitle, recent.trail);
			}
			const stored = browser ? loadTrail() : null;
			const seedMatches = stored && (seed === null || seed === stored.seedTitle);

			if (seedMatches && feed.seedTitle === stored.seedTitle && feed.cards.length > 0 && activeUrl.searchParams.get('resume') !== '1') return;
			if (seedMatches) {
				const ok = await feed.rehydrate(seed);
				if (cancelled) return;
				if (!ok) {
					if (seed) feed.start(seed);
					else if (feed.status === 'idle') feed.start(randomSeed().title);
				}
			} else {
				if (seed) {
					if (seed !== feed.seedTitle) feed.start(seed);
				} else if (feed.status === 'idle' && feed.cards.length === 0) {
					feed.start(randomSeed().title);
				}
			}
		})());
		return () => {
			cancelled = true;
		};
	});

	let historyReady = $state(false);
	let navigationError = $state<string | null>(null);
	let restoreToken = 0;
	let appliedLocation: TangentLocation | null = null;
	/** Preserve the visible waypoint through the reader's column-width change. */
	function captureFeedPosition(): Pick<TangentLocation, 'card' | 'offset' | 'scrollY'> {
		const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 80;
		const anchor = [...document.querySelectorAll<HTMLElement>('[data-card]')]
			.find((node) => node.getBoundingClientRect().bottom > headerBottom);
		return { card: anchor?.dataset.card ?? null, offset: anchor ? -anchor.getBoundingClientRect().top : undefined, scrollY: window.scrollY };
	}
	beforeNavigate((navigation) => {
		// Popstate has already moved the browser's active entry to the destination.
		// Capturing here would overwrite the waypoint we're trying to restore.
		if (!historyReady || navigation.type === 'popstate') return;
		const snapshot: TangentLocation = { reader: reader.current, ...captureFeedPosition() };
		// This is bookkeeping for the departing entry, not a new UI navigation.
		appliedLocation = snapshot;
		replaceState('', { ...page.state, tangent: snapshot });
	});

	function navigate(next: TangentLocation) {
		if (!historyReady) return;
		const previous = page.state.tangent ?? locationFromUrl(new URL(window.location.href));
		replaceState('', { ...page.state, tangent: { ...previous, ...captureFeedPosition() } });
		// Explicit card jumps intentionally omit offset; reader transitions keep it.
		pushState(locationUrl(new URL(window.location.href), next), { ...page.state, tangent: next });
	}
	function navigateCard(id: string) { navigate({ reader: null, card: id, scrollY: 0 }); }
	onMount(() => {
		const historyLocation = validateLocation(page.state.tangent);
		let initial = historyLocation ?? locationFromUrl(new URL(window.location.href));
		try {
			const stored = JSON.parse(sessionStorage.getItem('tangent-location') ?? 'null');
			if (!historyLocation && !initial.card && stored?.seed === seedParam && Number.isFinite(stored.scrollY)) {
				initial.scrollY = Math.max(0, stored.scrollY);
				if (typeof stored.card === 'string' && stored.card.length <= 200 && Number.isFinite(stored.offset)) { initial.card = stored.card; initial.offset = stored.offset; }
			}
		} catch { /* Best effort. */ }
		// Kit sets its started flag after the initial mount microtask. Defer shallow
		// routing until that initialization completes; onMount alone is too early.
		const initializeHistory = setTimeout(() => {
			replaceState('', { ...page.state, tangent: validateLocation(page.state.tangent) ?? initial });
			historyReady = true;
		}, 0);
		reader.onChange = (title) => {
			const previous = page.state.tangent ?? locationFromUrl(new URL(window.location.href));
			if (previous.reader === title) return;
			navigate({ ...previous, ...captureFeedPosition(), reader: title });
		};
		const persist = () => {
			try {
				sessionStorage.setItem('tangent-location', JSON.stringify({ seed: feed.seedTitle, ...captureFeedPosition() }));
			} catch { /* Best effort. */ }
		};
		window.addEventListener('pagehide', persist);
		return () => { clearTimeout(initializeHistory); persist(); window.removeEventListener('pagehide', persist); reader.onChange = null; };
	});
	$effect(() => {
		const state = page.state.tangent;
		const routeUrl = new URL(window.location.href);
		const ready = historyReady && !feed.rehydrating && (feed.status === 'ready' || feed.status === 'exhausted' || feed.status === 'stalled');
		if (!ready) return;
		if (!state) {
			replaceState('', { ...page.state, tangent: locationFromUrl(routeUrl) });
			return;
		}
		if (state === appliedLocation) return;
		const previousReader = appliedLocation?.reader ?? null;
		appliedLocation = state;
		const token = ++restoreToken;
		untrack(() => void (async () => {
			const layoutChanges = (previousReader !== null) !== (state.reader !== null);
			reader.restore(state.reader);
			if (state.card) await feed.ensureCard(state.card);
			await tick();
			await waitForReaderCollapse(layoutChanges);
			await tick();
			if (token !== restoreToken) return;
			const anchor = state.card ? document.querySelector<HTMLElement>(`[data-card="${CSS.escape(state.card)}"]`) : null;
			if (anchor && state.offset !== undefined) window.scrollTo({ top: window.scrollY + anchor.getBoundingClientRect().top + state.offset, behavior: 'instant' });
			else if (state.scrollY > 0 || !state.card) window.scrollTo({ top: state.scrollY, behavior: 'instant' });
			else document.querySelector(`[data-card="${CSS.escape(state.card)}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
		})());
	});

	let sentinel = $state<HTMLElement | null>(null);
	let pumping = false;

	/**
	 * Reveal buffered cards until the sentinel is pushed beyond the prefetch margin.
	 * Looping (rather than one reveal per intersection event) is what keeps a short
	 * feed flowing — otherwise the observer fires once and never re-triggers because
	 * the sentinel never leaves the viewport's expanded root box.
	 */
	async function pump() {
		if (pumping || !sentinel) return;
		pumping = true;
		try {
			while (
				sentinel &&
				!feed.isExhausted &&
				feed.status === 'ready' &&
				sentinel.getBoundingClientRect().top <= window.innerHeight + 700
			) {
				const before = feed.cards.length;
				await feed.more();
				await tick();
				if (feed.cards.length === before) break;
			}
		} finally {
			pumping = false;
		}
	}

	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) pump();
			},
			{ rootMargin: '700px' }
		);
		io.observe(sentinel);
		return () => io.disconnect();
	});

	// Scroll a card into view and flag it as the landing target, so a fading ember
	// ring marks which article an explicit branch/dive/jump took you to — the new
	// card is appended at the tail, where it'd otherwise be hard to pick out.
	let landedId = $state<string | null>(null);
	let landedTimer: ReturnType<typeof setTimeout> | undefined;

	// Closing the reader collapses the two-pane split back to one column by animating
	// `main`'s max-width (~200ms). Scrolling before that finishes makes the smooth scroll
	// lock onto a stale target: the cards above the destination are mid-reflow and keep
	// growing as the column narrows, so the destination slides down out from under the
	// scroll and lands up to a screen short. Wait for the transition to end before
	// scrolling. The timeout is a fallback for when no transition fires (reduced motion,
	// or the column width didn't actually change) so the scroll never hangs.
	function waitForReaderCollapse(wasOpen: boolean): Promise<void> {
		if (!wasOpen || !browser) return Promise.resolve();
		// The two-pane split (and its max-width transition) only exists at lg+; narrow
		// screens use a full-screen reader that doesn't reflow the feed, and reduced-motion
		// snaps the column instantly. In both cases there's nothing to wait for, so don't
		// make the optimistic scroll eat the fallback delay.
		const willTransition =
			window.matchMedia('(min-width: 1024px)').matches &&
			!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!willTransition) return Promise.resolve();
		const main = document.querySelector('main');
		if (!main) return Promise.resolve();
		return new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				main.removeEventListener('transitionend', onEnd);
				resolve();
			};
			const onEnd = (e: Event) => {
				if (e.target === main && (e as TransitionEvent).propertyName === 'max-width') finish();
			};
			main.addEventListener('transitionend', onEnd);
			setTimeout(finish, 320);
		});
	}

	// `instant` snaps rather than smooth-scrolls. The dive uses it: it scrolls to a still-
	// loading skeleton placeholder (for responsiveness — see handleDive), and an instant
	// snap lands deterministically on the card's current position before its body streams
	// in and grows it downward. (A smooth scroll also proved flaky under test, silently
	// never moving.) Branches also snap directly to their newly appended card;
	// jump/trail navigation keeps the smoother transition between resolved cards.
	async function goToCard(id: string, opts: { instant?: boolean } = {}) {
		// Navigating to a card means you want to see that card — close the reader first
		// (it would otherwise stay open over the destination) and let the layout settle
		// back to one column before scrolling.
		const wasReaderOpen = reader.isOpen;
		reader.restore(null);
		await tick();
		await waitForReaderCollapse(wasReaderOpen);
		await tick();
		document
			.querySelector(`[data-card="${CSS.escape(id)}"]`)
			?.scrollIntoView({ behavior: opts.instant ? 'instant' : 'smooth', block: 'start' });
		landedId = id;
		clearTimeout(landedTimer);
		landedTimer = setTimeout(() => (landedId = null), 1600);
	}

	async function handleBranch(card: FeedCard, title?: string) {
		const id = title ? feed.beginDive(title, card.article.title) : await feed.branchFrom(card);
		// The new card may be several screens away. Snap to it like an explicit
		// dive so steering lands reliably rather than waiting on a long smooth scroll.
		if (id) { navigateCard(id); await goToCard(id, { instant: true }); }
	}

	function handleRead(card: FeedCard) {
		// The card's "Read" already recorded the clickthrough; just open the reader.
		reader.open(card.article.title);
	}

	// Diving into an in-article link closes the reader and drops the linked article as a
	// fresh card at the tail of the feed (relation 'dive'), then scrolls you to it — so the
	// feed itself stays the record of the rabbit hole rather than a hidden reader stack.
	// `fromTitle` is the article you were reading, for the new card's "Dove in from …"
	// breadcrumb. beginDive feeds the engagement profile (clickthrough + seen) on its own.
	// Pulling a running foot dives into it from the card it appeared under — same
	// flow as an in-article dive: the foot's article lands as a fresh card and the
	// trail records that the thread was pulled.
	async function handleFootPull(card: FeedCard, title: string) {
		const id = feed.beginDive(title, card.article.title);
		navigateCard(id);
		await goToCard(id, { instant: true });
	}

	async function handleDive(title: string) {
		const fromTitle = reader.current ?? '';
		// Don't close the reader here. goToCard captures reader.isOpen to decide whether to
		// wait for the two-pane collapse before scrolling; closing it first makes that wait a
		// no-op, so the scroll fires mid-reflow. goToCard closes the reader itself.
		// beginDive drops the placeholder card synchronously and kicks off its body fetch in
		// the background. Scroll to it immediately (instant) so the dive feels responsive: you
		// land on the skeleton — title + "Dove in from …" + a pulsing body — right after the
		// reader collapses, and the article streams in beneath it instead of after a network
		// pause. The skeleton is shorter than any real card, so the body only grows it down.
		const id = feed.beginDive(title, fromTitle);
		navigateCard(id);
		await goToCard(id, { instant: true });
	}

	let jumpingRelated = $state(false);

	async function handleJumpRelated() {
		if (jumpingRelated) return;
		jumpingRelated = true;
		try {
			const id = await feed.jumpRelated();
			if (id) { navigateCard(id); await goToCard(id); }
			else feed.showStartOver = true;
		} finally {
			jumpingRelated = false;
		}
	}

	async function handleTrailSelect(id: string) {
		navigationError = null;
		trailPanel.close();
		if (await feed.ensureCard(id)) { navigateCard(id); await goToCard(id); }
		else navigationError = 'This article could not be loaded. Please try again.';
	}

	// For each card, the id of the card it came from — the nearest earlier card whose
	// title matches its breadcrumb's `fromTitle`. Lets a card's "from X" jump back to
	// the source so the thread is navigable, not just labelled. Absent when the source
	// scrolled out of the chain (e.g. trimmed on rehydrate) or for the seed.
	const imageCardIds = $derived(uniqueImageCardIds(feed.cards, exhaustedImageCards));
	function imageExhausted(id: string): void {
		if (feed.cards.some((card) => card.id === id)) exhaustedImageCards = new Set([...exhaustedImageCards, id]);
	}
	const sourceIdByCard = $derived.by(() => {
		const map = new Map<string, string>();
		const cards = feed.cards;
		for (let i = 0; i < cards.length; i++) {
			const from = cards[i].connection.fromTitle;
			if (!from) continue;
			for (let j = i - 1; j >= 0; j--) {
				if (cards[j].article.title === from) {
					map.set(cards[i].id, cards[j].id);
					break;
				}
			}
		}
		return map;
	});
</script>

<svelte:head>
	<title>{feed.displayTitle ? `${feed.displayTitle} · Tangent` : 'Tangent'}</title>
</svelte:head>

{#if trailPanel.isOpen}
	<TrailPanel
		trail={feed.trail.filter((n) => n.seen)}
		onClose={() => trailPanel.close()}
		onSelect={handleTrailSelect}
	/>
{/if}

{#if navigationError}<p role="alert" class="mb-4 text-sm text-danger">{navigationError}</p>{/if}

<!-- Reading splits the page into two panes (lg+): feed on the left, article on the right. -->
<div class={reader.isOpen ? 'lg:flex lg:items-start lg:gap-6' : ''}>
	<!-- `contents` when closed so the feed keeps its exact single-column layout. -->
	<div class={reader.isOpen ? 'lg:w-[42%] lg:shrink-0 lg:min-w-0' : 'contents'}>
		<h1 class="sr-only">Tangent: {feed.displayTitle ?? 'a Wikipedia rabbit hole'}</h1>
		{#if feed.status === 'error'}
	<div class="flex flex-col items-center gap-4 py-20 text-center">
		<p class="text-muted">{feed.error}</p>
		<a
			href="/start"
			data-cta
			class="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-void
				transition-opacity hover:opacity-90">Pick a starting point</a
		>
	</div>
{:else if feed.cards.length === 0}
	<div class="space-y-5">
		<p class="text-center text-sm text-faint">Going off on a tangent…</p>
		<SkeletonCard />
		<SkeletonCard />
	</div>
{:else}
	<div class="space-y-5">
		<ActionHint />
		{#each feed.cards as card (card.id)}
			{@const sourceId = sourceIdByCard.get(card.id)}
			{#if card.connection.relation === 'surprise' || card.drifted}
				<TangentDivider department={card.department} direction={card.direction} />
			{/if}
			<div data-card={card.id} class="scroll-mt-20" class:wh-land={card.id === landedId}>
				<ArticleCard
					{card}
					showImage={imageCardIds.has(card.id)}
					onImageExhausted={imageExhausted}
					onBranch={handleBranch}
					onRead={handleRead}
					onNavigateToSource={sourceId ? () => { navigateCard(sourceId); void goToCard(sourceId); } : undefined}
					onSeen={() => feed.markSeen(card.id)}
				/>
			</div>
			{#if card.foot}
				{@const foot = card.foot}
				<FootLine
					title={foot.title}
					description={foot.description}
					onPull={() => handleFootPull(card, foot.title)}
				/>
			{/if}
		{/each}
	</div>

	<div bind:this={sentinel} class="h-4"></div>

	<div class="py-8">
		{#if feed.status === 'stalled'}
			<div class="flex flex-col items-center gap-4 text-center">
				<p class="text-sm text-muted">Connection hiccup.</p>
				<button
					type="button"
					onclick={() => feed.retry()}
					class="rounded-full border border-hair px-4 py-2 text-sm font-medium text-muted
						transition-colors hover:border-accent/50 hover:text-accent"
				>
					Retry
				</button>
			</div>
		{:else if feed.isExhausted}
			<div class="flex flex-col items-center gap-4 text-center">
				<p class="text-sm text-muted">No more links to follow. Try another topic.</p>
				{#if !feed.showStartOver}
					<button
						type="button"
						onclick={handleJumpRelated}
						disabled={jumpingRelated}
						class="rounded-full bg-accent px-4 py-2 text-sm font-medium text-void
							transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{jumpingRelated ? 'Jumping…' : 'Jump somewhere related'}
					</button>
				{/if}
				<a
					href="/start"
					data-cta
					class="inline-flex items-center rounded-full border border-hair px-4 py-2 text-sm font-medium text-muted
						transition-colors hover:border-accent/50 hover:text-accent">Start a new tangent</a
				>
			</div>
		{:else}
			<SkeletonCard />
		{/if}
	</div>
		{/if}
	</div>

	{#if reader.isOpen}
		<ArticleReader onDive={handleDive} />
	{/if}
</div>
