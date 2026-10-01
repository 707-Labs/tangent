import { browser } from '$app/environment';
import type { Article } from '$lib/wikipedia/types';
import { loadSaved, saveArticles, savedEntry, SAVED_LIMIT, type SavedArticle } from './storage';

class SavedArticles {
	items = $state<SavedArticle[]>([]);
	isOpen = $state(false);
	#loaded = false;

	load(): void {
		if (!browser || this.#loaded) return;
		this.#loaded = true;
		try { this.items = loadSaved(localStorage); } catch { this.items = []; }
	}

	isSaved(title: string): boolean { return this.items.some((item) => item.title === title); }
	open(): void { this.load(); this.isOpen = true; }
	close(): void { this.isOpen = false; }
	toggle(article: Article): void {
		this.load();
		if (this.isSaved(article.title)) this.remove(article.title);
		else { this.items = [savedEntry(article), ...this.items].slice(0, SAVED_LIMIT); this.#save(); }
	}
	remove(title: string): void {
		this.items = this.items.filter((item) => item.title !== title);
		this.#save();
	}
	#save(): void {
		if (!browser) return;
		try { saveArticles(this.items, localStorage); } catch { /* Keep this session usable when storage is blocked. */ }
	}
}

export const savedArticles = new SavedArticles();
