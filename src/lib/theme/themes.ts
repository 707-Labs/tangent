/** The three palettes used by the compact appearance picker and browser chrome. */
export type ThemeMode = 'dark' | 'light';

export interface Theme {
	id: string;
	label: string;
	mode: ThemeMode;
	/** Page background for the browser chrome tint. Mirrors --color-void. */
	bg: string;
	/** Primary text. Mirrors --color-ink. */
	ink: string;
	/** Accent. Mirrors --color-accent. */
	accent: string;
}

export const THEMES = [
	{ id: 'nightstand', label: 'Dark', mode: 'dark', bg: '#15110c', ink: '#ece4d6', accent: '#e0a14e' },
	{ id: 'daylight', label: 'Light', mode: 'light', bg: '#f5efe3', ink: '#2a2218', accent: '#9a5410' },
	{ id: 'high-contrast', label: 'High contrast', mode: 'dark', bg: '#000000', ink: '#ffffff', accent: '#ffb000' }
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]['id'];

/** Used by 'system' to pick a concrete theme from the OS color-scheme. */
export const DEFAULT_DARK_ID: ThemeId = 'nightstand';
export const DEFAULT_LIGHT_ID: ThemeId = 'daylight';
export const DEFAULT_THEME_ID: ThemeId = DEFAULT_DARK_ID;

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, Theme>;

/** What the user chose: a concrete theme, or 'system' (track the OS). */
export type ThemePreference = 'system' | ThemeId;

export function isThemeId(value: string): value is ThemeId {
	return Object.prototype.hasOwnProperty.call(THEME_BY_ID, value);
}

/** Keep a device's light/dark choice when retiring a decorative palette. */
export function normalizeThemePreference(value: string | null): ThemePreference {
	if (value === 'system' || (value !== null && isThemeId(value))) return value;
	if (value === 'sepia' || value === 'newsprint') return DEFAULT_LIGHT_ID;
	if (value === 'slate' || value === 'forest' || value === 'wine') return DEFAULT_DARK_ID;
	return 'system';
}
