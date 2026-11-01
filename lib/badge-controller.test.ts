import { describe, it, expect, vi } from 'vitest';
import { computeProbe, isSettleUpdate, type BadgeDeps } from './badge-controller';
import type { NmhResponse } from './nmh-client';

function ok(payload: unknown): NmhResponse { return { id: 'r', ok: true, payload }; }
function fail(code: string): NmhResponse { return { id: 'r', ok: false, error: { code, message: code } }; }

function makeDeps(over: Partial<BadgeDeps> = {}): BadgeDeps {
  return {
    request: vi.fn(async () => ok({ running: true, locked: false })),
    isEnabled: vi.fn(async () => false),
    ...over,
  };
}

describe('computeProbe — non-http', () => {
  it('returns null for undefined url', async () => {
    expect(await computeProbe(makeDeps(), undefined)).toBeNull();
  });
  it('returns null for a chrome:// url', async () => {
    expect(await computeProbe(makeDeps(), 'chrome://newtab')).toBeNull();
  });
  it('returns null for a malformed url', async () => {
    expect(await computeProbe(makeDeps(), 'not-a-url')).toBeNull();
  });
});

describe('computeProbe — enabled site → get_logins', () => {
  it('permitted with the item count, using the browser-derived origin + url', async () => {
    const request = vi.fn(async () => ok({ items: [{ id: '1' }, { id: '2' }, { id: '3' }] }));
    const deps = makeDeps({ isEnabled: vi.fn(async () => true), request });
    const probe = await computeProbe(deps, 'https://a.com/login?x=1');
    expect(request).toHaveBeenCalledWith('https://a.com', 'get_logins', { url: 'https://a.com/login?x=1' });
    expect(probe).toEqual({ kind: 'permitted', count: 3 });
  });
  it('permitted count 0 when items empty', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => true), request: vi.fn(async () => ok({ items: [] })) });
    expect(await computeProbe(deps, 'https://a.com/')).toEqual({ kind: 'permitted', count: 0 });
  });
  it('maps a locked error to locked', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => true), request: vi.fn(async () => fail('locked')) });
    expect(await computeProbe(deps, 'https://a.com/')).toEqual({ kind: 'locked' });
  });
  it('maps app_not_running error to not-running', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => true), request: vi.fn(async () => fail('app_not_running')) });
    expect(await computeProbe(deps, 'https://a.com/')).toEqual({ kind: 'not-running' });
  });
});

describe('computeProbe — non-enabled site → get_status', () => {
  it('not-running when get_status fails', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false), request: vi.fn(async () => fail('app_not_running')) });
    expect(await computeProbe(deps, 'https://b.com/')).toEqual({ kind: 'not-running' });
  });
  it('locked when running & locked', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false), request: vi.fn(async () => ok({ running: true, locked: true })) });
    expect(await computeProbe(deps, 'https://b.com/')).toEqual({ kind: 'locked' });
  });
  it('no-permission when running & unlocked but site not enabled', async () => {
    const request = vi.fn(async () => ok({ running: true, locked: false }));
    const deps = makeDeps({ isEnabled: vi.fn(async () => false), request });
    const probe = await computeProbe(deps, 'https://b.com/page');
    expect(request).toHaveBeenCalledWith('https://b.com', 'get_status', {});
    expect(probe).toEqual({ kind: 'no-permission' });
  });
});

describe('isSettleUpdate', () => {
  it('true on load complete', () => { expect(isSettleUpdate({ status: 'complete' })).toBe(true); });
  it('true on a url change', () => { expect(isSettleUpdate({ url: 'https://x.com' })).toBe(true); });
  it('false on other partial updates', () => { expect(isSettleUpdate({ status: 'loading' })).toBe(false); expect(isSettleUpdate({})).toBe(false); });
});
