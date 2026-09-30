<script lang="ts">
	import type { FeedCard } from '$lib/feed/types';
	import { Star, Check, BookOpen, LoaderCircle, ArrowRight } from '@lucide/svelte';
	import { FEED } from '$lib/feed/config';
	import { DwellTracker } from '$lib/engagement/dwell';
	import { profile } from '$lib/engagement/profile.svelte';
	import { feed } from '$lib/feed/feedState.svelte';
	import { track } from '$lib/metrics';
	import { actionHint } from '$lib/feed/hint.svelte';
	import { cardThumbnail } from '$lib/feed/images';
	import ConnectionBreadcrumb from './ConnectionBreadcrumb.svelte';

	let {
		card,
		showImage = true,
		onImageExhausted,
		onBranch,
		onRead,
		onNavigateToSource,
		onSeen
	}: {
		card: FeedCard;
		/** Repeated file imagery is omitted by the feed without changing article metadata. */
		showImage?: boolean;
		onImageExhausted?: (cardId: string) => void;
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
	// Larger Wikimedia thumbnails can fail for individual formats. Retry the source
	// supplied by Wikipedia once, then omit a broken image without leaving a blank frame.
	let failedSources = $state<string[]>([]);
	const preferredImage = $derived(cardThumbnail(article.thumbnail));
	const image = $derived(preferredImage && !failedSources.includes(preferredImage.source)
		? preferredImage : article.thumbnail);
	function handleImageError(event: Event) {
		const source = (event.currentTarget as HTMLImageElement).getAttribute('src');
		if (source && !failedSources.includes(source)) failedSources = [...failedSources, source];
		if (article.thumbnail && failedSources.includes(article.thumbnail.source) &&
			(!preferredImage || failedSources.includes(preferredImage.source))) onImageExhausted?.(card.id);
	}

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
					// Tall cards should still count as reading once they fill half a viewport.
					inView = entry.isIntersecting && entry.intersectionRect.height >=
						Math.min(entry.boundingClientRect.height, window.innerHeight) * 0.5;
					updateVisibility();
				}
			},
			{ threshold: Array.from({ length: 21 }, (_, index) => index / 20) }
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

		<div class="min-w-0">
			<h2 class="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
				{article.title}
			</h2>
			{#if !pending && article.description}
				<p class="mt-1 font-display text-[15px] text-faint italic">{article.description}</p>
			{/if}
		</div>

		{#if showImage && !pending && image && !failedSources.includes(image.source)}
			<figure class="flex w-full justify-center py-1">
				<img src={image.source} alt="" loading="lazy" decoding="async"
					width={image.width > 0 ? image.width : undefined}
					height={image.height > 0 ? image.height : undefined}
					onerror={handleImageError}
					class="block h-auto w-auto max-h-64 max-w-full rounded-xl border border-hair object-contain sm:max-h-80" />
			</figure>
		{/if}

		{#if pending}
			<!-- Keep the placeholder shorter than the real body to avoid a shrinking dive landing. -->
			<div class="space-y-2" aria-hidden="true">
				<div class="h-3 w-full animate-pulse rounded-full bg-surface-2"></div>
				<div class="h-3 w-full animate-pulse rounded-full bg-surface-2"></div>
				<div class="h-3 w-4/5 animate-pulse rounded-full bg-surface-2"></div>
			</div>
			<p class="sr-only">Loading article…</p>
		{:else}
			<!-- Keep the preview scannable; Read article opens the complete text. -->
			<p class="line-clamp-5 text-base leading-normal text-muted">{article.extract}</p>
		{/if}

		{#if !pending}
		<div class="space-y-3 border-t border-hair pt-4">
			<div class="grid grid-cols-2 gap-2">
				<button type="button" onclick={read} aria-label={`Read article: ${article.title}`}
					class="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-read px-3 py-2.5 text-left text-sm
						font-medium text-surface-2 transition-opacity hover:opacity-90">
					<BookOpen class="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
					<span>Read article<span class="mt-0.5 block text-[11px] font-normal opacity-75">Full text</span></span>
				</button>
				<button type="button" onclick={branch} disabled={branching}
					aria-label={`Follow related topic: ${article.title}`}
					class="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-hair-strong px-3 py-2.5
						text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50">
					{#if branching}<LoaderCircle class="hidden size-4 shrink-0 animate-spin sm:block" aria-hidden="true" />
					{:else}<ArrowRight class="hidden size-4 shrink-0 sm:block" aria-hidden="true" />{/if}
					<span>{branching ? 'Following…' : 'Follow related'}<span class="mt-0.5 block text-[11px] font-normal text-muted">Adds a new topic</span></span>
				</button>
			</div>
			<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<button
				type="button"
				onclick={toggleLike}
				aria-pressed={liked}
				aria-label={liked ? `Forget interest in ${article.title}` : `Remember interest in ${article.title}`}
				title="Use this interest for future suggestions"
				class="group -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 py-1.5 text-sm
					font-medium transition-colors
					{liked
					? 'text-like'
					: 'text-muted hover:bg-surface-2 hover:text-ink'}"
			>
				{#if liked}<Check class="size-4" aria-hidden="true" />
				{:else}<Star class="size-4" aria-hidden="true" />{/if}
				{liked ? 'Interest remembered' : 'Remember interest'}
			</button>
				<p class="text-xs text-faint">Tunes future suggestions</p>
			</div>
		</div>
		{/if}
	</div>
</div>
