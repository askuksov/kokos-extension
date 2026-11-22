import { describe, it, expect, vi, beforeEach } from 'vitest';
import { originPattern, enableSite, disableSite, isEnabled, reconcile, listEnabledSites, siteOriginOf, onOriginsAdded, initSiteAccess } from './site-access';

function installFakeChrome(granted: boolean) {
  const store: Record<string, any> = {};
  const registered: any[] = [];
  const perms = new Set<string>();
  (globalThis as any).chrome = {
    permissions: {
      request: vi.fn(async ({ origins }: any) => { if (granted) origins.forEach((o: string) => perms.add(o)); return granted; }),
      remove: vi.fn(async ({ origins }: any) => { origins.forEach((o: string) => perms.delete(o)); return true; }),
      contains: vi.fn(async ({ origins }: any) => origins.every((o: string) => perms.has(o))),
      getAll: vi.fn(async () => ({ origins: [...perms] })),
      onRemoved: { addListener: vi.fn() },
      onAdded: { addListener: vi.fn() },
    },
    scripting: {
      registerContentScripts: vi.fn(async (s: any[]) => {
        if (s.some((script) => registered.some((r) => r.id === script.id))) throw new Error('Duplicate script ID');
        registered.push(...s);
      }),
      unregisterContentScripts: vi.fn(async ({ ids }: any) => {
        for (let i = registered.length - 1; i >= 0; i--) if (ids.includes(registered[i].id)) registered.splice(i, 1);
      }),
      getRegisteredContentScripts: vi.fn(async ({ ids }: any) => registered.filter((r) => ids.includes(r.id))),
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

describe('siteOriginOf', () => {
  it('accepts an exact-host grant', () => {
    expect(siteOriginOf('https://a.com/*')).toBe('https://a.com');
    expect(siteOriginOf('http://localhost/*')).toBe('http://localhost');
  });
  it('rejects broad or odd patterns', () => {
    for (const p of ['<all_urls>', '*://*/*', 'https://*.a.com/*', 'https://a.com/path/*', 'file:///*', 'https://a.com:8080/*']) {
      expect(siteOriginOf(p)).toBeNull();
    }
  });
});

describe('onOriginsAdded (grant finished in the background)', () => {
  it('registers and records an exact-host grant', async () => {
    const ctx = installFakeChrome(true);
    await onOriginsAdded(['https://a.com/*']);
    expect(ctx.registered.map((r) => r.matches[0])).toEqual(['https://a.com/*']);
    expect(await listEnabledSites()).toEqual(['https://a.com']);
  });
  it('ignores an all-sites grant', async () => {
    const ctx = installFakeChrome(true);
    await onOriginsAdded(['<all_urls>', '*://*/*']);
    expect(ctx.registered).toEqual([]);
    expect(await listEnabledSites()).toEqual([]);
  });
  it('does not duplicate a site the popup already enabled', async () => {
    installFakeChrome(true);
    await enableSite('https://a.com/login');
    await onOriginsAdded(['https://a.com/*']);
    expect(await listEnabledSites()).toEqual(['https://a.com']);
  });
  it('two callers enabling the same site at once both succeed with one registration', async () => {
    const ctx = installFakeChrome(true);
    // Both unregister first, then both register: the second hits a duplicate id.
    await expect(Promise.all([
      onOriginsAdded(['https://a.com/*']),
      onOriginsAdded(['https://a.com/*']),
    ])).resolves.toBeDefined();
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(2);
    expect(ctx.registered.map((r) => r.id)).toEqual(['kokos-cs:https://a.com/*']);
    expect(await listEnabledSites()).toEqual(['https://a.com']);
  });
  it('still fails when registration fails and nothing is registered', async () => {
    installFakeChrome(true);
    (chrome.scripting.registerContentScripts as any).mockRejectedValueOnce(new Error('bad file'));
    await expect(onOriginsAdded(['https://a.com/*'])).rejects.toThrow('bad file');
  });
});

describe('reconcile picks up a missed grant', () => {
  it('enables a granted exact host that is not in the list', async () => {
    const ctx = installFakeChrome(true);
    ctx.perms.add('https://b.com/*');
    ctx.perms.add('<all_urls>');
    await reconcile();
    expect(await listEnabledSites()).toEqual(['https://b.com']);
  });
});

describe('initSiteAccess onAdded', () => {
  it('reports the sites a grant enabled, and nothing for an all-sites grant', async () => {
    installFakeChrome(true);
    const onEnabled = vi.fn();
    initSiteAccess(onEnabled);
    const listener = (chrome.permissions.onAdded.addListener as any).mock.calls[0][0];
    listener({ origins: ['<all_urls>'] });
    listener({ origins: ['https://a.com/*'] });
    await vi.waitFor(() => expect(onEnabled).toHaveBeenCalledWith(['https://a.com']));
    expect(onEnabled).toHaveBeenCalledTimes(1);
  });
});

describe('serialized list changes', () => {
  // A slow storage read makes unserialized read-modify-write cycles overlap.
  function slowReads() {
    const get = chrome.storage.local.get as any;
    const orig = get.getMockImplementation()!;
    get.mockImplementation(async (k: string) => {
      const value = await orig(k);
      await new Promise((r) => setTimeout(r, 5));
      return value;
    });
  }

  it('keeps every origin when enables overlap', async () => {
    installFakeChrome(true);
    slowReads();
    await Promise.all([
      enableSite('https://a.com/'),
      enableSite('https://b.com/'),
      enableSite('https://c.com/'),
    ]);
    expect((await listEnabledSites()).sort()).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('keeps a concurrent enable when a disable and a permission removal overlap', async () => {
    installFakeChrome(true);
    await enableSite('https://a.com/');
    await enableSite('https://b.com/');
    initSiteAccess();
    await new Promise((r) => setTimeout(r, 0)); // let the startup reconcile finish before slowing reads
    slowReads();
    const onRemoved = (chrome.permissions.onRemoved.addListener as any).mock.calls[0][0];
    await Promise.all([
      disableSite('https://a.com/'),
      enableSite('https://c.com/'),
      onRemoved({ origins: ['https://b.com/*'] }),
    ]);
    await vi.waitFor(async () => expect(await listEnabledSites()).toEqual(['https://c.com']));
  });

  it('a failed change does not block later ones', async () => {
    installFakeChrome(true);
    (chrome.storage.local.set as any).mockRejectedValueOnce(new Error('quota'));
    await expect(enableSite('https://a.com/')).rejects.toThrow('quota');
    await enableSite('https://b.com/');
    expect(await listEnabledSites()).toEqual(['https://b.com']);
  });
});

describe('cross-context serialization (Web Locks)', () => {
  // Two copies of the module stand in for the popup and the background: each has
  // its own promise chain, and they share only storage and the lock manager.
  function fakeLocks() {
    const tails = new Map<string, Promise<unknown>>();
    const request = vi.fn(<T,>(name: string, cb: () => Promise<T>): Promise<T> => {
      const run = (tails.get(name) ?? Promise.resolve()).then(cb);
      tails.set(name, run.catch(() => {}));
      return run;
    });
    return { request };
  }

  function slowReads() {
    const get = chrome.storage.local.get as any;
    const orig = get.getMockImplementation()!;
    get.mockImplementation(async (k: string) => {
      const value = await orig(k);
      await new Promise((r) => setTimeout(r, 5));
      return value;
    });
  }

  async function secondContext() {
    vi.resetModules();
    return import('./site-access');
  }

  it('keeps both origins when two contexts enable at once', async () => {
    installFakeChrome(true);
    slowReads();
    const locks = fakeLocks();
    vi.stubGlobal('navigator', { locks });
    const other = await secondContext();
    await Promise.all([enableSite('https://a.com/'), other.enableSite('https://b.com/')]);
    expect((await listEnabledSites()).sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(locks.request).toHaveBeenCalledWith('kokos-enabled-sites', expect.any(Function));
    vi.unstubAllGlobals();
  });

  it('falls back to the in-module chain when navigator.locks is missing', async () => {
    installFakeChrome(true);
    slowReads();
    vi.stubGlobal('navigator', {});
    await Promise.all([enableSite('https://a.com/'), enableSite('https://b.com/')]);
    expect((await listEnabledSites()).sort()).toEqual(['https://a.com', 'https://b.com']);
    vi.unstubAllGlobals();
  });

  it('a failed locked change does not block later ones', async () => {
    installFakeChrome(true);
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    (chrome.storage.local.set as any).mockRejectedValueOnce(new Error('quota'));
    await expect(enableSite('https://a.com/')).rejects.toThrow('quota');
    await enableSite('https://b.com/');
    expect(await listEnabledSites()).toEqual(['https://b.com']);
    vi.unstubAllGlobals();
  });
});
