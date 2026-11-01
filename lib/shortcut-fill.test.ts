import { describe, it, expect, vi } from 'vitest';
import { routeShortcutFill, type ShortcutFillDeps } from './shortcut-fill';
import type { NmhResponse } from './nmh-client';

function ok(payload: unknown): NmhResponse { return { id: 'r', ok: true, payload }; }
function fail(code: string): NmhResponse { return { id: 'r', ok: false, error: { code, message: code } }; }

function makeDeps(over: Partial<ShortcutFillDeps> = {}): ShortcutFillDeps {
  return {
    getTabUrl: vi.fn(async () => 'https://a.com/login?x=1'),
    request: vi.fn(async () => ok({ items: [{ id: '1', title: 'A', username: 'alice', hasTotp: false }] })),
    dispatchFill: vi.fn(async () => ({ ok: true } as const)),
    ...over,
  };
}

describe('routeShortcutFill', () => {
  it('fills the best match (items[0]) via the browser-derived url', async () => {
    const request = vi.fn(async () => ok({ items: [
      { id: '1', title: 'A', username: 'alice' },
      { id: '2', title: 'B', username: 'bob' },
    ] }));
    const dispatchFill = vi.fn(async () => ({ ok: true } as const));
    const out = await routeShortcutFill(7, makeDeps({ request, dispatchFill }));
    expect(request).toHaveBeenCalledWith('https://a.com', 'get_logins', { url: 'https://a.com/login?x=1' });
    expect(dispatchFill).toHaveBeenCalledWith(7, '1', 'alice');
    expect(out).toBe('filled-dispatch');
  });

  it('converts a null username to undefined for the fill message', async () => {
    const dispatchFill = vi.fn(async () => ({ ok: true } as const));
    const request = vi.fn(async () => ok({ items: [{ id: '9', title: 'X', username: null }] }));
    await routeShortcutFill(7, makeDeps({ request, dispatchFill }));
    expect(dispatchFill).toHaveBeenCalledWith(7, '9', undefined);
  });

  it('returns no-login and dispatches nothing when the site has no logins', async () => {
    const dispatchFill = vi.fn(async () => undefined);
    const out = await routeShortcutFill(7, makeDeps({ request: vi.fn(async () => ok({ items: [] })), dispatchFill }));
    expect(out).toBe('no-login');
    expect(dispatchFill).not.toHaveBeenCalled();
  });

  it('returns error and dispatches nothing when get_logins fails', async () => {
    const dispatchFill = vi.fn(async () => undefined);
    const out = await routeShortcutFill(7, makeDeps({ request: vi.fn(async () => fail('locked')), dispatchFill }));
    expect(out).toBe('error');
    expect(dispatchFill).not.toHaveBeenCalled();
  });

  it('returns no-url and never calls get_logins for a non-http tab url', async () => {
    const request = vi.fn(async () => ok({ items: [] }));
    const out = await routeShortcutFill(7, makeDeps({ getTabUrl: vi.fn(async () => 'chrome://newtab'), request }));
    expect(out).toBe('no-url');
    expect(request).not.toHaveBeenCalled();
  });

  it('returns no-url for an absent tab url', async () => {
    const out = await routeShortcutFill(7, makeDeps({ getTabUrl: vi.fn(async () => undefined) }));
    expect(out).toBe('no-url');
  });
});
