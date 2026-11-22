// The save-flow message router + pending-capture store. Chrome-free (deps
// injected) so the whole trust boundary is unit- and mutation-testable without
// the chrome global — mirrors message-bridge.ts (a boundary wired as
// a private closure inside the entrypoint is untestable). This module is the ONE
// place the captured password lives after capture; it never returns the password
// to any caller (the popup receives metadata only) and never logs it.

import { classifySave, clampSaveField } from './save-capture';
import { valueToken, shouldBadge, recordPrompt, forgetPrompt, recordSaved, wasSaved, forgetSaved, type GateState } from './save-prompt-gate';
import type { NmhResponse, GetLoginsResult } from './nmh-client';

const MAX_FIELD_CHARS = 256;    // matches the host's confirm-emit clamp
export const PENDING_TTL_MS = 120_000; // 2 min hard cap on a held capture

export interface Pending {
  token: string;    // supersession token; commit must present this exact value
  username: string;
  password: string; // the captured secret — never leaves this module except as a write
  url: string;      // trusted frame URL (sender.url) — the save/update url
  origin: string;   // trusted frame origin (sender.origin) — port routing + dedupe key
  ts: number;
  busy?: boolean;   // a save of this capture is in flight: a second one must not write again
}

// A content-script frame message (has a tab). username/password are the field
// values read via the detection path.
interface SaveCaptureMsg { type: 'save-capture'; username: string; password: string; }
// Popup (extension page, no tab) messages.
interface GetPendingMsg { type: 'get-pending-save'; tabId: number; }
// `token` is optional. The popup sends the token of the capture it shows
// (PendingView.token), so a capture that replaced it meanwhile is not saved
// under the old prompt. An ABSENT token means "the live pending"; a PRESENT
// token must match (defeats a stale explicit commit).
interface CommitMsg { type: 'commit-pending-save'; tabId: number; token?: string; }
interface DismissMsg { type: 'dismiss-pending-save'; tabId: number; token?: string; }
interface NeverMsg { type: 'never-save-here'; tabId: number; }
// The popup's "Unlock and save" on a locked app: raise the app's unlock dialog,
// then commit the live pending.
interface UnlockSaveMsg { type: 'unlock-and-save'; tabId: number; token?: string; }
type SaveMsg = SaveCaptureMsg | GetPendingMsg | CommitMsg | DismissMsg | NeverMsg | UnlockSaveMsg;

export interface SaveSenderLike {
  id?: string;
  origin?: string;
  url?: string;
  tab?: { id?: number };
}

export interface PendingView {
  present: boolean;
  mode?: 'save' | 'update';
  username?: string;
  site?: string;
  // Supersession token of the shown capture, sent back with Save / Unlock and save.
  token?: string;
  locked?: boolean;
  // With `locked`: the app is not running at all, so there is nothing to unlock.
  offline?: boolean;
}

export interface SaveBridgeDeps {
  ownId: string;
  request(origin: string, action: string, payload: object): Promise<NmhResponse>;
  isEnabled(url: string): Promise<boolean>;
  // False while a policy-installed Firefox add-on waits for data-sharing
  // consent: a capture is then dropped, not held. Absent = consent not needed.
  hasConsent?(): Promise<boolean>;
  isSaveIgnored(url: string): Promise<boolean>;
  addSaveIgnore(url: string): Promise<void>;
  setBadge(tabId: number, on: boolean): void;
  // Bring a fresh capture in front of the user (auto-open popup or page hint).
  // Fire-and-forget: the capture reply must not wait for UI.
  promptSave(tabId: number): void;
  // Run sweepExpiredPending after `delayMs`, so a capture nobody looks at does
  // not outlive its TTL. Absent = expiry happens only on the next read/capture.
  scheduleSweep?(delayMs: number): void;
  // Asks the app to unlock (unlock-bridge.ts requestUnlock), keeping its window
  // up for the save confirm that follows. Absent = "Unlock and save" unsupported.
  unlock?(url: string): Promise<NmhResponse>;
  now(): number;
  newToken(): string;
  gate: GateState;
  pending: Map<number, Pending>;
  // Per-tab capture counter: a capture that finished its async checks after a
  // newer one from the same tab must not overwrite that newer capture.
  captureSeq: Map<number, number>;
}

const SAVE_TYPES = new Set(['save-capture', 'get-pending-save', 'commit-pending-save', 'dismiss-pending-save', 'never-save-here', 'unlock-and-save']);

function isSaveMsg(msg: unknown): msg is SaveMsg {
  return typeof msg === 'object' && msg !== null && SAVE_TYPES.has((msg as { type?: string }).type ?? '');
}
// Senders are authenticated by extension id, but the shape is still checked
// before anything is derived from it: a capture needs a string username and a
// non-empty string password; a popup message an integer tabId and, when given,
// a string token.
function hasValidFields(msg: SaveMsg): boolean {
  const m = msg as { username?: unknown; password?: unknown; tabId?: unknown; token?: unknown };
  if (msg.type === 'save-capture') {
    return typeof m.username === 'string' && typeof m.password === 'string' && m.password.length > 0;
  }
  return Number.isInteger(m.tabId) && (m.token === undefined || typeof m.token === 'string');
}
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return url; } }
function err(code: string, message: string): NmhResponse { return { id: 'save', ok: false, error: { code, message } }; }

function expired(p: Pending, deps: SaveBridgeDeps): boolean {
  return deps.now() - p.ts > PENDING_TTL_MS;
}

// Drop an expired capture: its password, its badge, and its "already offered"
// record, so the same login typed again later is offered again.
function expire(tabId: number, p: Pending, deps: SaveBridgeDeps): void {
  deps.pending.delete(tabId);
  deps.setBadge(tabId, false);
  forgetPrompt(deps.gate, { origin: p.origin, username: p.username, token: valueToken(p.password) });
}

/** Drop every held capture past its TTL. Safe to call at any time. */
export function sweepExpiredPending(deps: SaveBridgeDeps): void {
  for (const [tabId, p] of [...deps.pending]) if (expired(p, deps)) expire(tabId, p, deps);
}

function livePending(tabId: number, deps: SaveBridgeDeps): Pending | null {
  const p = deps.pending.get(tabId);
  if (!p) return null;
  if (expired(p, deps)) { expire(tabId, p, deps); return null; }
  return p;
}

async function itemsFor(p: Pick<Pending, 'origin' | 'url'>, deps: SaveBridgeDeps): Promise<{ resp: NmhResponse; items: GetLoginsResult['items'] }> {
  const resp = await deps.request(p.origin, 'get_logins', { url: p.url });
  const items = resp.ok && resp.payload ? (resp.payload as GetLoginsResult).items ?? [] : [];
  return { resp, items };
}

// True when the vault holds a login with this username for the url. An app that
// is locked or not running counts as "has it": keep the dedupe, never re-nag.
async function vaultHasLogin(origin: string, url: string, username: string, deps: SaveBridgeDeps): Promise<boolean> {
  const { resp, items } = await itemsFor({ origin, url }, deps);
  if (!resp.ok) return true;
  const key = username.trim().toLowerCase();
  return items.some((i) => (i.username ?? '').trim().toLowerCase() === key);
}

async function handleCapture(msg: SaveCaptureMsg, sender: SaveSenderLike, deps: SaveBridgeDeps): Promise<{ ok: boolean }> {
  const tabId = sender.tab?.id;
  const origin = sender.origin;                 // browser-derived, unspoofable
  const url = sender.url && sender.url.length > 0 ? sender.url : origin;
  if (typeof tabId !== 'number' || !origin || !url) return { ok: false }; // not a real content-script sender
  sweepExpiredPending(deps); // an expired capture must not dedupe this one
  const seq = (deps.captureSeq.get(tabId) ?? 0) + 1;
  deps.captureSeq.set(tabId, seq);
  const superseded = () => deps.captureSeq.get(tabId) !== seq;
  // Disabling a site does not stop content scripts already running in open tabs,
  // so a capture can still arrive from a site the user has turned off.
  const noConsent = async () => !!deps.hasConsent && !(await deps.hasConsent());
  if (await noConsent()) return { ok: false };
  if (!(await deps.isEnabled(url))) return { ok: false };
  if (await deps.isSaveIgnored(url)) return { ok: false };
  if (superseded()) return { ok: false };
  const token = valueToken(msg.password);
  const key = { origin, username: msg.username, token };
  if (!shouldBadge(deps.gate, key)) {
    // Same value already offered this session. Offer again only when the user
    // saved it and the vault no longer has that login (deleted in the app).
    if (!wasSaved(deps.gate, key) || await vaultHasLogin(origin, url, msg.username, deps)) return { ok: false };
    if (superseded()) return { ok: false };
    forgetSaved(deps.gate, key);
  }
  // Consent can be withdrawn while the checks above awaited storage: ask again
  // right before the password is held.
  if (await noConsent()) return { ok: false };
  if (superseded()) return { ok: false }; // a newer capture landed during that await
  recordPrompt(deps.gate, key);
  deps.pending.set(tabId, { token: deps.newToken(), username: msg.username, password: msg.password, url, origin, ts: deps.now() });
  deps.setBadge(tabId, true);
  deps.promptSave(tabId);
  deps.scheduleSweep?.(PENDING_TTL_MS + 1_000);
  return { ok: true };
}

async function viewPending(tabId: number, deps: SaveBridgeDeps): Promise<PendingView> {
  const p = livePending(tabId, deps);
  if (!p) return { present: false };
  const { resp, items } = await itemsFor(p, deps);
  if (!resp.ok && (resp.error?.code === 'locked' || resp.error?.code === 'app_not_running')) {
    const offline = resp.error?.code === 'app_not_running';
    return { present: true, token: p.token, locked: true, offline, username: p.username, site: hostOf(p.url) };
  }
  const decision = classifySave({ username: p.username }, items);
  return { present: true, token: p.token, mode: decision.mode, username: p.username, site: hostOf(p.url) };
}

// The live pending a save may act on: present, matching `token` when one is
// given, and not already being saved.
function pendingFor(tabId: number, token: string | undefined, deps: SaveBridgeDeps): Pending | NmhResponse {
  const p = livePending(tabId, deps);
  if (!p) return err('bad_request', 'no pending capture');
  if (token !== undefined && p.token !== token) return err('bad_request', 'superseded capture');
  if (p.busy) return err('bad_request', 'save already in progress');
  return p;
}

function isPending(v: Pending | NmhResponse): v is Pending {
  return 'token' in v;
}

async function commit(tabId: number, token: string | undefined, deps: SaveBridgeDeps): Promise<NmhResponse> {
  const p = pendingFor(tabId, token, deps);
  if (!isPending(p)) return p;
  p.busy = true;
  try {
    return await write(tabId, p, deps);
  } finally {
    p.busy = false;
  }
}

async function write(tabId: number, p: Pending, deps: SaveBridgeDeps): Promise<NmhResponse> {
  const { resp, items } = await itemsFor(p, deps);
  if (!resp.ok) return resp; // locked / app_not_running: surface, keep the pending for retry
  const decision = classifySave({ username: p.username }, items);
  const out = decision.mode === 'update'
    ? await deps.request(p.origin, 'update_login', { entry_id: decision.entryId, password: p.password, url: p.url })
    : await deps.request(p.origin, 'save_login', { url: p.url, username: clampSaveField(p.username, MAX_FIELD_CHARS), password: p.password });
  // Clear on success and on a DEFINITIVE failure (user declined, or a retry cannot
  // help); keep only on a TRANSIENT failure the user can resolve then retry
  // (vault locked / no vault open / app not running / timeout). A denied
  // write clears the pending — the user said no.
  const code = out.error?.code;
  const keep = !out.ok && (code === 'locked' || code === 'no_vault' || code === 'app_not_running' || code === 'timeout');
  if (out.ok) recordSaved(deps.gate, { origin: p.origin, username: p.username, token: valueToken(p.password) });
  // Clear only this capture: a newer one that replaced it meanwhile stays.
  if (!keep && deps.pending.get(tabId) === p) { deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return out;
}

async function unlockAndSave(tabId: number, token: string | undefined, deps: SaveBridgeDeps): Promise<NmhResponse> {
  const p = pendingFor(tabId, token, deps);
  if (!isPending(p)) return p;
  if (!deps.unlock) return err('locked', 'unlock not available');
  p.busy = true;
  try {
    const u = await deps.unlock(p.url);
    if (!u.ok) return u;
    // Save only the capture the user asked to save, not one that replaced it
    // (or expired) while the unlock dialog was open.
    if (livePending(tabId, deps) !== p) return err('bad_request', 'superseded capture');
    return await write(tabId, p, deps);
  } finally {
    p.busy = false;
  }
}

function dismiss(tabId: number, token: string | undefined, deps: SaveBridgeDeps): { ok: boolean } {
  const p = deps.pending.get(tabId);
  if (p && (token === undefined || p.token === token)) { deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return { ok: true };
}

async function never(tabId: number, deps: SaveBridgeDeps): Promise<{ ok: boolean }> {
  const p = deps.pending.get(tabId);
  if (!p) return { ok: true };
  await deps.addSaveIgnore(p.url);
  // A capture that replaced this one during the write is not ours to clear.
  if (deps.pending.get(tabId) === p) { deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return { ok: true };
}

/** The one function chrome.runtime.onMessage delegates the save flow to. Returns
 * null for a non-save message (the caller falls through). Authenticates every
 * message: own extension id + a content-script vs popup sender split so a
 * page frame can never drive the popup-only commit/dismiss/never actions. */
export async function routeSaveMessage(msg: unknown, sender: SaveSenderLike | undefined, deps: SaveBridgeDeps): Promise<unknown> {
  if (!isSaveMsg(msg)) return null;
  if (!sender || sender.id !== deps.ownId) return { ok: false, code: 'denied' };
  if (!hasValidFields(msg)) return { ok: false, code: 'bad_request' };
  if (msg.type === 'save-capture') return handleCapture(msg, sender, deps);
  // Popup-only actions: must come from an extension page (no tab), never a frame.
  if (typeof sender.tab?.id === 'number') return { ok: false, code: 'denied' };
  switch (msg.type) {
    case 'get-pending-save': return viewPending(msg.tabId, deps);
    case 'commit-pending-save': return commit(msg.tabId, msg.token, deps);
    case 'dismiss-pending-save': return dismiss(msg.tabId, msg.token, deps);
    case 'never-save-here': return never(msg.tabId, deps);
    case 'unlock-and-save': return unlockAndSave(msg.tabId, msg.token, deps);
  }
}
