<script lang="ts">
	let { size = 24 }: { size?: number } = $props();
</script>

<!--
  Ben's mark (Tangent-design Figma: Group 1 / Variant3, matching the TangentLogo
  lockups): a straight line — the path you were on — with the ember dot at the
  tangent point and a ring hanging plumb below it, the moment you left the line.
  Geometry is his export verbatim; colors ride the theme system — structure
  inherits currentColor, the ember dot stays the one branded accent.
-->
<span class="inline-flex items-center gap-2 font-display font-semibold tracking-tight">
	<svg
		width={(size * 24) / 29}
		height={size}
		viewBox="0 0 24 29"
		fill="none"
		aria-hidden="true"
	>
		<line
			x1="1.25"
			y1="1.821"
			x2="22.75"
			y2="1.821"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
		/>
		<path
			d="M13.4214 27.7455C13.4235 28.4354 12.8662 28.9976 12.1763 29.0004C11.4862 29.0027 10.9241 28.4443 10.9214 27.7543L10.9038 22.7426C11.2658 22.7813 11.6339 22.8031 12.0063 22.8031C12.4806 22.8031 12.947 22.7678 13.4038 22.7055L13.4214 27.7455ZM11.2368 3.02771C10.991 3.2568 10.8372 3.58334 10.8384 3.94568L10.8413 5.02771C7.14273 5.5995 4.3083 8.85285 4.30811 12.7797C4.30811 16.7259 7.17074 19.9903 10.896 20.5385L10.9038 22.7426C5.85966 22.2026 1.9333 18.0027 1.93311 12.8998C1.93316 7.685 6.03344 3.41425 11.2368 3.02771ZM12.9546 3.04139C18.0726 3.51146 22.0786 7.74497 22.0786 12.8998C22.0784 17.9026 18.3049 22.0363 13.4038 22.7055L13.396 20.4906C16.9838 19.824 19.7036 16.6265 19.7036 12.7797C19.7034 8.91383 16.9565 5.70336 13.3423 5.05896L13.3384 3.93787C13.3371 3.5857 13.1897 3.26788 12.9546 3.04139ZM12.0845 2.69178C12.4222 2.69085 12.729 2.82412 12.9546 3.04139C12.6425 3.01272 12.3261 2.99648 12.0063 2.99646C11.7476 2.99647 11.4907 3.00886 11.2368 3.02771C11.4591 2.8207 11.7569 2.69299 12.0845 2.69178Z"
			fill="currentColor"
		/>
		<ellipse cx="12.0061" cy="2.1118" rx="2.148" ry="2.1118" fill="var(--color-accent)" />
	</svg>
	<span class="text-ink">tangent</span>
</span>
