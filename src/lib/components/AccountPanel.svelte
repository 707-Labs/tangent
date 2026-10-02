<script lang="ts">
	import { auth } from '$lib/auth/authState.svelte';
	import Drawer from './Drawer.svelte';
	import AccountSection from './AccountSection.svelte';
	import TrailHistory from './TrailHistory.svelte';

	let { onClose }: { onClose: () => void } = $props();
</script>

<Drawer title={auth.isAuthed ? 'Account' : 'Sign in'} closeLabel={auth.isAuthed ? 'Close account' : 'Close sign in'} {onClose}>
	{#snippet children(close)}
		<div class="p-4">
			<AccountSection />
		</div>
		<!-- The reading trail is device-local, so History shows whether or not you're signed in. -->
		<TrailHistory onNavigate={close} />
	{/snippet}
</Drawer>
