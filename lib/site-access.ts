// Per-site opt-in. Requests ONLY the exact host at runtime from a user
// gesture, then dynamically registers the content script for that host and
// records the origin (non-secret) so a browser restart / SW respawn can
// reconcile. Never over-requests a wildcard eTLD+1 — the app's psl anchor is the
// real gate. Stores no secret.

const STORAGE_KEY = 'enabledSites';
const CS_ID_PREFIX = 'kokos-cs:';

export function contentScriptFile(): string {
  return 'content-scripts/content.js';
}

// The portless canonical origin is the stored key AND the basis of the granted
// host pattern — a Chrome host permission is host-wide (it ignores port), so
// keying on the origin-with-port desynced storage from the grant and made
// reconcile compute an invalid ported match pattern (a self-disable bug).
function canonicalOrigin(originOrUrl: string): string {
  const u = new URL(originOrUrl);
  return `${u.protocol}//${u.hostname}`;
}

export function originPattern(url: string): string {
  return `${canonicalOrigin(url)}/*`;
}

async function getList(): Promise<string[]> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const v = (got as Record<string, unknown>)[STORAGE_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

async function setList(list: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...new Set(list)] });
}

async function registerFor(pattern: string): Promise<void> {
  const id = CS_ID_PREFIX + pattern;
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch { /* not registered yet */ }
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [pattern],
    js: [contentScriptFile()],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
}

async function unregisterFor(pattern: string): Promise<void> {
  try { await chrome.scripting.unregisterContentScripts({ ids: [CS_ID_PREFIX + pattern] }); } catch { /* already gone */ }
}

export async function enableSite(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return false;
  await registerFor(pattern);
  await setList([...(await getList()), canonicalOrigin(url)]);
  return true;
}

export async function disableSite(url: string): Promise<void> {
  const pattern = originPattern(url);
  await unregisterFor(pattern);
  await setList((await getList()).filter((o) => o !== canonicalOrigin(url)));
  try { await chrome.permissions.remove({ origins: [pattern] }); } catch { /* ignore */ }
}

export async function isEnabled(url: string): Promise<boolean> {
  return (await getList()).includes(canonicalOrigin(url));
}

export async function listEnabledSites(): Promise<string[]> {
  return getList();
}

export async function reconcile(): Promise<void> {
  for (const origin of await getList()) {
    const pattern = `${origin}/*`;
    if (await chrome.permissions.contains({ origins: [pattern] })) await registerFor(pattern);
    else await setList((await getList()).filter((o) => o !== origin));
  }
}

export function initSiteAccess(): void {
  chrome.permissions.onRemoved.addListener((p) => {
    const origins = p.origins ?? [];
    void (async () => {
      for (const pattern of origins) {
        await unregisterFor(pattern);
        const origin = pattern.replace(/\/\*$/, '');
        await setList((await getList()).filter((o) => o !== origin));
      }
    })();
  });
  void reconcile();
}
