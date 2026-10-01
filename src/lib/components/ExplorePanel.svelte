<script lang="ts">
	import { onMount } from 'svelte';
	import type { Article, Candidate } from '$lib/wikipedia/types';
	import { exploreChoices, loadExplore, type ExploreChoice } from '$lib/feed/explore';
	import Drawer from './Drawer.svelte';
	let { article, seen, onClose, onChoose }: { article: Article; seen: Set<string>; onClose: () => void; onChoose: (candidate: Candidate) => void } = $props();
	let choices = $state<ExploreChoice[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let disposed = false;
	async function load() {
		loading = true;
		failed = false;
		try { const pool = await loadExplore(article.title); if (!disposed) choices = exploreChoices(article, pool, seen); }
		catch { if (!disposed) failed = true; }
		finally { if (!disposed) loading = false; }
	}
	onMount(() => { void load(); return () => { disposed = true; }; });
</script>

<Drawer title={`From ${article.title}`} closeLabel="Close related topics" {onClose}>
	{#snippet children(close)}
		<div class="p-4">
			{#if loading}<p class="py-4 text-sm text-muted" role="status">Finding topics…</p>
			{:else if failed}<p class="mb-3 text-sm text-muted" role="alert">Couldn’t load topics.</p><button type="button" class="min-h-11 rounded-full border border-hair px-4 text-sm text-ink hover:bg-surface-2" onclick={load}>Retry</button>
			{:else if !choices.length}<p class="py-4 text-sm text-muted">No new topics here. Keep scrolling for another direction.</p>
			{:else}<ul class="space-y-2">
				{#each choices as choice (choice.candidate.title)}
					<li><button type="button" class="w-full rounded-[var(--radius-card)] border border-hair p-4 text-left hover:border-hair-strong hover:bg-surface-2"
						onclick={() => { close(); onChoose(choice.candidate); }}>
						<span class="block text-xs text-spark">{choice.connection}</span>
						<span class="mt-1 block font-display text-xl leading-snug text-ink">{choice.candidate.title}</span>
						{#if choice.candidate.description}<span class="mt-2 block text-sm text-muted">{choice.candidate.description}</span>{/if}
					</button></li>
				{/each}
			</ul>{/if}
		</div>
	{/snippet}
</Drawer>
