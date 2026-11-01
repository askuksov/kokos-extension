// lib/shortcut-fill.ts
// SECURITY. The keyboard-command fill path. A chrome.commands invocation is a
// user gesture with NO inbound message — the url is derived from the
// browser tab record here (deps.getTabUrl), never message-supplied.
// It picks the app's best match (items[0], the host's exact-host-first ranking)
// and delegates the actual fill to the content script via deps.dispatchFill (the
// existing popup-driven fill-entry receiver), so the secret is fetched + cleared entirely in
// the content script; this module only ever handles metadata (entryId + username).

import type { NmhResponse, GetLoginsResult } from './nmh-client';
import type { FillEntryResult } from './entry-picker';

export type ShortcutFillOutcome = 'filled-dispatch' | 'no-login' | 'no-url' | 'error';

export interface ShortcutFillDeps {
  getTabUrl(tabId: number): Promise<string | undefined>;                 // browser-derived (chrome.tabs)
  request(origin: string, action: string, payload: object): Promise<NmhResponse>;
  dispatchFill(tabId: number, entryId: string, username?: string): Promise<FillEntryResult | undefined>;
}

function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Fill the best-matching login on the active tab. Best match = items[0] from
 * get_logins (the host ranks exact-host first). Returns an outcome for optional
 * feedback; the password itself flows only inside the content script. */
export async function routeShortcutFill(tabId: number, deps: ShortcutFillDeps): Promise<ShortcutFillOutcome> {
  const url = await deps.getTabUrl(tabId);
  const origin = httpOrigin(url);
  if (!url || !origin) return 'no-url';

  const resp = await deps.request(origin, 'get_logins', { url });
  if (!resp.ok || !resp.payload) return 'error';
  const items = (resp.payload as GetLoginsResult).items ?? [];
  if (items.length === 0) return 'no-login';

  const best = items[0]!;
  await deps.dispatchFill(tabId, best.id, best.username ?? undefined);
  return 'filled-dispatch';
}
