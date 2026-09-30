<script lang="ts">
	import { auth } from '$lib/auth/authState.svelte';
	import Drawer from './Drawer.svelte';
	import AccountSection from './AccountSection.svelte';

	let { onClose }: { onClose: () => void } = $props();
</script>

<Drawer title={auth.isAuthed ? 'Account' : 'Sign in'} closeLabel={auth.isAuthed ? 'Close account' : 'Close sign in'} {onClose}>
	{#snippet children()}
		<div class="p-4">
			<AccountSection />
		</div>
	{/snippet}
</Drawer>
