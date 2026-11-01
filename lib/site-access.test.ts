import { describe, it, expect, vi, beforeEach } from 'vitest';
import { originPattern, enableSite, disableSite, isEnabled, reconcile, listEnabledSites } from './site-access';

function installFakeChrome(granted: boolean) {
  const store: Record<string, any> = {};
  const registered: any[] = [];
  const perms = new Set<string>();
  (globalThis as any).chrome = {
    permissions: {
      request: vi.fn(async ({ origins }: any) => { if (granted) origins.forEach((o: string) => perms.add(o)); return granted; }),
      remove: vi.fn(async ({ origins }: any) => { origins.forEach((o: string) => perms.delete(o)); return true; }),
      contains: vi.fn(async ({ origins }: any) => origins.every((o: string) => perms.has(o))),
      onRemoved: { addListener: vi.fn() },
    },
    scripting: {
      registerContentScripts: vi.fn(async (s: any[]) => { registered.push(...s); }),
      unregisterContentScripts: vi.fn(async () => {}),
    },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: store[k] })),
        set: vi.fn(async (obj: any) => { Object.assign(store, obj); }),
      },
    },
  };
  return { store, registered, perms };
}

beforeEach(() => { delete (globalThis as any).chrome; });

describe('originPattern', () => {
  it('is the exact host, current scheme, no wildcard eTLD+1', () => {
    expect(originPattern('https://login.aliexpress.com/foo?x=1')).toBe('https://login.aliexpress.com/*');
  });
});

describe('enableSite', () => {
  it('on grant: registers the content script and records the origin', async () => {
    const ctx = installFakeChrome(true);
    const ok = await enableSite('https://aliexpress.com/login');
    expect(ok).toBe(true);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0].matches).toEqual(['https://aliexpress.com/*']);
    expect(await isEnabled('https://aliexpress.com/anything')).toBe(true);
  });
  it('on denial: registers nothing and records nothing', async () => {
    const ctx = installFakeChrome(false);
    const ok = await enableSite('https://aliexpress.com/login');
    expect(ok).toBe(false);
    expect(ctx.registered).toHaveLength(0);
    expect(await isEnabled('https://aliexpress.com/x')).toBe(false);
  });
});

describe('disableSite', () => {
  it('unregisters, removes the permission, and prunes the list', async () => {
    installFakeChrome(true);
    await enableSite('https://aliexpress.com/login');
    await disableSite('https://aliexpress.com/login');
    expect(await isEnabled('https://aliexpress.com/x')).toBe(false);
    expect((chrome.permissions.remove as any)).toHaveBeenCalled();
    expect((chrome.scripting.unregisterContentScripts as any)).toHaveBeenCalled();
  });
});

describe('ported-origin reconcile', () => {
  it('grants a portless host pattern and stores the portless canonical origin', async () => {
    const ctx = installFakeChrome(true);
    await enableSite('https://localhost:3000/login');
    expect((chrome.permissions.request as any)).toHaveBeenCalledWith({ origins: ['https://localhost/*'] });
    expect(await listEnabledSites()).toEqual(['https://localhost']);
  });

  it('does NOT self-disable a non-default-port site on reconcile', async () => {
    installFakeChrome(true);
    await enableSite('https://localhost:3000/login');
    await reconcile();
    expect(await isEnabled('https://localhost:3000/anything')).toBe(true);
  });
});
