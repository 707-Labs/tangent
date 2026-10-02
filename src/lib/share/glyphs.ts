/**
 * Whether the share card's fonts can draw a piece of text. The card registers Newsreader's
 * Latin, Latin Extended and Vietnamese subsets (render.server.ts); text in any other script
 * would render as missing-glyph boxes, so callers leave it off the card instead.
 */

// The union of Fontsource's `unicode-range` for those three Newsreader subsets.
const UNDRAWABLE =
	/[^\u0000-\u02CC\u02CE-\u02D7\u02DA\u02DC-\u0301\u0303\u0304\u0308\u0309\u0323\u0329\u1D00-\u1DBF\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20C0\u2113\u2122\u2191\u2193\u2212\u2215\u2C60-\u2C7F\uA720-\uA7FF\uFEFF\uFFFD]/u;

export function drawable(text: string): boolean {
	return !UNDRAWABLE.test(text);
}
