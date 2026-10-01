<script lang="ts">
	import { Star, X } from '@lucide/svelte';
	import { savedArticles } from '$lib/saved/saved.svelte';
	import Drawer from './Drawer.svelte';
	let { onOpen }: { onOpen?: (title: string) => void } = $props();
</script>

<Drawer title="Saved" badge={savedArticles.items.length} closeLabel="Close saved articles" onClose={() => savedArticles.close()}>
	{#snippet children(close)}
		<p class="px-4 pt-4 text-xs text-faint">Saved on this device.</p>
		{#if !savedArticles.items.length}
			<div class="px-4 py-8 text-sm text-muted"><Star class="mb-3 size-5" aria-hidden="true" />Star an article to keep it here.</div>
		{:else}
			<ul class="py-3">
				{#each savedArticles.items as item (item.title)}
					<li class="flex items-start gap-2 px-4 py-2">
						<a href={`/?seed=${encodeURIComponent(item.title)}&reader=${encodeURIComponent(item.title)}`}
							class="min-h-11 min-w-0 flex-1 rounded-lg py-2 text-ink hover:text-accent"
							onclick={(event) => { if (onOpen && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); close(); onOpen(item.title); } else close(); }}>
							<span class="block font-display text-lg leading-snug">{item.title}</span>
							{#if item.description}<span class="mt-1 block text-xs text-muted">{item.description}</span>{/if}
						</a>
						<button type="button" aria-label={`Remove saved article: ${item.title}`} onclick={() => savedArticles.remove(item.title)}
							class="flex size-11 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-ink"><X class="size-4" aria-hidden="true" /></button>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</Drawer>
