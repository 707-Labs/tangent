<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { SearchResult } from '$lib/wikipedia/types';
	import type { PageProps } from './$types';
	import { randomSeed, SEED_CATEGORIES } from '$lib/seeds';
	import RelationIcon from '$lib/components/RelationIcon.svelte';
	import {
		Search,
		Landmark,
		PawPrint,
		Mountain,
		Palette,
		Telescope,
		FlaskConical
	} from '@lucide/svelte';

	// `data.today` is a streamed promise: the shell paints immediately and the shelves
	// fill in when Wikipedia's Main Page picks arrive (server-cached per UTC day).
	let { data }: PageProps = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let highlighted = $state(-1);
	let searchError = $state(false);
	let resultsQuery = $state('');
	let searchOpen = $state(true);
	let todayTitles = $state<string[]>([]);

	// Daily picks enrich the surprise pool when ready. Starting a tangent never
	// waits on that optional upstream request.
	onMount(() => {
		void data.today
			.then((today) => {
				todayTitles = today.sections.flatMap((section) => section.picks.map((pick) => pick.title));
			})
			.catch(() => {});
	});

	// One icon per mood tile, from the same geometric icon set the rest of the UI uses.
	const MOOD_ICONS = {
		history: Landmark,
		animals: PawPrint,
		geography: Mountain,
		culture: Palette,
		space: Telescope,
		science: FlaskConical
	} as const;

	/** "July 25" from the feed's ISO date, pinned to UTC like the feed itself. */
	function prettyDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${iso}T00:00:00Z`));
	}

	// Keep loading and no-match states in the popup; Escape and blur dismiss it.
	const showResults = $derived(searchOpen && query.trim().length >= 2);
	// A pending response from the previous query must never be selectable or
	// submitted, including before the debounced effect has run.
	const currentResults = $derived(resultsQuery === query.trim() ? results : []);

	// Cards and chips render as real links to this URL (middle-click, hover preload);
	// enter() covers the imperative paths — search submit and "Surprise me".
	function seedHref(title: string): string {
		return `/?seed=${encodeURIComponent(title)}`;
	}

	function enter(title: string) {
		goto(seedHref(title));
	}

	// "Surprise me" favors today's fresh Main Page picks when they've loaded, so the day's
	// interesting stuff pops up at the start of a tangent — falling back to the evergreen
	// curated seeds otherwise (and some of the time regardless, to keep old favorites in play).
	function surprise() {
		if (todayTitles.length > 0 && Math.random() < 0.6) {
			enter(todayTitles[Math.floor(Math.random() * todayTitles.length)]);
		} else {
			enter(randomSeed().title);
		}
	}

	function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		const top =
			(showResults && highlighted >= 0
				? currentResults[highlighted]?.title
				: currentResults[0]?.title) ?? query.trim();
		if (top) enter(top);
	}

	// Debounced typeahead search.
	$effect(() => {
		const q = query.trim();
		results = [];
		resultsQuery = '';
		highlighted = -1;
		searchError = false;
		if (q.length < 2) {
			loading = false;
			return;
		}
		const controller = new AbortController();
		loading = true;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
					signal: controller.signal
				});
				if (!res.ok) throw new Error('Search unavailable');
				const payload = (await res.json()) as { results: SearchResult[] };
				if (!controller.signal.aborted) {
					results = payload.results ?? [];
					resultsQuery = q;
				}
			} catch {
				if (!controller.signal.aborted) searchError = true;
			} finally {
				if (!controller.signal.aborted) loading = false;
			}
		}, 220);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	});

	// Keyboard selection stays visible even in a long results popup.
	$effect(() => {
		if (showResults && highlighted >= 0) {
			document.getElementById(`start-result-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
		}
	});
</script>

<svelte:head>
	<title>Start a rabbit hole · Tangent</title>
</svelte:head>

<div class="mx-auto flex w-full min-w-0 flex-col items-center pt-4 pb-12 text-center sm:pt-8">
	<h1 class="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
		Fall down a rabbit hole
	</h1>
	<p class="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
		Pick a topic and see where it takes you.
	</p>

	<form onsubmit={onSubmit} class="relative mt-8 w-full max-w-md">
		<Search
			class="pointer-events-none absolute top-4 left-4 size-5 text-faint"
			aria-hidden="true"
		/>
		<input
			type="search"
			bind:value={query}
			placeholder="Search any topic…"
			aria-label="Search topics"
			autocomplete="off"
			role="combobox"
			aria-autocomplete="list"
			aria-describedby="search-help"
			aria-expanded={showResults}
			aria-controls={showResults ? 'search-listbox' : undefined}
			aria-activedescendant={showResults && currentResults[highlighted] ? `start-result-${highlighted}` : undefined}
			onfocus={() => (searchOpen = true)}
			oninput={() => (searchOpen = true)}
			onblur={() => {
				searchOpen = false;
				highlighted = -1;
			}}
			onkeydown={(e) => {
				if (e.key === 'ArrowDown') {
					e.preventDefault();
					searchOpen = true;
					highlighted = Math.min(highlighted + 1, currentResults.length - 1);
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					highlighted = Math.max(highlighted - 1, -1);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					searchOpen = false;
					highlighted = -1;
				}
			}}
			class="w-full rounded-2xl border border-hair bg-surface/80 py-3.5 pr-4 pl-11 text-ink
				placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent
				focus:ring-offset-2 focus:ring-offset-void focus:outline-none"
		/>

		{#if showResults}
			<ul
				id="search-listbox"
				role="listbox"
				class="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-hair
					max-h-80 overflow-y-auto bg-surface text-left shadow-card"
			>
				{#if loading || (resultsQuery !== query.trim() && !searchError)}
					<li role="presentation" class="px-4 py-3 text-sm text-faint">Searching Wikipedia…</li>
				{:else if searchError}
					<li role="presentation" class="px-4 py-3 text-sm text-faint">Search is unavailable. Try again, or pick a topic below.</li>
				{:else if currentResults.length === 0}
					<li role="presentation" class="px-4 py-3 text-sm text-faint">No matches. Try another topic, or press Enter to open this title.</li>
				{:else}
					{#each currentResults as result, index (result.title)}
						<li role="option" id="start-result-{index}" aria-selected={highlighted === index}>
							<button
								type="button"
								tabindex="-1"
								onpointerdown={(event) => event.preventDefault()}
								onclick={() => enter(result.title)}
								class="flex w-full items-center gap-3 px-4 py-2.5 text-left
									transition-colors hover:bg-surface-2 {highlighted === index ? 'bg-surface-2' : ''}"
							>
								{#if result.thumbnail}
									<img
										src={result.thumbnail.source}
										alt=""
										loading="lazy"
										class="size-9 shrink-0 rounded-lg object-cover"
									/>
								{:else}
									<span
										class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2
											text-xs text-faint">{result.title.slice(0, 1)}</span
									>
								{/if}
								<span class="min-w-0">
									<span class="block truncate text-sm font-medium text-ink">{result.title}</span>
									{#if result.description}
										<span class="block truncate text-xs text-faint">{result.description}</span>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		{/if}
		<p id="search-help" class="mt-2 text-xs text-faint">Try a person, place, or idea.</p>
		<p class="sr-only" role="status" aria-live="polite">
			{showResults ? loading ? 'Searching Wikipedia' : searchError ? 'Search unavailable' : `${currentResults.length} results` : ''}
		</p>
	</form>

	<button
		type="button"
		onclick={surprise}
		class="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-spark/30 bg-spark/5
			px-5 py-2 text-sm font-medium text-spark transition-all hover:bg-spark/10 active:scale-95"
	>
		<RelationIcon relation="surprise" class="size-4" />
		Surprise me
	</button>

	<!-- Mood tiles: the categories entry point, promoted to the front door. One tap
	     dives straight into a curated seed from that subject — starting is the whole
	     struggle, so a tile launches the run instead of opening another menu. -->
	<section class="mt-9 w-full text-left" aria-labelledby="moods-heading">
		<h2 id="moods-heading" class="font-display text-xl font-semibold text-ink">Choose a topic</h2>
		<div class="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
			{#each SEED_CATEGORIES as cat (cat.id)}
				{@const MoodIcon = MOOD_ICONS[cat.id]}
				<button
					type="button"
					onclick={() => enter(randomSeed(cat.id).title)}
					class="group flex flex-col items-center gap-2 rounded-2xl border border-hair
						bg-surface/60 px-2 py-4 transition-all hover:border-accent/50 hover:bg-surface
						active:scale-95"
				>
					<MoodIcon class="size-5 text-muted transition-colors group-hover:text-accent" />
					<span class="text-sm font-medium text-ink">{cat.label}</span>
				</button>
			{/each}
		</div>
	</section>

	{#await data.today}
		<section class="mt-14 w-full text-left" aria-hidden="true">
			<h2 class="font-display text-xl font-semibold text-ink">Today on Wikipedia</h2>
			<p class="mt-1 text-sm text-muted">From the front page. Updated daily.</p>

			<div class="mt-6 flex flex-col gap-8">
				<!-- First block mirrors the "On this day" timeline rows, second the DYK
				     card shelf, so the stream-in doesn't shift the layout. -->
				<div>
					<div class="mb-3 h-4 w-28 animate-pulse rounded bg-surface-2"></div>
					<div class="overflow-hidden rounded-2xl border border-hair">
						{#each { length: 4 }, i (i)}
							<div
								class="h-16 animate-pulse border-b border-hair bg-surface-2/60 last:border-b-0"
							></div>
						{/each}
					</div>
				</div>
				<div>
					<div class="mb-3 h-4 w-28 animate-pulse rounded bg-surface-2"></div>
					<div class="no-scrollbar shelf-fade -mx-1 flex gap-3 overflow-x-hidden px-1 pb-2">
						{#each { length: 6 }, i (i)}
							<div class="h-64 w-56 shrink-0 animate-pulse rounded-2xl bg-surface-2"></div>
						{/each}
					</div>
				</div>
			</div>
		</section>
	{:then today}
		{#if today.sections.length > 0}
			<section class="mt-14 w-full text-left">
				<h2 class="font-display text-xl font-semibold text-ink">Today on Wikipedia</h2>
				<p class="mt-1 text-sm text-muted">From the front page. Updated daily.</p>

				<div class="mt-6 flex flex-col gap-8">
					{#each today.sections as section (section.id)}
						<div>
							<h3 class="mb-3 text-sm font-semibold text-ink">
								{section.id === 'onthisday'
									? `${section.label} · ${prettyDate(today.date)}`
									: section.label}
							</h3>
							{#if section.id === 'onthisday'}
								<!-- Timeline list, not a card shelf: the event sentence IS the hook, so
								     it gets the full line — and every row is a ready-made tangent launch
								     seeded from the event's best article. -->
								<ol class="overflow-hidden rounded-2xl border border-hair bg-surface/60">
									{#each section.picks as pick (pick.title)}
										<li class="border-b border-hair last:border-b-0">
											<a
												href={seedHref(pick.title)}
												class="group flex items-start gap-4 px-4 py-3.5 transition-colors
													hover:bg-surface-2"
											>
												<span
													class="w-12 shrink-0 pt-px text-right font-display text-sm
														font-semibold text-accent tabular-nums">{pick.year ?? '·'}</span
												>
												<span class="min-w-0 flex-1">
													<span class="block text-sm leading-relaxed text-read"
														>{pick.hook ?? pick.title}</span
													>
													{#if pick.hook}
														<span
															class="mt-1.5 inline-flex items-center gap-1.5 text-xs
																font-medium text-faint transition-colors
																group-hover:text-accent"
														>
															<RelationIcon relation="seed" class="size-3.5" />
															Tangent from {pick.title}
														</span>
													{/if}
												</span>
												{#if pick.thumbnail}
													<img
														src={pick.thumbnail.source}
														alt=""
														loading="lazy"
														class="mt-0.5 size-12 shrink-0 rounded-lg object-cover"
													/>
												{/if}
											</a>
										</li>
									{/each}
								</ol>
							{:else if section.id === 'featured'}
								<!-- Single pick, so it gets a full-width hero card instead of a
								     one-card shelf. Stays mid-list — fetchToday deliberately keeps
								     the often-topical featured article out of the lead slot. -->
								{@const pick = section.picks[0]}
								<a
									href={seedHref(pick.title)}
									class="flex flex-col overflow-hidden rounded-2xl border border-hair
										bg-surface/60 text-left transition-all hover:border-accent/50
										active:scale-[0.99] sm:flex-row"
								>
									{#if pick.thumbnail}
										<img
											src={pick.thumbnail.source}
											alt=""
											loading="lazy"
											class="h-44 w-full object-cover sm:h-auto sm:w-52 sm:shrink-0"
										/>
									{/if}
									<div class="flex min-w-0 flex-col gap-1.5 p-5">
										<span class="font-display text-lg font-semibold text-ink">{pick.title}</span>
										{#if pick.description}
											<span class="text-xs text-faint">{pick.description}</span>
										{/if}
										{#if pick.hook}
											<p class="mt-1 line-clamp-3 text-sm leading-relaxed text-muted">
												{pick.hook}
											</p>
										{/if}
									</div>
								</a>
							{:else}
								<!-- Horizontal shelf: clips + scrolls within the reading column so a long
								     row never widens the page. -->
								<!-- On DYK cards the hook IS the content — the title just names the
								     subject — so they get a wider card and a deep clamp instead of the
								     2-line teaser the other shelves use. -->
								{@const isDyk = section.id === 'dyk'}
								<div class="no-scrollbar shelf-fade -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
									{#each section.picks as pick (pick.title)}
										<a
											href={seedHref(pick.title)}
											class="flex {isDyk ? 'w-56' : 'w-44'} shrink-0 snap-start flex-col
												overflow-hidden rounded-2xl border border-hair bg-surface/60 text-left
												transition-all hover:border-accent/50 active:scale-[0.98]"
										>
											{#if pick.thumbnail}
												<img
													src={pick.thumbnail.source}
													alt=""
													loading="lazy"
													class="h-24 w-full object-cover"
												/>
											{:else}
												<div
													class="flex h-24 w-full items-center justify-center bg-surface-2 text-2xl
														text-faint"
												>
													{pick.title.slice(0, 1)}
												</div>
											{/if}
											<div class="flex min-w-0 flex-1 flex-col gap-1 p-3">
												{#if pick.year}
													<span class="text-[11px] font-semibold tracking-wide text-accent"
														>{pick.year}</span
													>
												{/if}
												<span class="line-clamp-2 text-sm font-medium text-ink">{pick.title}</span>
												{#if pick.hook}
													<span
														class="{isDyk
															? 'line-clamp-6'
															: 'line-clamp-2'} text-xs leading-snug text-faint">{pick.hook}</span
													>
												{:else if pick.description}
													<span class="line-clamp-2 text-xs leading-snug text-faint"
														>{pick.description}</span
													>
												{/if}
											</div>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/await}

	<div class="mt-12 w-full">
		<h2 class="mb-4 font-display text-xl font-semibold text-ink">More places to start</h2>

		<div class="flex flex-wrap justify-center gap-2">
			{#each data.seeds as seed (seed.title)}
				<a
					href={seedHref(seed.title)}
					class="rounded-full border border-hair bg-surface/60 px-3 py-1.5 text-sm
						text-muted transition-all hover:border-accent/50 hover:text-ink active:scale-95"
				>
					{seed.title}
				</a>
			{/each}
		</div>
	</div>
</div>
