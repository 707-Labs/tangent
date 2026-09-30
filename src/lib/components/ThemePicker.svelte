<script lang="ts">
	import { theme } from '$lib/theme/theme.svelte';
	import { type ThemePreference } from '$lib/theme/themes';

	const options: { id: ThemePreference; label: string }[] = [
		{ id: 'system', label: 'System' },
		{ id: 'daylight', label: 'Light' },
		{ id: 'nightstand', label: 'Dark' },
		{ id: 'high-contrast', label: 'High contrast' }
	];
</script>

<div class="grid grid-cols-2 gap-2" role="group" aria-label="Theme">
	{#each options as opt (opt.id)}
		{@const selected = theme.preference === opt.id}
		<button
			type="button"
			aria-pressed={selected}
			onclick={() => theme.set(opt.id)}
			class="min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors
				{selected ? 'border-accent/60 bg-accent/10 text-accent' : 'border-hair text-muted hover:border-hair-strong hover:text-ink'}"
		>
			{opt.label}
		</button>
	{/each}
</div>
