<script lang="ts">
	import type { TrailNode } from '$lib/feed/types';
	import Drawer from './Drawer.svelte';
	import RelationIcon from './RelationIcon.svelte';

	let {
		trail,
				onClose,
		onSelect
	}: {
		trail: TrailNode[];
				onClose: () => void;
		onSelect: (id: string) => void;
	} = $props();
</script>

<Drawer title="Your trail" badge={trail.length} closeLabel="Close trail" {onClose}>
	{#snippet children(close)}
		<div class="py-2">
			{#each trail as node (node.id)}
				<!-- Older waypoints load their article on demand. -->
				<button
					type="button"
					onclick={() => {
						onSelect(node.id);
						close();
					}}
					class="flex w-full items-start gap-2 px-4 py-2.5 text-left
						transition-colors hover:bg-surface-2
						disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent
						{node.isDetour ? 'ml-4 border-l-2 border-dashed border-hair pl-3 opacity-60' : ''}"
				>
					<!-- Relation icon (shared geometric set) -->
					<span
						class="mt-0.5 shrink-0 {node.relation === 'surprise'
							? 'text-spark'
							: node.relation === 'seed'
								? 'text-accent'
								: node.relation === 'dive'
									? 'text-accent'
									: 'text-muted'}"
					>
						<RelationIcon relation={node.relation} />
					</span>

					<span class="min-w-0 flex-1 truncate text-sm text-ink">{node.title}</span>
				</button>
			{/each}
		</div>
	{/snippet}
</Drawer>
