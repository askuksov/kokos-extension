import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSaveIgnored, addSaveIgnore, removeSaveIgnore, listIgnoredSaveSites } from './save-ignore';

function installFakeChrome() {
  const store: Record<string, any> = {};
  (globalThis as any).chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: any) => { Object.assign(store, obj); }),
    } },
  };
}
beforeEach(() => { delete (globalThis as any).chrome; installFakeChrome(); });

describe('save-ignore', () => {
  it('records and reports an ignored origin (by origin, ignoring path)', async () => {
    expect(await isSaveIgnored('https://a.com/login')).toBe(false);
    await addSaveIgnore('https://a.com/login');
    expect(await isSaveIgnored('https://a.com/anything')).toBe(true);
  });
  it('does not leak across origins', async () => {
    await addSaveIgnore('https://a.com/x');
    expect(await isSaveIgnored('https://b.com/x')).toBe(false);
  });
  it('removeSaveIgnore prunes the origin', async () => {
    await addSaveIgnore('https://a.com/x');
    await removeSaveIgnore('https://a.com/y');
    expect(await isSaveIgnored('https://a.com/z')).toBe(false);
  });
  it('does not duplicate an already-ignored origin', async () => {
    await addSaveIgnore('https://a.com/x');
    await addSaveIgnore('https://a.com/y');
    const got = await chrome.storage.local.get('ignoredSaveSites');
    expect(got.ignoredSaveSites).toEqual(['https://a.com']);
  });
});

describe('listIgnoredSaveSites', () => {
  it('returns the stored save-off origins', async () => {
    await addSaveIgnore('https://a.com/login');
    await addSaveIgnore('https://b.com/x');
    expect(await listIgnoredSaveSites()).toEqual(['https://a.com', 'https://b.com']);
  });
  it('reflects a removal', async () => {
    await addSaveIgnore('https://a.com/login');
    await removeSaveIgnore('https://a.com/login');
    expect(await listIgnoredSaveSites()).toEqual([]);
  });
});
