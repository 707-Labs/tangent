<script module lang="ts">
	let jumpToCard: ((id: string) => void) | null = null;

	/**
	 * The feed page provides an in-place jump while it is mounted, so choosing an entry
	 * there scrolls the live feed instead of navigating. Returns the release function.
	 */
	export function provideCardJump(jump: (id: string) => void): () => void {
		jumpToCard = jump;
		return () => {
			if (jumpToCard === jump) jumpToCard = null;
		};
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { feed } from '$lib/feed/feedState.svelte';
	import { loadTrail } from '$lib/feed/trail';
	import type { Relation } from '$lib/feed/types';
	import RelationIcon from './RelationIcon.svelte';

	let {
		onNavigate
	}: {
		/** Runs when an entry is chosen, before the jump (the drawer closes itself). */
		onNavigate: () => void;
	} = $props();

	const headingId = $props.id();

	// The live feed's trail. Where the feed has not loaded (a reload of /about, say), this
	// tab's stored copy of the same trail, which the feed restores from on arrival.
	const source = $derived(
		feed.trail.length > 0 && feed.seedTitle
			? { seedTitle: feed.seedTitle, trail: feed.trail }
			: browser
				? loadTrail()
				: null
	);
	const reached = $derived(source?.trail.filter((node) => node.seen) ?? []);

	function relationColor(relation: Relation): string {
		if (relation === 'surprise') return 'text-spark';
		return relation === 'seed' || relation === 'dive' ? 'text-accent' : 'text-muted';
	}

	/** The feed URL for a waypoint: the feed restores this trail and scrolls to the card. */
	function waypointHref(seedTitle: string, id: string): string {
		return `/?seed=${encodeURIComponent(seedTitle)}&card=${encodeURIComponent(id)}`;
	}

	function choose(event: MouseEvent, href: string, id: string): void {
		onNavigate();
		// Modified clicks keep the browser's own handling (new tab or window).
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		if (jumpToCard) jumpToCard(id);
		else void goto(href);
	}
</script>

<section aria-labelledby={headingId} class="border-t border-hair py-4">
	<h3 id={headingId} class="px-4 text-sm font-medium text-muted">History</h3>
	<p class="px-4 pt-1 text-xs text-faint">Articles you've reached in this tangent, kept on this device.</p>
	{#if source && reached.length}
		<ol class="mt-2">
			{#each reached as node (node.id)}
				{@const href = waypointHref(source.seedTitle, node.id)}
				<li>
					<a
						{href}
						onclick={(event) => choose(event, href, node.id)}
						class="flex min-h-11 items-center gap-2 px-4 py-2.5 transition-colors hover:bg-surface-2
							{node.isDetour ? 'ml-4 border-l-2 border-dashed border-hair pl-3 opacity-60' : ''}"
					>
						<span class="shrink-0 {relationColor(node.relation)}">
							<RelationIcon relation={node.relation} />
						</span>
						<span class="min-w-0 flex-1 truncate text-sm text-ink">{node.title}</span>
					</a>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="mt-3 px-4 text-sm text-muted">Nothing yet.</p>
	{/if}
</section>
