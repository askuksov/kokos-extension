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
  try {
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [pattern],
      js: [contentScriptFile()],
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  } catch (e) {
    // The popup and the onAdded handler can both enable the same site at once;
    // whoever registers second hits a duplicate id. Already registered is fine.
    const got = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
    if (got.length === 0) throw e;
  }
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

// The origin of an exact-host grant (`https://host/*`), or null for anything
// broader (`<all_urls>`, `*://*/*`, wildcard hosts): those come from the
// browser's own site-access menu and must not enable every site at once.
export function siteOriginOf(pattern: string): string | null {
  const m = /^(https?):\/\/([^/*:]+)\/\*$/.exec(pattern);
  return m ? `${m[1]}://${m[2]}` : null;
}

/** Finish enabling sites the user granted. Firefox closes the popup when the
 * permission prompt opens, so enableSite never gets past its request there;
 * the background completes the job from permissions.onAdded instead. */
export async function onOriginsAdded(patterns: string[]): Promise<string[]> {
  const enabled: string[] = [];
  for (const pattern of patterns) {
    const origin = siteOriginOf(pattern);
    if (!origin) continue;
    await registerFor(`${origin}/*`);
    await setList([...(await getList()), origin]);
    enabled.push(origin);
  }
  return enabled;
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
  // A grant whose onAdded was missed (e.g. the worker died mid-enable) is
  // finished here on the next start.
  const listed = new Set(await getList());
  const granted = (await chrome.permissions.getAll()).origins ?? [];
  await onOriginsAdded(granted.filter((p) => {
    const o = siteOriginOf(p);
    return o !== null && !listed.has(o);
  }));
}

/** `onEnabled` gets the origins a grant enabled, so the caller can bring open
 * pages up to date (the popup may be gone, see onOriginsAdded). */
export function initSiteAccess(onEnabled?: (origins: string[]) => void): void {
  chrome.permissions.onAdded.addListener((p) => {
    void onOriginsAdded(p.origins ?? []).then(
      (origins) => { if (origins.length > 0) onEnabled?.(origins); },
      () => { /* reconcile retries on next start */ },
    );
  });
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
