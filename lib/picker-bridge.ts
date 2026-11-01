// lib/picker-bridge.ts
// SECURITY. The one place the popup's site-scoped actions (list logins, copy a
// password) are authenticated and given a BROWSER-DERIVED url. Chrome-free (deps
// injected) so the whole trust boundary is unit- and mutation-testable without
// the chrome global — mirrors save-bridge.ts / message-bridge.ts (a
// boundary wired as a private closure inside the entrypoint is untestable).
//
// The url a secret is scoped to comes from the tab record (deps.getTabUrl), NEVER
// from the popup message — the popup supplies only a tabId and entryId. copy-secret
// returns the value to the popup (inherent to the opted-in Copy-pw feature); this
// module never logs or stores it.

import type { NmhResponse, GetLoginsResult, GetSecretResult, GetTotpResult } from './nmh-client';
import type { ListSiteLoginsMsg, CopySecretMsg, CopyTotpMsg, PickerListResult, PickerSecretResult, CopyTotpResult } from './entry-picker';

export interface PickerSenderLike {
  id?: string;
  tab?: { id?: number };
}

export interface PickerBridgeDeps {
  ownId: string;
  request(origin: string, action: string, payload: object): Promise<NmhResponse>;
  getTabUrl(tabId: number): Promise<string | undefined>; // browser-derived (chrome.tabs.get)
}

const PICKER_TYPES = new Set(['list-site-logins', 'copy-secret', 'copy-totp']);

function isPickerMsg(msg: unknown): msg is ListSiteLoginsMsg | CopySecretMsg | CopyTotpMsg {
  return typeof msg === 'object' && msg !== null && PICKER_TYPES.has((msg as { type?: string }).type ?? '');
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

/** The one function `chrome.runtime.onMessage` delegates the picker flow to.
 * Returns null for a non-picker message (the caller falls through). Every path
 * is authenticated: own extension id + popup-only (no tab) so a page frame
 * can never drive the picker. The url is derived from the tab record here, never
 * trusted from the message. */
export async function routePickerMessage(
  msg: unknown,
  sender: PickerSenderLike | undefined,
  deps: PickerBridgeDeps,
): Promise<PickerListResult | PickerSecretResult | CopyTotpResult | null> {
  if (!isPickerMsg(msg)) return null;
  if (!sender || sender.id !== deps.ownId) return { ok: false, code: 'denied' };
  if (typeof sender.tab?.id === 'number') return { ok: false, code: 'denied' }; // popup-only

  const url = await deps.getTabUrl(msg.tabId);
  const origin = httpOrigin(url);
  if (!url || !origin) return { ok: false, code: 'invalid_url' };

  if (msg.type === 'list-site-logins') {
    const resp = await deps.request(origin, 'get_logins', { url });
    if (!resp.ok || !resp.payload) return { ok: false, code: resp.error?.code ?? 'internal' };
    return { ok: true, items: (resp.payload as GetLoginsResult).items ?? [] };
  }

  if (msg.type === 'copy-totp') {
    const resp = await deps.request(origin, 'get_totp', { entry_id: msg.entryId, url });
    if (!resp.ok || !resp.payload) return { ok: false, code: resp.error?.code ?? 'internal' };
    const p = resp.payload as GetTotpResult;
    return { ok: true, code: p.code, remaining: p.remaining };
  }

  // copy-secret
  const resp = await deps.request(origin, 'get_secret', { entry_id: msg.entryId, url });
  if (!resp.ok || !resp.payload) return { ok: false, code: resp.error?.code ?? 'internal' };
  return { ok: true, value: (resp.payload as GetSecretResult).value };
}
