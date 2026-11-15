// Whether the Kokos icons (key + password wand) appear inside login fields.
// A global switch (on by default) plus a per-site "hide the icon here" list,
// both non-secret, in chrome.storage.local. Hiding the icon never turns Kokos
// off for the site: popup Fill and the keyboard shortcut keep working.

export const SHOW_ICON_KEY = 'showFieldIcon';
export const HIDDEN_SITES_KEY = 'iconHiddenSites';

export interface IconPrefs {
  showIcon: boolean;
  hiddenSites: string[];
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function asPrefs(got: Record<string, unknown>): IconPrefs {
  const show = got[SHOW_ICON_KEY];
  const hidden = got[HIDDEN_SITES_KEY];
  return {
    showIcon: show !== false, // missing or malformed reads as the default: shown
    hiddenSites: Array.isArray(hidden) ? hidden.filter((o): o is string => typeof o === 'string') : [],
  };
}

export async function loadIconPrefs(): Promise<IconPrefs> {
  const got = await chrome.storage.local.get([SHOW_ICON_KEY, HIDDEN_SITES_KEY]);
  return asPrefs(got as Record<string, unknown>);
}

/** Pure decision used by the content script on every scan. */
export function iconAllowed(prefs: IconPrefs, url: string): boolean {
  if (!prefs.showIcon) return false;
  try { return !prefs.hiddenSites.includes(originOf(url)); } catch { return true; }
}

/** True when a storage change touches either icon preference. */
export function isIconPrefsChange(changes: Record<string, unknown>, area: string): boolean {
  return area === 'local' && (SHOW_ICON_KEY in changes || HIDDEN_SITES_KEY in changes);
}

export async function setShowIcon(show: boolean): Promise<void> {
  await chrome.storage.local.set({ [SHOW_ICON_KEY]: show });
}

// Read-modify-write of the site list runs one at a time within this context, so
// two quick clicks cannot both read the old list and drop each other's change.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const next = chain.then(op, op);
  chain = next.catch(() => undefined);
  return next;
}

async function hiddenList(): Promise<string[]> {
  return (await loadIconPrefs()).hiddenSites;
}

export function hideIconOn(url: string): Promise<void> {
  const origin = originOf(url);
  return serial(async () => {
    await chrome.storage.local.set({ [HIDDEN_SITES_KEY]: [...new Set([...(await hiddenList()), origin])] });
  });
}

export function showIconOn(url: string): Promise<void> {
  const origin = originOf(url);
  return serial(async () => {
    await chrome.storage.local.set({ [HIDDEN_SITES_KEY]: (await hiddenList()).filter((o) => o !== origin) });
  });
}

export async function isIconHiddenOn(url: string): Promise<boolean> {
  return (await hiddenList()).includes(originOf(url));
}

export async function listIconHiddenSites(): Promise<string[]> {
  return hiddenList();
}
