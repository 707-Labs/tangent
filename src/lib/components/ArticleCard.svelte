<script lang="ts">
	import type { FeedCard } from '$lib/feed/types';
	import { Star, BookOpen, LoaderCircle, ArrowRight } from '@lucide/svelte';
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
	let tipsDismissed = $state(false);
	let interacted = false;
	function handleActionKey(event: KeyboardEvent) {
		if (event.key === 'Escape') { tipsDismissed = true; event.stopPropagation(); }
	}
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
		if (el?.closest('button, a, [role="tooltip"]')) return;
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

<!-- Tap-to-open is a convenience; the keyboard-accessible path is the Read button. -->
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
		<div class="flex items-center gap-2 border-t border-hair pt-3" class:tips-dismissed={tipsDismissed}
			role="group" aria-label="Article actions"
			onfocusin={() => tipsDismissed = false} onpointerenter={() => tipsDismissed = false}>
			<div class="card-action">
				<button type="button" onclick={read} onkeydown={handleActionKey} aria-label={`Read article: ${article.title}`}
					aria-describedby={`read-help-${card.id}`}
					class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-read px-4 py-2 text-sm
						font-medium text-surface-2 transition-opacity hover:opacity-90">
					<BookOpen class="size-4 shrink-0" aria-hidden="true" />
					Read
				</button>
				<span class="card-action-tip" role="tooltip" id={`read-help-${card.id}`}>Open the full article.</span>
			</div>
			<div class="card-action">
				<button type="button" onclick={branch} onkeydown={handleActionKey} disabled={branching}
					aria-label={`Explore a related topic: ${article.title}`}
					aria-describedby={`explore-help-${card.id}`} aria-busy={branching}
					class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-2 py-2
						text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50">
					Explore
					{#if branching}<LoaderCircle class="size-4 shrink-0 animate-spin" aria-hidden="true" />
					{:else}<ArrowRight class="size-4 shrink-0" aria-hidden="true" />{/if}
				</button>
				<span class="card-action-tip" role="tooltip" id={`explore-help-${card.id}`}>Continue from this topic.</span>
			</div>
			<div class="card-action card-action-end ml-auto">
				<button
					type="button"
					onclick={toggleLike}
					onkeydown={handleActionKey}
					aria-pressed={liked}
					aria-label={liked ? `Forget interest in ${article.title}` : `Remember interest in ${article.title}`}
					aria-describedby={`interest-help-${card.id}`}
					class="inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors
						{liked ? 'text-like hover:bg-surface-2' : 'text-muted hover:bg-surface-2 hover:text-ink'}"
				>
					<Star class="size-[18px]" fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
				</button>
				<span class="card-action-tip" role="tooltip" id={`interest-help-${card.id}`}>
					{liked ? 'Remove this interest.' : 'Use this topic for future suggestions.'}
				</span>
			</div>
		</div>
		{/if}
	</div>
</div>

<style>
	.card-action { position: relative; display: inline-flex; }
	.card-action-tip {
		position: absolute;
		z-index: 1;
		bottom: calc(100% + 0.375rem);
		left: 0;
		width: max-content;
		max-width: min(15rem, calc(100vw - 3.5rem));
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-hair-strong);
		border-radius: 0.5rem;
		background: var(--color-surface-2);
		color: var(--color-ink);
		font-size: 0.75rem;
		line-height: 1.4;
		visibility: hidden;
	}
	.card-action-end .card-action-tip { left: auto; right: 0; }
	.card-action-tip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		height: 0.375rem;
	}
	.card-action:has(button:focus-visible) .card-action-tip { visibility: visible; }
	@media (hover: hover) {
		.card-action:hover .card-action-tip { visibility: visible; }
	}
	.tips-dismissed .card-action-tip { display: none; }
</style>
