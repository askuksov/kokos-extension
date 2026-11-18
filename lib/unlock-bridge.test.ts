import { describe, it, expect, vi } from 'vitest';
import { requestUnlock, routeUnlockMessage, newUnlockState, DENIED_COOLDOWN_MS, type UnlockDeps } from './unlock-bridge';
import type { NmhResponse } from './nmh-client';

function ok(payload: unknown = { unlocked: true }): NmhResponse { return { id: 'r', ok: true, payload }; }
function fail(code: string): NmhResponse { return { id: 'r', ok: false, error: { code, message: code } }; }

function makeDeps(over: Partial<UnlockDeps> = {}): UnlockDeps {
  return {
    ownId: 'self',
    request: vi.fn(async () => ok()),
    isEnabled: vi.fn(async () => true),
    getTabUrl: vi.fn(async () => 'https://a.com/login'),
    onUnlocked: vi.fn(),
    now: () => 1000,
    state: newUnlockState(),
    ...over,
  };
}

describe('requestUnlock', () => {
  it('sends request_unlock for the site origin with keep_open', async () => {
    const deps = makeDeps();
    const res = await requestUnlock('https://a.com/login?x=1', true, deps);
    expect(res.ok).toBe(true);
    expect(deps.request).toHaveBeenCalledWith('https://a.com', 'request_unlock', { url: 'https://a.com/login?x=1', keep_open: true });
  });

  it('refuses a site Kokos is not enabled on without asking the app', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) });
    const res = await requestUnlock('https://a.com/', false, deps);
    expect(res.error?.code).toBe('denied');
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('refuses a non-http url', async () => {
    const deps = makeDeps();
    expect((await requestUnlock('chrome://settings', false, deps)).error?.code).toBe('bad_request');
    expect((await requestUnlock(undefined, false, deps)).error?.code).toBe('bad_request');
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('joins a request already in flight instead of sending a second one', async () => {
    let release!: (r: NmhResponse) => void;
    const request = vi.fn(() => new Promise<NmhResponse>((r) => { release = r; }));
    const deps = makeDeps({ request });
    const a = requestUnlock('https://a.com/', false, deps);
    const b = requestUnlock('https://b.com/', false, deps);
    await Promise.resolve(); await Promise.resolve();
    release(ok());
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a while after the user cancels', async () => {
    let now = 1000;
    const request = vi.fn(async () => fail('denied'));
    const deps = makeDeps({ request, now: () => now });
    expect((await requestUnlock('https://a.com/', false, deps)).error?.code).toBe('denied');
    now += 1000;
    expect((await requestUnlock('https://a.com/', false, deps)).error?.code).toBe('denied');
    expect(request).toHaveBeenCalledTimes(1);
    now += DENIED_COOLDOWN_MS;
    await requestUnlock('https://a.com/', false, deps);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('a timeout does not start the cooldown', async () => {
    const request = vi.fn(async () => fail('timeout'));
    const deps = makeDeps({ request });
    await requestUnlock('https://a.com/', false, deps);
    await requestUnlock('https://a.com/', false, deps);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('routeUnlockMessage', () => {
  it('ignores other messages', async () => {
    expect(await routeUnlockMessage({ type: 'nmh-request' }, { id: 'self' }, makeDeps())).toBeNull();
  });

  it('rejects a foreign sender', async () => {
    const deps = makeDeps();
    const res = await routeUnlockMessage({ type: 'request-unlock' }, { id: 'evil', url: 'https://a.com/', tab: { id: 1 } }, deps);
    expect(res?.error?.code).toBe('denied');
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('a content script unlocks for its own frame url, not a tab named in the message', async () => {
    const deps = makeDeps();
    await routeUnlockMessage({ type: 'request-unlock', tabId: 99 }, { id: 'self', url: 'https://a.com/login', tab: { id: 7 } }, deps);
    expect(deps.getTabUrl).not.toHaveBeenCalled();
    expect(deps.request).toHaveBeenCalledWith('https://a.com', 'request_unlock', { url: 'https://a.com/login', keep_open: false });
    expect(deps.onUnlocked).toHaveBeenCalledWith(7);
  });

  it('the popup unlocks for the browser-read url of the named tab', async () => {
    const deps = makeDeps({ getTabUrl: vi.fn(async () => 'https://b.com/x') });
    await routeUnlockMessage({ type: 'request-unlock', tabId: 3 }, { id: 'self' }, deps);
    expect(deps.getTabUrl).toHaveBeenCalledWith(3);
    expect(deps.request).toHaveBeenCalledWith('https://b.com', 'request_unlock', { url: 'https://b.com/x', keep_open: false });
  });

  it('a popup message without a tab is a bad request', async () => {
    const res = await routeUnlockMessage({ type: 'request-unlock' }, { id: 'self' }, makeDeps());
    expect(res?.error?.code).toBe('bad_request');
  });

  it('does not report an unlock that failed', async () => {
    const deps = makeDeps({ request: vi.fn(async () => fail('timeout')) });
    await routeUnlockMessage({ type: 'request-unlock' }, { id: 'self', url: 'https://a.com/', tab: { id: 7 } }, deps);
    expect(deps.onUnlocked).not.toHaveBeenCalled();
  });
});
