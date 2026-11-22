// The "Kokos is locked, ask it to unlock" path. The app shows its own unlock
// dialog (vault picker + password / Touch ID); the password never passes
// through the extension. Only a user action reaches this: the key icon in a
// field, the popup's Unlock / Unlock and save buttons, the fill shortcut. A
// page cannot send runtime messages, and the generic nmh-request bridge refuses
// request_unlock, so every request goes through the checks here.
// Chrome-free (deps injected), like save-bridge.ts.

import type { NmhResponse } from './nmh-client';

// After the user cancels the dialog, stay quiet for a while: the app refuses
// too, this only saves the round trip.
export const DENIED_COOLDOWN_MS = 30_000;

// Requests in flight, one slot per kind: a keepOpen call sends its own
// request even while a plain one runs, and either may finish first.
export interface UnlockState {
  inflight: Promise<NmhResponse> | null;
  inflightKeepOpen: Promise<NmhResponse> | null;
  deniedAt: number | null;
}

export function newUnlockState(): UnlockState {
  return { inflight: null, inflightKeepOpen: null, deniedAt: null };
}

export interface UnlockDeps {
  ownId: string;
  request(origin: string, action: string, payload: object): Promise<NmhResponse>;
  isEnabled(url: string): Promise<boolean>;
  getTabUrl(tabId: number): Promise<string | undefined>;
  // Called after an unlock that opened a vault, e.g. to repaint the badge.
  onUnlocked?(tabId: number | undefined): void;
  now(): number;
  state: UnlockState;
}

export interface UnlockSenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

function err(code: string, message: string): NmhResponse {
  return { id: 'unlock', ok: false, error: { code, message } };
}

function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Asks the app to unlock for `url`. One request at a time: a second call
 * while the dialog is open waits for the same answer. `keepOpen` keeps the
 * app window up after the unlock (a save shows its confirm prompt next).
 * A keepOpen call cannot ride on a request sent without it, so it sends its
 * own: the app joins it to the dialog already open (still one dialog) and
 * keeps the window up for everyone. */
export async function requestUnlock(url: string | undefined, keepOpen: boolean, deps: UnlockDeps): Promise<NmhResponse> {
  const origin = httpOrigin(url);
  if (!url || !origin) return err('bad_request', 'no site to unlock for');
  if (!(await deps.isEnabled(url))) return err('denied', 'Kokos is not enabled on this site');
  const s = deps.state;
  // A keepOpen request answers a plain call too; the reverse does not hold.
  const joinable = keepOpen ? s.inflightKeepOpen : (s.inflightKeepOpen ?? s.inflight);
  if (joinable) return joinable;
  if (s.deniedAt !== null && deps.now() - s.deniedAt < DENIED_COOLDOWN_MS) {
    return err('denied', 'unlock was cancelled recently');
  }
  const p = deps.request(origin, 'request_unlock', { url, keep_open: keepOpen }).then((resp) => {
    if (!resp.ok && resp.error?.code === 'denied') s.deniedAt = deps.now();
    return resp;
  });
  if (keepOpen) s.inflightKeepOpen = p;
  else s.inflight = p;
  try {
    return await p;
  } finally {
    if (s.inflight === p) s.inflight = null;
    if (s.inflightKeepOpen === p) s.inflightKeepOpen = null;
  }
}

interface RequestUnlockMsg { type: 'request-unlock'; tabId?: number; }

function isUnlockMsg(msg: unknown): msg is RequestUnlockMsg {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'request-unlock';
}

/** Routes `{ type: 'request-unlock' }`. From a content script the site is the
 * sending frame (browser-set `sender.url`); from the popup (no tab) it is the
 * named tab's url, read from the browser. Returns null for other messages. */
export async function routeUnlockMessage(msg: unknown, sender: UnlockSenderLike | undefined, deps: UnlockDeps): Promise<NmhResponse | null> {
  if (!isUnlockMsg(msg)) return null;
  if (!sender || sender.id !== deps.ownId) return err('denied', 'unknown sender');
  const frameTab = sender.tab?.id;
  let tabId: number | undefined;
  let url: string | undefined;
  if (typeof frameTab === 'number') {
    tabId = frameTab;
    url = sender.url;
  } else if (typeof msg.tabId === 'number') {
    tabId = msg.tabId;
    url = await deps.getTabUrl(msg.tabId);
  } else {
    return err('bad_request', 'no tab');
  }
  const resp = await requestUnlock(url, false, deps);
  if (resp.ok) deps.onUnlocked?.(tabId);
  return resp;
}
