import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadIconPrefs, iconAllowed, isIconPrefsChange, setShowIcon,
  hideIconOn, showIconOn, isIconHiddenOn, listIconHiddenSites,
} from './icon-prefs';

let store: Record<string, unknown>;
function installFakeChrome() {
  store = {};
  (globalThis as any).chrome = {
    storage: { local: {
      get: vi.fn(async (keys: string | string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = store[k];
        return out;
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  };
}
beforeEach(() => { delete (globalThis as any).chrome; installFakeChrome(); });

describe('loadIconPrefs', () => {
  it('defaults to shown with no hidden sites', async () => {
    expect(await loadIconPrefs()).toEqual({ showIcon: true, hiddenSites: [] });
  });
  it('reads the stored switch and list, ignoring malformed values', async () => {
    store.showFieldIcon = false;
    store.iconHiddenSites = ['https://a.com', 42];
    expect(await loadIconPrefs()).toEqual({ showIcon: false, hiddenSites: ['https://a.com'] });
    store.showFieldIcon = 'no';
    store.iconHiddenSites = 'https://a.com';
    expect(await loadIconPrefs()).toEqual({ showIcon: true, hiddenSites: [] });
  });
});

describe('iconAllowed', () => {
  it('is off everywhere when the global switch is off', () => {
    expect(iconAllowed({ showIcon: false, hiddenSites: [] }, 'https://a.com/login')).toBe(false);
  });
  it('is off only on a hidden origin', () => {
    const prefs = { showIcon: true, hiddenSites: ['https://a.com'] };
    expect(iconAllowed(prefs, 'https://a.com/login')).toBe(false);
    expect(iconAllowed(prefs, 'https://b.com/login')).toBe(true);
    expect(iconAllowed(prefs, 'https://a.com:8443/login')).toBe(true); // origin includes the port
  });
});

describe('isIconPrefsChange', () => {
  it('matches either key in local storage only', () => {
    expect(isIconPrefsChange({ showFieldIcon: {} }, 'local')).toBe(true);
    expect(isIconPrefsChange({ iconHiddenSites: {} }, 'local')).toBe(true);
    expect(isIconPrefsChange({ enabledSites: {} }, 'local')).toBe(false);
    expect(isIconPrefsChange({ showFieldIcon: {} }, 'sync')).toBe(false);
  });
});

describe('per-site hide list', () => {
  it('hides by origin, ignoring the path, and shows again', async () => {
    await hideIconOn('https://a.com/login');
    expect(await isIconHiddenOn('https://a.com/other')).toBe(true);
    expect(await isIconHiddenOn('https://b.com/')).toBe(false);
    await showIconOn('https://a.com/x');
    expect(await isIconHiddenOn('https://a.com/login')).toBe(false);
  });
  it('does not duplicate an origin', async () => {
    await hideIconOn('https://a.com/x');
    await hideIconOn('https://a.com/y');
    expect(await listIconHiddenSites()).toEqual(['https://a.com']);
  });
  it('keeps both of two overlapping changes', async () => {
    await Promise.all([hideIconOn('https://a.com/'), hideIconOn('https://b.com/')]);
    expect(await listIconHiddenSites()).toEqual(['https://a.com', 'https://b.com']);
  });
  it('keeps working after a failed write', async () => {
    (chrome.storage.local.set as any).mockRejectedValueOnce(new Error('quota'));
    await expect(hideIconOn('https://a.com/')).rejects.toThrow('quota');
    await hideIconOn('https://b.com/');
    expect(await listIconHiddenSites()).toEqual(['https://b.com']);
  });
  it('the global switch does not touch the list', async () => {
    await hideIconOn('https://a.com/');
    await setShowIcon(false);
    expect(await loadIconPrefs()).toEqual({ showIcon: false, hiddenSites: ['https://a.com'] });
  });
});
