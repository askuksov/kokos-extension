// The save-flow message router + pending-capture store. Chrome-free (deps
// injected) so the whole trust boundary is unit- and mutation-testable without
// the chrome global — mirrors message-bridge.ts (a boundary wired as
// a private closure inside the entrypoint is untestable). This module is the ONE
// place the captured password lives after capture; it never returns the password
// to any caller (the popup receives metadata only) and never logs it.

import { classifySave, clampSaveField } from './save-capture';
import { valueToken, shouldBadge, recordPrompt, recordSaved, wasSaved, forgetSaved, type GateState } from './save-prompt-gate';
import type { NmhResponse, GetLoginsResult } from './nmh-client';

const MAX_FIELD_CHARS = 256;    // matches the host's confirm-emit clamp
const PENDING_TTL_MS = 120_000; // 2 min hard cap on a held capture

export interface Pending {
  token: string;    // supersession token; commit must present this exact value
  username: string;
  password: string; // the captured secret — never leaves this module except as a write
  url: string;      // trusted frame URL (sender.url) — the save/update url
  origin: string;   // trusted frame origin (sender.origin) — port routing + dedupe key
  ts: number;
}

// A content-script frame message (has a tab). username/password are the field
// values read via the detection path.
interface SaveCaptureMsg { type: 'save-capture'; username: string; password: string; }
// Popup (extension page, no tab) messages.
interface GetPendingMsg { type: 'get-pending-save'; tabId: number; }
// `token` is optional: the popup cannot know the supersession token, and a popup
// click (trusted via sender.id) cannot cause the stale-content-script-capture
// race the token defends against. An ABSENT token means "the live pending";
// a PRESENT token must match (defeats a stale explicit commit).
interface CommitMsg { type: 'commit-pending-save'; tabId: number; token?: string; }
interface DismissMsg { type: 'dismiss-pending-save'; tabId: number; token?: string; }
interface NeverMsg { type: 'never-save-here'; tabId: number; }
type SaveMsg = SaveCaptureMsg | GetPendingMsg | CommitMsg | DismissMsg | NeverMsg;

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
  locked?: boolean;
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
  now(): number;
  newToken(): string;
  gate: GateState;
  pending: Map<number, Pending>;
  // Per-tab capture counter: a capture that finished its async checks after a
  // newer one from the same tab must not overwrite that newer capture.
  captureSeq: Map<number, number>;
}

const SAVE_TYPES = new Set(['save-capture', 'get-pending-save', 'commit-pending-save', 'dismiss-pending-save', 'never-save-here']);

function isSaveMsg(msg: unknown): msg is SaveMsg {
  return typeof msg === 'object' && msg !== null && SAVE_TYPES.has((msg as { type?: string }).type ?? '');
}
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return url; } }
function err(code: string, message: string): NmhResponse { return { id: 'save', ok: false, error: { code, message } }; }

function livePending(tabId: number, deps: SaveBridgeDeps): Pending | null {
  const p = deps.pending.get(tabId);
  if (!p) return null;
  if (deps.now() - p.ts > PENDING_TTL_MS) { deps.pending.delete(tabId); deps.setBadge(tabId, false); return null; }
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
  recordPrompt(deps.gate, key);
  deps.pending.set(tabId, { token: deps.newToken(), username: msg.username, password: msg.password, url, origin, ts: deps.now() });
  deps.setBadge(tabId, true);
  deps.promptSave(tabId);
  return { ok: true };
}

async function viewPending(tabId: number, deps: SaveBridgeDeps): Promise<PendingView> {
  const p = livePending(tabId, deps);
  if (!p) return { present: false };
  const { resp, items } = await itemsFor(p, deps);
  if (!resp.ok && (resp.error?.code === 'locked' || resp.error?.code === 'app_not_running')) {
    return { present: true, locked: true, username: p.username, site: hostOf(p.url) };
  }
  const decision = classifySave({ username: p.username }, items);
  return { present: true, mode: decision.mode, username: p.username, site: hostOf(p.url) };
}

async function commit(tabId: number, token: string | undefined, deps: SaveBridgeDeps): Promise<NmhResponse> {
  const p = livePending(tabId, deps);
  if (!p) return err('bad_request', 'no pending capture');
  if (token !== undefined && p.token !== token) return err('bad_request', 'superseded capture');
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
  if (!keep) { deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return out;
}

function dismiss(tabId: number, token: string | undefined, deps: SaveBridgeDeps): { ok: boolean } {
  const p = deps.pending.get(tabId);
  if (p && (token === undefined || p.token === token)) { deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return { ok: true };
}

async function never(tabId: number, deps: SaveBridgeDeps): Promise<{ ok: boolean }> {
  const p = deps.pending.get(tabId);
  if (p) { await deps.addSaveIgnore(p.url); deps.pending.delete(tabId); deps.setBadge(tabId, false); }
  return { ok: true };
}

/** The one function chrome.runtime.onMessage delegates the save flow to. Returns
 * null for a non-save message (the caller falls through). Authenticates every
 * message: own extension id + a content-script vs popup sender split so a
 * page frame can never drive the popup-only commit/dismiss/never actions. */
export async function routeSaveMessage(msg: unknown, sender: SaveSenderLike | undefined, deps: SaveBridgeDeps): Promise<unknown> {
  if (!isSaveMsg(msg)) return null;
  if (!sender || sender.id !== deps.ownId) return { ok: false, code: 'denied' };
  if (msg.type === 'save-capture') return handleCapture(msg, sender, deps);
  // Popup-only actions: must come from an extension page (no tab), never a frame.
  if (typeof sender.tab?.id === 'number') return { ok: false, code: 'denied' };
  switch (msg.type) {
    case 'get-pending-save': return viewPending(msg.tabId, deps);
    case 'commit-pending-save': return commit(msg.tabId, msg.token, deps);
    case 'dismiss-pending-save': return dismiss(msg.tabId, msg.token, deps);
    case 'never-save-here': return never(msg.tabId, deps);
  }
}
