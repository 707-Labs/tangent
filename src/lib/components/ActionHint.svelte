<script lang="ts">
	import { Star, BookOpen, ArrowRight, X } from '@lucide/svelte';
	import { actionHint } from '$lib/feed/hint.svelte';

	// Consult localStorage only after mount, so the first client render matches the SSR
	// output (which renders nothing). See hint.svelte.ts for why visible starts false.
	$effect(() => {
		actionHint.reveal();
	});
</script>

{#if actionHint.visible}
	<!-- One-time orientation for the feed actions, dismissed on first interaction. -->
	<div
		class="animate-rise relative rounded-[var(--radius-card)] border border-hair bg-surface/70 px-4 py-3
			pr-14 text-sm"
	>
		<button
			type="button"
			onclick={() => actionHint.dismiss()}
			aria-label="Dismiss tip"
			class="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full p-1.5 text-faint transition-colors
				hover:text-ink"
		>
			<X class="size-4" aria-hidden="true" />
		</button>

		<p class="mb-2 font-display font-medium text-ink">Ways to explore</p>
		<ul class="space-y-1.5 text-muted">
			<li class="flex items-start gap-2">
				<BookOpen class="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
				<span><span class="font-medium text-ink">Read article</span> opens the full article.</span>
			</li>
			<li class="flex items-start gap-2">
				<Star class="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
				<span><span class="font-medium text-ink">Remember interest</span> tunes future suggestions.</span>
			</li>
			<li class="flex items-start gap-2">
				<ArrowRight class="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
				<span
					><span class="font-medium text-ink">Follow related</span> adds a new topic to this tangent.</span
				>
			</li>
		</ul>
	</div>
{/if}
