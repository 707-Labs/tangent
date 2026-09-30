<script lang="ts">
	import type { FeedCard } from '$lib/feed/types';
	import { Star, CirclePlus, LoaderCircle, ArrowRight } from '@lucide/svelte';
	import { FEED } from '$lib/feed/config';
	import { DwellTracker } from '$lib/engagement/dwell';
	import { profile } from '$lib/engagement/profile.svelte';
	import { feed } from '$lib/feed/feedState.svelte';
	import { track } from '$lib/metrics';
	import { actionHint } from '$lib/feed/hint.svelte';
	import ConnectionBreadcrumb from './ConnectionBreadcrumb.svelte';

	let {
		card,
		onBranch,
		onRead,
		onNavigateToSource,
		onSeen
	}: {
		card: FeedCard;
		onBranch: (card: FeedCard) => Promise<void> | void;
		onRead: (card: FeedCard) => void;
		/** Jump to the card this one branched/linked/dove from, if it's in view. */
		onNavigateToSource?: () => void;
		/** Fired once when this card first scrolls into view — joins it to the trail. */
		onSeen?: () => void;
	} = $props();

	const article = $derived(card.article);
	const liked = $derived(profile.isLiked(article.title));
	// An optimistic dive placeholder: title + breadcrumb are real, the body is still
	// loading. We show its title immediately (the landing animation already played) and
	// a skeleton body, and suppress interactions until the real article patches in.
	const pending = $derived(card.pending ?? false);

	let branching = $state(false);
	let interacted = false;
	// Wikipedia thumbnails (especially body-scraped fallbacks) sometimes 404. The inset
	// is decorative garnish, so a broken one collapses rather than showing a broken box.
	let imageFailed = $state(false);

	async function branch() {
		if (branching) return;
		interacted = true;
		actionHint.dismiss();
		profile.recordBranch(article);
		track('branch', { title: article.title });
		branching = true;
		try {
			await onBranch(card);
		} finally {
			branching = false;
		}
	}

	function read() {
		interacted = true;
		actionHint.dismiss();
		profile.recordClickthrough(article);
		track('article_opened', { title: article.title });
		onRead(card);
	}

	function toggleLike() {
		interacted = true;
		actionHint.dismiss();
		profile.toggleLike(article);
		// Count the like, not the unlike — track only when it flips on.
		if (profile.isLiked(article.title)) track('like', { title: article.title });
	}

	// Tapping anywhere on the card (except buttons/links) opens the reader.
	function handleCardTap(event: MouseEvent) {
		if (pending) return; // nothing to read yet
		const el = event.target as HTMLElement | null;
		if (el?.closest('button, a')) return;
		if (window.getSelection()?.toString()) return;
		read();
	}

	// Learn from foreground reading only; hiding the page is not a rejection.
	let el = $state<HTMLElement | null>(null);
	const dwell = new DwellTracker(FEED.skipMinVisibleMs, FEED.skipThresholdMs);
	let hasSignaledSeen = false;

	function recordDwell(ms: number) {
		if (ms > 0) profile.recordDwell(article, ms);
	}

	$effect(() => {
		if (!el) return;
		// Re-observe when a placeholder resolves so its real body can start accruing time.
		const isPending = pending;
		let inView = false;
		function updateVisibility() {
			const pageVisible = document.visibilityState === 'visible';
			const signal = dwell.update(
				{ inView, pageVisible, pending: isPending, interacted },
				performance.now()
			);
			recordDwell(signal.dwellMs);
			if (signal.skipped) {
				profile.recordSkip(article);
				track('skip', { title: article.title });
				// Resume from the pre-tangent tip when a foreground reader rejects a jump.
				if (card.connection.relation === 'surprise') feed.heal(card.id);
			}
			if (inView && pageVisible && !hasSignaledSeen) {
				hasSignaledSeen = true;
				onSeen?.();
			}
		}

		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
					updateVisibility();
				}
			},
			{ threshold: [0, 0.5, 1] }
		);
		io.observe(el);
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
			io.disconnect();
			document.removeEventListener('visibilitychange', updateVisibility);
			recordDwell(dwell.finish(performance.now()));
		};
	});
</script>

<!-- Tap-to-open is a convenience; the keyboard-accessible path is the "Read article" button. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	bind:this={el}
	onclick={handleCardTap}
	class="animate-rise block cursor-pointer overflow-hidden rounded-[var(--radius-card)] border border-hair
		bg-surface shadow-card transition-colors hover:border-hair-strong"
>
	<div class="space-y-3 p-5 sm:p-6">
		<ConnectionBreadcrumb connection={card.connection} onNavigate={onNavigateToSource} />

		<!-- Keep the thumbnail beside the heading, so the summary uses the full card width. -->
		<div class="flex items-start gap-4">
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
					{article.title}
				</h2>
				{#if !pending && article.description}
					<p class="mt-1 font-display text-[15px] text-faint italic">{article.description}</p>
				{/if}
			</div>

			{#if article.thumbnail && !imageFailed}
				<!-- Decorative: the title alongside already names it, so alt is empty. -->
				<img
					src={article.thumbnail.source}
					alt=""
					loading="lazy"
					onerror={() => (imageFailed = true)}
					class="mt-1 size-20 shrink-0 rounded-xl border border-hair object-cover object-top sm:size-24"
				/>
			{/if}
		</div>

		{#if pending}
			<!-- Keep the placeholder shorter than the real body to avoid a shrinking dive landing. -->
			<div class="space-y-2" aria-hidden="true">
				<div class="h-3 w-full animate-pulse rounded-full bg-surface-2"></div>
				<div class="h-3 w-full animate-pulse rounded-full bg-surface-2"></div>
				<div class="h-3 w-4/5 animate-pulse rounded-full bg-surface-2"></div>
			</div>
			<p class="sr-only">Loading article…</p>
		{:else}
			<!-- The full summary is the hook; don't clamp it to a stub. -->
			<p class="text-base leading-normal text-muted">{article.extract}</p>
		{/if}

		{#if !pending}
		<div class="flex flex-wrap items-center gap-2 pt-1">
			<button
				type="button"
				onclick={toggleLike}
				aria-pressed={liked}
				aria-label={liked ? `Unlike ${article.title}` : `Like ${article.title}`}
				title="Remember this topic for future tangents"
				class="group inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm
					font-medium transition-all active:scale-95
					{liked
					? 'border-like/40 bg-like/10 text-like'
					: 'border-hair text-muted hover:border-hair-strong hover:text-ink'}"
			>
				<!-- Favorite star — filled when active. -->
				<Star
					class="size-4 transition-transform group-active:scale-110"
					fill={liked ? 'currentColor' : 'none'}
					aria-hidden="true"
				/>
				{liked ? 'Liked' : 'Like'}
			</button>

			<!-- Read-fill primary pill (Ben's NewTangent kind), matching the nav CTA. -->
			<button
				type="button"
				onclick={branch}
				disabled={branching}
				aria-label={`More like this: ${article.title}`}
				title="Follow a related article now"
				class="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hair bg-read px-3
					py-1.5 text-sm font-medium text-surface-2 transition-all hover:opacity-90
					active:scale-95 disabled:opacity-50"
			>
				{#if branching}
					<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
				{:else}
					<CirclePlus class="size-4" aria-hidden="true" />
				{/if}
				More like this
			</button>

			<button
				type="button"
				onclick={read}
				aria-label={`Read article: ${article.title}`}
				title="Open the full article"
				class="group ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm
					font-medium text-muted transition-colors hover:text-ink"
			>
				Read article
				<!-- Arrow, not a chevron: this opens the reader pane, it doesn't expand in place. -->
				<ArrowRight class="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
			</button>
		</div>
		{/if}
	</div>
</div>
