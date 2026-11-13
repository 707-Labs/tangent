import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineContext, NextRequest } from '../src/lib/feed/types';

const { fetchRelated, fetchExploreCandidates, selectNext } = vi.hoisted(() => ({
	fetchRelated: vi.fn(), fetchExploreCandidates: vi.fn(), selectNext: vi.fn()
}));
vi.mock('../src/lib/wikipedia/action', () => ({ fetchRelated, fetchExploreCandidates }));
vi.mock('../src/lib/feed/select', () => ({ selectNext }));
vi.mock('../src/lib/server/resolveCard', () => ({ resolveCard: vi.fn() }));
vi.mock('../src/lib/server/cache', () => ({
	TTL: { long: 1000 }, cached: (_key: string, _ttl: number, acquire: () => Promise<unknown>) => acquire()
}));
import { POST } from '../src/routes/api/next/+server';

async function scoreRequest(mode?: 'related', noSurprise?: boolean): Promise<EngineContext> {
	const body: NextRequest = { fromTitle: 'Coffee', mode,
		interest: { tokenWeights: {}, tokenDocFreq: {} },
		session: { seenTitles: ['Coffee'], stepIndex: 1, runDepth: 1, noSurprise } };
	// The handler reads only request and setHeaders from SvelteKit's event.
	await POST({ request: new Request('http://localhost/api/next', {
		method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }
	}), setHeaders: vi.fn() } as unknown as Parameters<typeof POST>[0]);
	return selectNext.mock.calls[0][1] as EngineContext;
}

describe('explicit related API steering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchRelated.mockResolvedValue([]);
		fetchExploreCandidates.mockResolvedValue([]);
		selectNext.mockReturnValue(null);
	});

	it('normalizes related mode when older clients omit the optional session flag', async () => {
		expect((await scoreRequest('related')).noSurprise).toBe(true);
		expect(fetchRelated).toHaveBeenCalledWith('Coffee');
		expect(fetchExploreCandidates).not.toHaveBeenCalled();
	});

	it('keeps explicit related steering even when the supplied flag is false', async () => {
		expect((await scoreRequest('related', false)).noSurprise).toBe(true);
	});

	it('preserves automatic explore mode without the flag', async () => {
		expect((await scoreRequest()).noSurprise).toBe(false);
		expect(fetchExploreCandidates).toHaveBeenCalledWith('Coffee');
		expect(fetchRelated).not.toHaveBeenCalled();
	});

	it('preserves explicitly disabled surprises in explore mode', async () => {
		expect((await scoreRequest(undefined, true)).noSurprise).toBe(true);
	});
});

describe('politics flags on the server-picked pool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectNext.mockReturnValue(null);
	});

	it('hands selectNext candidates flagged by one Workers AI call', async () => {
		fetchExploreCandidates.mockResolvedValue([
			{ title: 'Belovezha Accords', description: null, thumbnail: null, isDisambiguation: false,
				relation: 'link', categories: [], position: 0 }
		]);
		const run = vi.fn(async () => ({ answers: { c0: { type: 'noul', noul: 0.9 } } }));
		const body: NextRequest = { fromTitle: 'Coffee', session: { seenTitles: [] },
			interest: { tokenWeights: {}, tokenDocFreq: {} } };
		await POST({ request: new Request('http://localhost/api/next', { method: 'POST', body: JSON.stringify(body) }),
			setHeaders: vi.fn(), platform: { env: { AI: { run } } } } as unknown as Parameters<typeof POST>[0]);
		expect(run).toHaveBeenCalledTimes(1);
		expect(selectNext.mock.calls[0][0][0].political).toBe(true);
	});
});
