<script lang="ts">
	import '../app.css';
	// Self-hosted fonts (Fontsource) — no third-party Google Fonts request, so no visitor IP
	// leaves for Google on load. Family names match the @theme tokens ('Hanken Grotesk',
	// 'Newsreader'), so nothing else changes; weights mirror the old Google Fonts query.
	import '@fontsource/hanken-grotesk/400.css';
	import '@fontsource/hanken-grotesk/500.css';
	import '@fontsource/hanken-grotesk/600.css';
	import '@fontsource/newsreader/400.css';
	import '@fontsource/newsreader/500.css';
	import '@fontsource/newsreader/600.css';
	import '@fontsource/newsreader/400-italic.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SavedPanel from '$lib/components/SavedPanel.svelte';
	import { savedArticles } from '$lib/saved/saved.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import ProfilePanel from '$lib/components/ProfilePanel.svelte';
	import AccountPanel from '$lib/components/AccountPanel.svelte';
	import { SlidersHorizontal, Plus, Waypoints, Star, UserRound } from '@lucide/svelte';
	import { profile } from '$lib/engagement/profile.svelte';
	import { reader } from '$lib/reader/readerState.svelte';
	import { auth } from '$lib/auth/authState.svelte';
	import { syncOnInit, mergeOnLogin, pushProfile } from '$lib/auth/sync';
	import { theme } from '$lib/theme/theme.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	// Reflect the resolved theme onto <html> (data-theme + chrome tint). Reads reactive
	// state via apply(), so it re-runs when the preference or the OS color-scheme changes.
	// The inline no-flash script in app.html already set it for first paint.
	$effect(() => {
		theme.apply();
	});

	// Resolve the session once, then sync the profile if signed in. A magic-link sign-in lands
	// here as a full nav with ?signin=1 — that's a fresh login, so run the union merge (local +
	// server) once instead of the steady-state revision-guarded pull, then strip the param so a
	// reload doesn't re-merge.
	onMount(() => {
		savedArticles.load();
		const justSignedIn = page.url.searchParams.get('signin') === '1';
		void auth.refresh().then(() => {
			if (!auth.isAuthed) return;
			if (justSignedIn) {
				void mergeOnLogin();
				const clean = new URL(window.location.href);
				clean.searchParams.delete('signin');
				window.history.replaceState(window.history.state, '', clean);
			} else {
				void syncOnInit();
			}
		});
	});

	// Debounced push of local profile edits while signed in. Reads `profile.rev` so it
	// re-runs on every mutation; the push marks the rev synced, flipping `pendingSync` off.
	$effect(() => {
		void profile.rev;
		if (!auth.isAuthed || !profile.pendingSync) return;
		const id = setTimeout(() => void pushProfile(), 1500);
		return () => clearTimeout(id);
	});

	let profileOpen = $state(false);
	let accountOpen = $state(false);
	let header = $state<HTMLElement | null>(null);
	let headerHeight = $state<number | null>(null);

	$effect(() => {
		if (!header) return;
		const element = header;
		const measure = () => (headerHeight = element.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	});

	// Reading widens the shell into a two-pane split (feed + article). Stays the
	// narrow reading column otherwise, and on narrow screens where the reader is a
	// full-screen takeover rather than a side pane.
	const isMap = $derived(page.url.pathname === '/graph');
	const shellWidth = $derived(isMap ? 'max-w-none' : page.url.pathname === '/' && reader.isOpen ? 'max-w-2xl lg:max-w-7xl' : 'max-w-2xl');
</script>

{#if savedArticles.isOpen}<SavedPanel onOpen={(title) => { if (page.url.pathname === '/' || page.url.pathname === '/graph') reader.open(title); else void goto(`/?seed=${encodeURIComponent(title)}&reader=${encodeURIComponent(title)}`); }} />{/if}

<!-- overflow-x: clip keeps any over-wide descendant from widening the document. Unlike
     hidden it creates no scroll container, so the sticky header and window scrolling are
     unaffected; fixed and top-layer UI (dialogs, previews, lightbox) is not clipped. -->
<div class="flex min-h-dvh flex-col overflow-x-clip" style:--app-header-height={headerHeight === null ? 'calc(69px + env(safe-area-inset-top))' : `${headerHeight}px`}>
	<!-- Full-bleed bar: the border spans the viewport; only the inner row is
	     constrained to the reading column so the nav doesn't float mid-screen.
	     The inner row's max-width morphs when the reader opens — a deliberate
	     one-shot layout transition (not per-frame); reduced-motion snaps it. -->
	<header bind:this={header} class="sticky top-0 z-20 border-b border-hair bg-void pt-[env(safe-area-inset-top)]">
		<!-- The row is a size container: its labels collapse by the row's own width rather
		     than the viewport's. DESIGN.md (Layout & Navigation) lists the rules new
		     header items follow so the row degrades instead of overflowing. -->
		<div
			class="@container/header-row mx-auto flex w-full items-center gap-3 px-4 py-3
				transition-[max-width] duration-200 ease-out {shellWidth}"
		>
			<!-- The brand slot gets only the width the actions leave over, so the wordmark is
			     the first label to go when the actions grow; the mark itself always stays. -->
			<div class="@container/brand flex min-w-6 flex-1 items-center">
				<!-- -m/p pair grows the tap target to 44px without shifting the visual position. -->
				<a
					href="/"
					class="-m-2.5 inline-flex min-w-11 items-center p-2.5 transition-opacity hover:opacity-80"
					aria-label="Tangent home"
				>
					<BrandMark wordmarkClass="hidden @min-[5.25rem]/brand:inline" />
				</a>
			</div>

			<!-- Actions keep their natural width and wrap onto a second line rather than
			     overflow when the row cannot hold them. -->
			<div class="flex min-w-0 flex-wrap items-center justify-end gap-1 @min-[38rem]/header-row:gap-2">
				<!-- Graph: the explorable canvas. Seeds itself from the feed's chain tip
				     (persisted trail), so mid-feed it opens the map of where you are. -->
				<a
					href="/graph"
					aria-label="Explore the article graph"
					title="Explore the article graph"
					aria-current={page.url.pathname === '/graph' ? 'page' : undefined}
					class="icon-btn hidden items-center justify-center rounded-full p-1.5 @min-[38rem]/header-row:inline-flex
						transition-colors hover:bg-surface-2 hover:text-ink
						{page.url.pathname === '/graph' ? 'text-ink' : 'text-muted'}"
				>
					<!-- Nodes joined by edges — the knowledge-graph glyph, same geometric
					     vocabulary as the relation icons. -->
					<Waypoints class="size-5" aria-hidden="true" />
				</a>

				<button type="button" onclick={() => savedArticles.open()} aria-label="Saved articles" title="Saved articles" class="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"><Star class="size-5" aria-hidden="true" /></button>

				<!-- On the narrowest rows the label gives way to an icon; the text stays in
				     the accessibility tree as the button's name. -->
				<button
					type="button"
					onclick={() => (accountOpen = true)}
					aria-haspopup="dialog"
					aria-expanded={accountOpen}
					class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-sm
						font-medium text-ink transition-colors hover:bg-surface-2"
				>
					<UserRound class="size-5 @min-[16rem]/header-row:hidden" aria-hidden="true" />
					<span class="sr-only @min-[16rem]/header-row:not-sr-only">{auth.isAuthed ? 'Account' : 'Sign in'}</span>
				</button>

				<!-- Settings includes feed preferences and appearance. -->
				<button
					type="button"
					onclick={() => (profileOpen = !profileOpen)}
					aria-label="Settings"
					title="Settings"
					aria-expanded={profileOpen}
					aria-haspopup="dialog"
					class="icon-btn inline-flex items-center justify-center rounded-full p-1.5
						text-muted transition-colors hover:bg-surface-2 hover:text-ink"
				>
					<!-- Sliders identify the settings panel. -->
					<SlidersHorizontal class="size-5" aria-hidden="true" />
				</button>

				{#if profileOpen}
					<ProfilePanel onClose={() => (profileOpen = false)} onAccount={() => (accountOpen = true)} />
				{/if}

				{#if accountOpen}
					<AccountPanel onClose={() => (accountOpen = false)} />
				{/if}

				<!-- Read-fill primary pill (Ben's NewTangent kind): parchment fill with
				     surface-2 text. The read/surface-2 pair inverts naturally in light
				     themes, which is exactly his NewTangentLight colorway. On rows narrower
				     than 24rem it is icon-only; the aria-label keeps the accessible name. -->
				<a
					href="/start"
					data-cta
					aria-label="New tangent"
					class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border
						border-hair bg-read px-3 py-1.5 text-sm font-medium text-surface-2 transition-all
						hover:opacity-90 active:scale-95"
				>
					<Plus class="size-4" aria-hidden="true" />
					<span class="hidden @min-[24rem]/header-row:inline">New tangent</span>
				</a>
			</div>
		</div>
	</header>

	<main
		class={isMap ? 'w-full min-h-0 flex-1' : `mx-auto w-full flex-1 px-4 py-6 transition-[max-width] duration-200 ease-out ${shellWidth}`}
	>
		{@render children()}
	</main>

	<!-- Attribution + legal small-print. Sits below the fold on the infinite feed
	     (the in-feed entry point is in the interests popover); fully reachable on the
	     start and about pages. -->
	{#if !isMap}
	<footer class="border-t border-hair">
		<div
			class="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-5 text-xs text-faint sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2"
		>
			<p>
				Text from
				<a
					href="https://en.wikipedia.org"
					target="_blank"
					rel="noopener noreferrer"
					class="underline decoration-hair-strong underline-offset-2 transition-colors hover:text-muted hover:decoration-muted"
					>Wikipedia</a
				>, licensed
				<a
					href="https://creativecommons.org/licenses/by-sa/4.0/"
					target="_blank"
					rel="noopener noreferrer"
					class="underline decoration-hair-strong underline-offset-2 transition-colors hover:text-muted hover:decoration-muted"
					>CC BY-SA 4.0</a
				>.
			</p>
			<!-- -m/p pairs give these standalone links a 44px touch zone without growing the row. -->
			<nav class="flex items-center gap-5 sm:ml-auto">
				<a
					href="/about"
					class="-mx-1.5 -my-3.5 px-1.5 py-3.5 transition-colors hover:text-muted">About</a
				>
				<a
					href="/terms"
					class="-mx-1.5 -my-3.5 px-1.5 py-3.5 transition-colors hover:text-muted">Terms</a
				>
				<a
					href="https://github.com/707-Labs/tangent"
					target="_blank"
					rel="noopener noreferrer"
					class="-mx-1.5 -my-3.5 px-1.5 py-3.5 transition-colors hover:text-muted">Source</a
				>
			</nav>
		</div>
	</footer>
	{/if}
</div>
