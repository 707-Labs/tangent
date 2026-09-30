import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { THEMES, THEME_BY_ID, normalizeThemePreference } from '../src/lib/theme/themes';

const savedPreferences = ['system', 'nightstand', 'daylight', 'high-contrast', 'sepia', 'newsprint', 'slate', 'forest', 'wine', 'invalid', 'toString', null];

describe('appearance preference migration', () => {
	it('keeps only the light, dark and accessibility palettes', () => {
		expect(THEMES.map((theme) => theme.label)).toEqual(['Dark', 'Light', 'High contrast']);
	});

	it('preserves the light/dark intent of retired themes', () => {
		for (const id of ['sepia', 'newsprint']) expect(normalizeThemePreference(id)).toBe('daylight');
		for (const id of ['slate', 'forest', 'wine']) expect(normalizeThemePreference(id)).toBe('nightstand');
		expect(normalizeThemePreference('high-contrast')).toBe('high-contrast');
		expect(normalizeThemePreference('invalid')).toBe('system');
	});

	it('uses the same migrated palette and chrome tint before paint and after hydration', () => {
		const source = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
		const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		expect(script).toBeDefined();
		for (const saved of savedPreferences) {
			for (const dark of [true, false]) {
				const preference = normalizeThemePreference(saved);
				const resolved = preference === 'system' ? (dark ? 'nightstand' : 'daylight') : preference;
				const dataset: { theme?: string } = {};
				let tint = '';
				runInNewContext(script!, {
					localStorage: { getItem: () => saved },
					matchMedia: () => ({ matches: dark }),
					document: { documentElement: { dataset }, querySelector: () => ({ setAttribute: (_name: string, value: string) => { tint = value; } }) }
				});
				expect(dataset.theme).toBe(resolved);
				expect(tint).toBe(THEME_BY_ID[resolved].bg);
			}
		}
	});
});
