<script lang="ts">
	import { tick } from 'svelte';
	import { reader } from '$lib/reader/readerState.svelte';
	import { articleTitleFromHref } from '$lib/wikipedia/links';
	import { localArticleAnchor } from '$lib/reader/anchors';
	import { ARTICLE_RENDER_VERSION } from '$lib/reader/version';
	import LinkPreview from './LinkPreview.svelte';
	import { X } from '@lucide/svelte';
	import { headingAnchor, citationNoteId, sourceDestination, type ContentsEntry } from '$lib/reader/navigation';
	import { loadReadingPosition, saveReadingPosition, readingStorage, nearestReadingAnchor, type ReadingPosition } from '$lib/reader/position';

	let {
		onDive
	}: {
		/** Dive into an in-article link: closes the reader and drops it as a fresh feed card. */
		onDive: (title: string) => void;
	} = $props();

	let asideEl = $state<HTMLElement | null>(null);
	let contentEl = $state<HTMLElement | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);

	let contents = $state<ContentsEntry[]>([]);
	let contentsOpen = $state(false);
	let contentsEl = $state<HTMLElement | null>(null);
	let contentsButton = $state<HTMLButtonElement | null>(null);
	let citation = $state<{ id: string; text: string; links: { href: string; domain: string }[]; top: number; left: number } | null>(null);
	let citationEl = $state<HTMLElement | null>(null);
	let citationTrigger: HTMLElement | null = null;

	function dismissCitation(restore = false): void {
		citation = null;
		if (restore) citationTrigger?.focus({ preventScroll: true });
	}
	function visitSection(id: string): void {
		const target = [...(contentEl?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(node => node.id === id);
		if (!target) return;
		for (let parent = target.parentElement; parent && parent !== contentEl; parent = parent.parentElement) {
			if (parent instanceof HTMLDetailsElement) parent.open = true;
		}
		contentsOpen = false;
		scrollReaderTo(target);
		target.tabIndex = -1;
		target.focus({ preventScroll: true });
	}
	function showCitation(target: Element, trigger: HTMLElement): void {
		const copy = target.cloneNode(true) as HTMLElement;
		copy.querySelectorAll('.mw-cite-backlink, .wh-source-action, .cs1-maint, .cs1-hidden-error').forEach(node => node.remove());
		const links = [...target.querySelectorAll<HTMLAnchorElement>('.wh-source-visit')]
			.map(link => sourceDestination(link.href)).filter((link): link is { href: string; domain: string } => !!link);
		const rect = trigger.getBoundingClientRect();
		citationTrigger = trigger;
		citation = { id: target.id, text: copy.textContent?.replace(/\s+/g, ' ').trim() ?? '', links,
			left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)),
			top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 320)) };
		tick().then(() => { if (citation) citationEl?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); });
	}

	$effect(() => {
		const html = articleHtml;
		const title = current;
		contents = [];
		contentsOpen = false;
		citation = null;
		if (!html || !title) return;
		let disposed = false;
		let saveTimer: ReturnType<typeof setTimeout> | undefined;
		let restoreTimer: ReturnType<typeof setTimeout> | undefined;
		let restoreLimit: ReturnType<typeof setTimeout> | undefined;
		let widthObserver: ResizeObserver | null = null;
		let stopRestore: (() => void) | null = null;
		let scrollBody: HTMLElement | null = null;
		let articleContent: HTMLElement | null = null;
		let readerPane: HTMLElement | null = null;
		let ready = false;
		let latest: ReadingPosition | null = null;
		const disclosures = (): [string, HTMLDetailsElement][] => {
			if (!articleContent) return [];
			const counts = new Map<string, number>();
			return [...articleContent.querySelectorAll<HTMLDetailsElement>('details.wh-sources, details.wh-bibliography, details.quick-facts')].map(node => {
				const kind = ['wh-sources', 'wh-bibliography', 'quick-facts'].find(name => node.classList.contains(name))!;
				const index = counts.get(kind) ?? 0;
				counts.set(kind, index + 1);
				return [`${kind}:${index}`, node];
			});
		};
		const capture = () => {
			// Replacing HTML can clamp the shared scroll body before effect cleanup.
			// Only measure the currently attached article; cleanup writes the last snapshot.
			if (!ready || !scrollBody || !articleContent?.isConnected || articleContent !== contentEl || current !== title) return;
			const top = scrollBody.getBoundingClientRect().top;
			const anchor = nearestReadingAnchor([...articleContent.querySelectorAll<HTMLElement>(
				'h2[id], h3[id], h4[id], p[id], figure[id], .wh-sources li[id], .wh-bibliography li[id]'
			)].filter(node => node.getClientRects().length > 0)
				.map(node => ({ id: node.id, top: node.getBoundingClientRect().top })), top);
			const maximum = Math.max(0, scrollBody.scrollHeight - scrollBody.clientHeight);
			latest = { anchor: anchor?.anchor ?? null,
				offset: anchor?.offset ?? scrollBody.scrollTop,
				ratio: maximum ? Math.min(1, scrollBody.scrollTop / maximum) : 0,
				disclosures: disclosures().filter(([, node]) => node.open).map(([key]) => key).slice(0, 64), updated: Date.now() };
		};
		const persist = () => { if (latest) saveReadingPosition(readingStorage(), title, latest); };
		const onScroll = () => { capture(); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200); dismissCitation(); };
		const onToggle = () => { capture(); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200); };
		const onPageHide = () => { capture(); persist(); };
		const onIntent = () => stopRestore?.();
		const onKeyIntent = (event: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Enter', 'Tab', 'Escape'].includes(event.key)) onIntent(); };

		tick().then(() => {
			if (disposed || !contentEl || !bodyEl) return;
			scrollBody = bodyEl;
			articleContent = contentEl;
			readerPane = asideEl;
			const used = new Set([...contentEl.querySelectorAll('[id]')].map(node => node.id));
			contents = [...contentEl.querySelectorAll<HTMLElement>('h2, h3, h4')]
				.filter(node => !node.closest('table, figure, .quick-facts'))
				.map(node => {
					const label = node.textContent?.trim() ?? '';
					if (!node.id) node.id = headingAnchor(label, used);
					return { id: node.id, label, level: Number(node.tagName.slice(1)) };
				}).filter(entry => entry.label);
			const saved = loadReadingPosition(readingStorage(), title);
			const openKeys = new Set(saved?.disclosures ?? []);
			for (const [key, node] of disclosures()) if (openKeys.has(key)) node.open = true;
			const restore = () => {
				if (disposed || !scrollBody || !articleContent) return;
				const heading = saved?.anchor ? [...articleContent.querySelectorAll<HTMLElement>('[id]')].find(node => node.id === saved.anchor) : null;
				if (saved && heading) {
					for (let parent = heading.parentElement; parent && parent !== articleContent; parent = parent.parentElement) {
						if (parent instanceof HTMLDetailsElement) parent.open = true;
					}
					scrollBody.scrollTop += heading.getBoundingClientRect().top - scrollBody.getBoundingClientRect().top + saved.offset;
				} else scrollBody.scrollTop = saved ? saved.ratio * (scrollBody.scrollHeight - scrollBody.clientHeight) : 0;
			};
			const complete = (apply: boolean) => {
				clearTimeout(restoreTimer);
				clearTimeout(restoreLimit);
				widthObserver?.disconnect();
				widthObserver = null;
				stopRestore = null;
				if (apply) restore();
				ready = true;
				capture();
			};
			// Opening the desktop pane animates its width. Restoring mid-animation
			// accumulates reflow above the anchor; wait for a quiet width instead.
			// User intent cancels pending restoration so it cannot interrupt reading.
			if (saved && typeof ResizeObserver !== 'undefined') {
				stopRestore = () => complete(false);
				let lastWidth = -1;
				widthObserver = new ResizeObserver(entries => {
					const width = entries[0]?.contentRect.width ?? 0;
					if (Math.abs(width - lastWidth) < .5) return;
					lastWidth = width;
					clearTimeout(restoreTimer);
					restoreTimer = setTimeout(() => complete(true), 100);
				});
				widthObserver.observe(scrollBody);
				restoreLimit = setTimeout(() => complete(true), 1200);
			} else complete(true);

			scrollBody.addEventListener('scroll', onScroll, { passive: true });
			articleContent.addEventListener('toggle', onToggle, true);
			scrollBody.addEventListener('wheel', onIntent, { passive: true });
			readerPane?.addEventListener('pointerdown', onIntent);
			readerPane?.addEventListener('keydown', onKeyIntent);
			window.addEventListener('pagehide', onPageHide);
		});
		return () => {
			disposed = true;
			clearTimeout(saveTimer);
			clearTimeout(restoreTimer);
			clearTimeout(restoreLimit);
			widthObserver?.disconnect();
			persist();
			scrollBody?.removeEventListener('scroll', onScroll);
			articleContent?.removeEventListener('toggle', onToggle, true);
			scrollBody?.removeEventListener('wheel', onIntent);
			readerPane?.removeEventListener('pointerdown', onIntent);
			readerPane?.removeEventListener('keydown', onKeyIntent);
			window.removeEventListener('pagehide', onPageHide);
		};
	});

	function scrollReaderTo(target: Element): void {
		if (!bodyEl) return;
		bodyEl.scrollTo({ top: bodyEl.scrollTop + target.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top, behavior: 'instant' });
	}

	function openSources(): void {
		const sources = contentEl?.querySelectorAll<HTMLElement>('.wh-sources, .wh-bibliography');
		if (!sources?.length) return;
		for (const source of sources) if (source instanceof HTMLDetailsElement) source.open = true;
		const destination = [...sources].find((source) => source.querySelector('.wh-source-visit')) ?? sources[0];
		scrollReaderTo(destination);
		destination.querySelector<HTMLElement>('summary, .wh-source-visit')?.focus({ preventScroll: true });
	}
	let articleHtml = $state<string | null>(null);
	const hasSources = $derived(/class="[^"]*\bwh-(?:sources|bibliography)\b/.test(articleHtml ?? ''));
	let htmlLoading = $state(false);
	let htmlError = $state(false);
	// Full-screen image view. Tapping a content image (figure/thumbnail/infobox) opens
	// this; null when closed.
	let lightbox = $state<{ src: string; caption: string; alt: string } | null>(null);
	let closeImageEl = $state<HTMLElement | null>(null);

	const current = $derived(reader.current);
	const wikiUrl = $derived(
		current ? `https://en.wikipedia.org/wiki/${encodeURIComponent(current.replace(/ /g, '_'))}` : ''
	);

	// Fetch the shown article's HTML whenever the title changes (open, or a dive replacing
	// it). The reader holds one article at a time, so there's no per-level cache to
	// consult — a fresh open always loads fresh.
	$effect(() => {
		const title = reader.current;
		if (!title) return;

		const controller = new AbortController();
		articleHtml = null;
		htmlLoading = true;
		htmlError = false;
		fetch(`/api/article?title=${encodeURIComponent(title)}&v=${ARTICLE_RENDER_VERSION}`, { signal: controller.signal })
			.then((res) => res.json())
			.then((data: { html: string | null }) => {
				if (data.html) articleHtml = data.html;
				else htmlError = true;
				htmlLoading = false;
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				htmlError = true;
				htmlLoading = false;
			});
		return () => controller.abort();
	});

	// Real content imagery — figures, thumbnails, the infobox lead — opens the lightbox;
	// inline icons, flags, and math glyphs (small, unframed) do not.
	function isLightboxable(img: HTMLImageElement): boolean {
		if (img.hasAttribute('usemap') || img.closest('.mwe-math-element')) return false;
		if (img.closest('figure, .thumb, .thumbinner, .quick-facts')) return true;
		return img.clientWidth >= 100 && img.clientHeight >= 100;
	}

	// Prefer the largest srcset candidate (typically 2x) over the original — Commons
	// originals can be tens of MB, and the 2x thumb is plenty for a full-screen view.
	function bestImageSrc(img: HTMLImageElement): string {
		const srcset = img.getAttribute('srcset');
		if (srcset) {
			let bestUrl = '';
			let bestScale = 0;
			for (const part of srcset.split(',')) {
				const [url, descriptor] = part.trim().split(/\s+/);
				const scale = descriptor ? parseFloat(descriptor) : 1;
				if (url && scale >= bestScale) {
					bestScale = scale;
					bestUrl = url;
				}
			}
			if (bestUrl) return bestUrl;
		}
		return img.currentSrc || img.src;
	}

	function openLightbox(img: HTMLImageElement): void {
		const figure = img.closest('figure, .thumb');
		const caption = figure?.querySelector('figcaption, .thumbcaption')?.textContent?.trim() ?? '';
		lightbox = { src: bestImageSrc(img), caption, alt: img.getAttribute('alt') || caption || 'Article image' };
	}

	// Click handling lives on the (stable) content container and classifies each target
	// on click — so it keeps working across content swaps and cached renders, independent
	// of the cosmetic rewrite below (which can lag a render).
	//   - Content image → open full-screen (not its Commons file page).
	//   - Wikipedia article link → dive in-app (left-click) or new-tab tangent (cmd/ctrl).
	//   - In-page/current-article anchor → reveal disclosures and scroll locally.
	//   - Anything else (citations, File:/Category:, off-wiki) → open in a new tab.
	$effect(() => {
		const el = contentEl;
		if (!el) return;

		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;

			const img = (event.target as HTMLElement | null)?.closest?.('img');
			if (img instanceof HTMLImageElement && isLightboxable(img)) {
				event.preventDefault();
				openLightbox(img);
				return;
			}

			const anchor = (event.target as HTMLElement | null)?.closest?.('a, area');
			if (!anchor) return;
			const href = anchor.getAttribute('href') ?? '';
			const fragment = localArticleAnchor(href, current ?? '');
			if (fragment) {
				let id: string;
				try {
					id = decodeURIComponent(fragment.slice(1));
				} catch {
					return;
				}
				const target = [...el.querySelectorAll('[id]')].find((node) => node.id === id);
				if (!target) return;
				event.preventDefault();
				if (citationNoteId(fragment) && anchor instanceof HTMLElement && !anchor.closest('.wh-sources, .wh-bibliography')) {
					showCitation(target, anchor);
					return;
				}
				for (let parent = target.parentElement; parent && parent !== el; parent = parent.parentElement) {
					if (parent instanceof HTMLDetailsElement) parent.open = true;
				}
				scrollReaderTo(target);
				return;
			}

			const title = anchor.getAttribute('data-seed') ?? articleTitleFromHref(href);
			event.preventDefault();
			if (title) {
				if (event.metaKey || event.ctrlKey) {
					window.open(`/?seed=${encodeURIComponent(title)}`, '_blank', 'noopener');
				} else {
					onDive(title);
				}
			} else {
				window.open(href, '_blank', 'noopener,noreferrer');
			}
		};
		el.addEventListener('click', onClick);
		return () => el.removeEventListener('click', onClick);
	});

	// Cosmetic only: tag links so article links get the ember underline (.wh-dive) and
	// externals the ↗ marker (.wh-external). Runs after the DOM reflects the current
	// html (tick) so cached Back renders get re-tagged; follow behavior never depends on it.
	$effect(() => {
		articleHtml;
		if (!contentEl) return;
		tick().then(() => {
			if (!contentEl) return;
			for (const a of contentEl.querySelectorAll('a')) {
				const href = a.getAttribute('href') ?? '';
				if (localArticleAnchor(href, current ?? '')) continue;
				const title = articleTitleFromHref(href);
				if (title) {
					a.dataset.seed = title;
					a.classList.add('wh-dive');
				} else {
					a.classList.add('wh-external');
				}
			}

			// Give the lead a standfirst lift. The real lead is the first substantial
			// paragraph (Parsoid buries it after shortdescription + hatnotes), so pick by
			// text length rather than position; skip infobox/hatnote/figure paragraphs.
			const lead = [...contentEl.querySelectorAll('p')].find(
				(p) =>
					!p.closest('.quick-facts, .hatnote, table, figure') &&
					(p.textContent?.trim().length ?? 0) > 140
			);
			lead?.classList.add('wh-lead');
		});
	});

	// On mobile the reader is a full-screen takeover, so move focus into it on open and
	// restore it to the trigger on close — otherwise keyboard/SR users are left behind
	// it. preventScroll on the restore: diving closes the reader and scrolls the feed to
	// the new card (goToCard), and a plain focus() would yank the viewport back to the
	// trigger near the top, fighting that scroll. On desktop (lg+) it's a non-modal
	// in-flow pane beside the feed, so focus stays.
	$effect(() => {
		if (!asideEl) return;
		if (window.matchMedia('(min-width: 1024px)').matches) return;
		const trigger = document.activeElement as HTMLElement | null;
		asideEl.focus({ preventScroll: true });
		return () => trigger?.focus?.({ preventScroll: true });
	});

	// The lightbox is a real modal (aria-modal): move focus to its close control on open
	// so Escape/Enter and screen readers land inside it, and restore focus to whatever the
	// reader had on close. preventScroll keeps the restore from jumping the article.
	$effect(() => {
		if (!lightbox) return;
		const trigger = document.activeElement as HTMLElement | null;
		closeImageEl?.focus({ preventScroll: true });
		return () => trigger?.focus?.({ preventScroll: true });
	});
</script>

<svelte:window
	onpointerdown={(event) => {
		const target = event.target as Node | null;
		if (citation && !citationEl?.contains(target) && !citationTrigger?.contains(target)) dismissCitation();
		if (contentsOpen && !contentsEl?.contains(target) && !contentsButton?.contains(target)) contentsOpen = false;
	}}
	onresize={() => dismissCitation()}
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		// A native drawer or card menu owns Escape while it is above the reader.
		if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('dialog[open], [popover]:popover-open'))) return;
		// Escape closes the image view first (if open), then the reader itself.
		if (citation) dismissCitation(true);
		else if (contentsOpen) { contentsOpen = false; contentsButton?.focus({ preventScroll: true }); }
		else if (lightbox) lightbox = null;
		else reader.close();
	}}
/>

<!--
	Mobile (base): a full-screen takeover — there's no room beside the feed.
	Desktop (lg+): an in-flow, sticky right-hand pane that sits next to the feed as a
	real part of the page (no backdrop, no modal); the feed stays scrollable alongside.
-->
<aside
	bind:this={asideEl}
	tabindex="-1"
	aria-label="Article reader"
	class="article-reader animate-rise fixed inset-0 z-40 flex flex-col bg-void text-ink focus:outline-none
		lg:sticky lg:inset-auto lg:z-auto lg:flex-1
		lg:min-w-0 lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:border lg:border-hair
		lg:shadow-card"
>
	<!-- Sticky header. Extra top padding clears the notch when the reader is a
	     full-screen takeover on mobile (reset on desktop, where it sits below the app bar). -->
	<div
		class="z-10 flex items-center gap-2 border-b border-hair bg-surface px-4 sm:px-6
			pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 lg:pt-3"
	>
		<h2 class="font-display flex-1 text-xl leading-snug font-semibold tracking-tight text-ink">
			{current}
		</h2>
		{#if contents.length}
			<button bind:this={contentsButton} type="button" aria-expanded={contentsOpen} aria-controls="reader-contents"
				onclick={() => { contentsOpen = !contentsOpen; if (contentsOpen) tick().then(() => contentsEl?.querySelector<HTMLButtonElement>('button')?.focus()); }}
				class="min-h-11 shrink-0 rounded-full px-2 text-xs font-medium text-muted hover:bg-surface-2">Contents</button>
		{/if}
		{#if hasSources}
			<button type="button" onclick={openSources} class="min-h-11 shrink-0 rounded-full px-3 text-xs font-medium text-accent hover:bg-surface-2">Sources</button>
		{/if}
		<button
			type="button"
			onclick={() => reader.close()}
			aria-label="Close article"
			class="icon-btn inline-flex shrink-0 items-center justify-center rounded-full p-1.5
				text-muted transition-colors hover:bg-surface-2 hover:text-ink"
		>
			<X class="size-5" aria-hidden="true" />
		</button>
	</div>

	{#if contentsOpen}
		<nav id="reader-contents" bind:this={contentsEl} aria-label="Article contents" class="max-h-[45dvh] shrink-0 overflow-y-auto border-b border-hair bg-surface px-4 py-2 sm:px-6">
			{#each contents as entry}
				<button type="button" onclick={() => visitSection(entry.id)} class="block min-h-11 w-full rounded-lg py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink" style:padding-left={`${(entry.level - 2) * .75 + .5}rem`}>{entry.label}</button>
			{/each}
		</nav>
	{/if}

	<!-- Scrollable body. Bottom padding clears the home indicator on mobile. -->
	<div
		bind:this={bodyEl}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
	>
		{#if htmlLoading}
			<div class="space-y-2.5" aria-hidden="true">
				{#each { length: 8 } as _}
					<div class="h-3 w-full animate-pulse rounded-full bg-surface-2"></div>
				{/each}
				<div class="h-3 w-4/5 animate-pulse rounded-full bg-surface-2"></div>
			</div>
		{:else if htmlError}
			<p class="text-sm text-faint">
				Couldn't load the article inline.
				<a href={wikiUrl} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline"
					>Open on Wikipedia instead ↗</a
				>
			</p>
		{:else if articleHtml}
			<!-- Sanitized server-side (scripts/handlers stripped); see wikipedia/article.ts -->
			<div bind:this={contentEl} class="wiki-content">{@html articleHtml}</div>
			<div class="mt-6 border-t border-hair pt-4">
				<a
					href={wikiUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center py-1 text-xs font-medium text-faint transition-colors hover:text-ink"
					>Open on Wikipedia ↗</a
				>
			</div>
		{/if}
	</div>
</aside>

<!-- Desktop-only hover/focus peek for in-article links. Reads contentEl directly and
     is inert on touch; renders its own position:fixed card, so it lives outside the aside. -->
<LinkPreview container={contentEl} />

{#if citation}
	<div bind:this={citationEl} role="dialog" aria-label="Citation preview" tabindex="-1"
		onfocusout={(event) => { if (event.relatedTarget instanceof Node && !citationEl?.contains(event.relatedTarget)) dismissCitation(); }}
		class="fixed z-50 max-h-[min(28rem,calc(100dvh-2rem))] w-[min(22.5rem,calc(100vw-1.5rem))] overflow-y-auto rounded-card border border-hair-strong bg-surface p-4 text-ink shadow-card"
		style:top={`${citation.top}px`} style:left={`${citation.left}px`} style:max-height={`calc(100dvh - ${citation.top + 12}px)`}>
		<div class="mb-2 flex items-center justify-between gap-2">
			<span class="text-sm font-medium">Source</span>
			<button type="button" aria-label="Close citation preview" onclick={() => dismissCitation(true)} class="icon-btn flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2"><X class="size-4" /></button>
		</div>
		<p class="text-sm leading-relaxed text-read">{citation.text}</p>
		{#each citation.links as link}
			<a href={link.href} target="_blank" rel="noopener noreferrer" class="mt-3 flex min-h-11 items-center rounded-lg bg-surface-2 px-3 text-sm text-accent hover:underline">Visit {link.domain}</a>
		{/each}
		<button type="button" onclick={() => { const id = citation?.id; dismissCitation(); if (id) visitSection(id); }} class="mt-2 min-h-11 text-xs text-muted hover:text-ink">View in Sources</button>
	</div>
{/if}

{#if lightbox}
	<!-- Full-screen image view above the reader. The backdrop and image are tap-to-dismiss
	     (the image is pointer-transparent so a tap "through" it still hits the backdrop);
	     Escape and the close control also dismiss. -->
	<div
		class="animate-fade fixed inset-0 z-50 flex flex-col items-center justify-center bg-void/85
			backdrop-blur-md px-4 pt-[calc(1rem+env(safe-area-inset-top))]
			pb-[calc(1rem+env(safe-area-inset-bottom))]"
		role="dialog"
		aria-modal="true"
		aria-label="Image viewer"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-zoom-out"
			aria-label="Close image"
			onclick={() => (lightbox = null)}
		></button>
		<button
			bind:this={closeImageEl}
			type="button"
			onclick={() => (lightbox = null)}
			aria-label="Close image"
			class="icon-btn absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 inline-flex
				items-center justify-center rounded-full bg-surface/80 p-2 text-ink backdrop-blur
				transition-colors hover:bg-surface-2"
		>
			<X class="size-5" aria-hidden="true" />
		</button>
		<img
			src={lightbox.src}
			alt={lightbox.alt}
			class="pointer-events-none relative max-h-full max-w-full rounded-lg object-contain shadow-card"
		/>
		{#if lightbox.caption}
			<p class="pointer-events-none relative mt-3 max-w-prose text-center text-sm text-faint">
				{lightbox.caption}
			</p>
		{/if}
	</div>
{/if}

<style>
	@media (min-width: 1024px) {
		.article-reader {
			top: var(--reader-top, calc(var(--app-header-height, 4.3125rem) + 0.75rem));
			height: var(--reader-height, calc(100dvh - var(--app-header-height, 4.3125rem) - 1.5rem));
			animation: none;
			align-self: flex-start;
		}
	}
</style>
