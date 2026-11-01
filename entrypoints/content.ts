// Runtime-registered (registered per-site from the popup grant, never a static
// content_scripts match). Orchestrates detect -> get_logins -> overlay ->
// get_secret -> fill. Runs only in a frame same-origin with the top page.

import { detectLoginForms, sameOriginAsTop, watch, type LoginForm } from '../lib/detection';
import { createOverlay, type OverlayMatch } from '../lib/overlay';
import { fillFromMatch, type FillOutcome } from '../lib/fill';
import type { NmhResponse, GetLoginsResult } from '../lib/nmh-client';
import { snapshotCredentials, isSubmitControl, type Captured } from '../lib/save-capture';
import { findOtpField, fillTotp, type TotpFillOutcome } from '../lib/totp';
import { detectPasswordFields, fillGenerated, type PasswordFields } from '../lib/generator';
import type { FillEntryMsg, FillEntryResult, TotpFillMsg, TotpFillResult } from '../lib/entry-picker';
import { t } from '../lib/strings';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (!sameOriginAsTop(window)) return; // never operate a cross-origin subframe
    runContentScript();
    wireSaveCapture(document, (cred) => {
      try {
        chrome.runtime.sendMessage({ type: 'save-capture', username: cred.username, password: cred.password });
      } catch { /* SW asleep / no receiver: dropped; the user can resubmit */ }
    });
  },
});

function request(action: string, payload: object): Promise<NmhResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'nmh-request', origin: location.origin, action, payload }, (resp: NmhResponse) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({ id: 'x', ok: false, error: { code: 'app_not_running', message: 'background unavailable' } });
      } else {
        resolve(resp);
      }
    });
  });
}

function runContentScript() {
  const overlay = createOverlay(document);
  let gen = 0;
  const url = () => location.href;

  const target = (f: LoginForm): HTMLInputElement | null => f.password ?? f.username;

  async function offer(field: HTMLInputElement, form: LoginForm) {
    gen += 1; // any fresh offer supersedes an in-flight fill
    const resp = await request('get_logins', { url: url() });
    if (!resp.ok || !resp.payload) return; // fail closed (locked/app_not_running/etc.)
    const items = (resp.payload as GetLoginsResult).items ?? [];
    if (items.length === 0) return; // no match: silent, no overlay
    const matches: OverlayMatch[] = items.map((i) => ({ id: i.id, title: i.title, username: i.username, hasTotp: i.hasTotp }));
    overlay.showMatches(field, matches, (m) => onPick(m, form));
  }

  async function fillEntry(match: OverlayMatch, form: LoginForm): Promise<FillOutcome> {
    gen += 1;              // supersede any in-flight pick + any earlier offer
    const snapshot = gen;
    overlay.hide();        // close the list synchronously so a 2nd pick can't race
    // The toast anchors on whichever field survives; the password field is the
    // one the secret is headed for, so prefer it.
    const anchor = form.password ?? form.username;
    return fillFromMatch(
      {
        request,
        url: url(),
        usernameField: form.username,
        passwordField: form.password,
        gen: snapshot,
        currentGen: () => gen,
        isConnected: (el) => !!el && el.isConnected,
        // Sticky (ms = 0): the app's prompt parks for up to 60s, and a
        // full-screen browser hides the Kokos window entirely — without this
        // the user sees nothing at all while the modal waits.
        onAwaitingApproval: () => { if (anchor) overlay.showToast(anchor, t('awaitingApproval'), 0); },
      },
      match,
    );
  }

  async function onPick(match: OverlayMatch, form: LoginForm) {
    const outcome = await fillEntry(match, form);
    // A superseded pick (`discarded`) belongs to an older generation — its
    // toast would talk about a request the user has already replaced.
    if (outcome === 'discarded') return;
    const anchor = form.password ?? form.username;
    if (!anchor) return;
    if (outcome === 'denied') overlay.showToast(anchor, t('requestDenied'));
    else overlay.hideToast();
  }

  function scan() {
    // Login offer (unchanged behavior, no early return so the generator scan runs too).
    const forms = detectLoginForms(document);
    if (forms.length === 0) {
      overlay.hide();
    } else {
      const form = forms[0]!;
      const field = target(form);
      if (field) overlay.showIcon(field, () => void offer(field, form));
    }
    // Generator affordance (independent — both icons may show on a change-password page).
    const pwFields = detectPasswordFields(document);
    if (pwFields.length === 0) overlay.hideGenerator();
    else overlay.showGeneratorIcon(pwFields[0]!.primary, () => void onGenerate(pwFields[0]!));
  }

  async function onGenerate(fields: PasswordFields) {
    gen += 1; // supersede any in-flight fill
    const snapshot = gen;
    const outcome = await fillGenerated({
      request,
      fields,
      gen: snapshot,
      currentGen: () => gen,
      isConnected: (el) => !!el && el.isConnected,
    });
    if (outcome.status === 'filled') overlay.showToast(fields.primary, t('genFilled', outcome.value));
  }

  scan();
  // A DOM mutation re-scans (reposition icon / detect new forms) but must NOT
  // invalidate an in-flight, user-confirmed fill — supersession is tracked by
  // offer/onPick bumping `gen`, and a replaced field is caught by isConnected
  // (target-field identity + a counter, not a raw mutation counter).
  watch(document.documentElement, () => { scan(); });

  // Popup-driven manual fill: the popup asks THIS frame to fill a chosen
  // entry. The secret is fetched + used here (never in the popup). Only the top
  // frame is targeted (popup sends { frameId: 0 }).
  wireFillReceiver({
    ownId: chrome.runtime.id,
    detect: detectLoginForms,
    fill: fillEntry,
    doc: document,
    addListener: (cb) => chrome.runtime.onMessage.addListener(cb as any),
  });

  // Popup-driven TOTP fill: the popup asks THIS frame to fill a chosen entry's
  // live 2FA code. The code is fetched + used here (never in the popup); only
  // { ok, remaining } surfaces back.
  wireTotpReceiver({
    ownId: chrome.runtime.id,
    findOtp: findOtpField,
    fill: (otpField, entryId) => {
      gen += 1;                 // a fresh TOTP fill supersedes any in-flight login fill
      const snapshot = gen;
      return fillTotp({
        request,
        url: url(),
        entryId,
        otpField,
        gen: snapshot,
        currentGen: () => gen,
        isConnected: (el) => !!el && el.isConnected,
      });
    },
    doc: document,
    addListener: (cb) => chrome.runtime.onMessage.addListener(cb as any),
  });
}

// Save capture: read credential values ONCE at the submit gesture and hand
// them to the background (fire-and-forget, so the message survives a classic
// form submit's navigation). No keystroke observation; the content script
// retains nothing. `send` is injected so this is unit-testable without chrome.
export function wireSaveCapture(doc: Document, send: (cred: Captured) => void): void {
  const captureFrom = (form: LoginForm | null | undefined) => {
    if (!form) return;
    const cred = snapshotCredentials(form);
    if (cred) send(cred);
  };
  doc.addEventListener('submit', (e) => {
    const t = e.target;
    const forms = detectLoginForms(t instanceof HTMLFormElement ? t : doc);
    captureFrom(forms[0]);
  }, true);
  doc.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !isSubmitControl(el)) return;
    // Formless SPA path: the `submit` event never fires, so a login-button click
    // is the gesture. Only a formless detected login form (no <form> ancestor)
    // is eligible — form-based logins are already covered by the submit listener.
    const forms = detectLoginForms(doc);
    captureFrom(forms.find((f) => f.password !== null && f.password.form === null));
  }, true);
}

// Popup-driven fill. Factored (deps injected) so the sender.id trust guard and
// the detect->fill routing are unit-testable without chrome. The
// secret is fetched and cleared entirely inside `fill` (fillFromMatch); the popup
// only learns ok / no-form / error.
export interface FillReceiverDeps {
  ownId: string;
  detect: (doc: Document) => LoginForm[];
  fill: (match: OverlayMatch, form: LoginForm) => Promise<FillOutcome>;
  doc: Document;
  addListener: (
    cb: (msg: unknown, sender: { id?: string }, sendResponse: (r: FillEntryResult) => void) => boolean | void,
  ) => void;
}

export function isFillEntryMsg(msg: unknown): msg is FillEntryMsg {
  return typeof msg === 'object' && msg !== null
    && (msg as { type?: string }).type === 'fill-entry'
    && typeof (msg as { entryId?: unknown }).entryId === 'string';
}

export async function handleFillEntry(
  msg: FillEntryMsg,
  detect: (doc: Document) => LoginForm[],
  fill: (match: OverlayMatch, form: LoginForm) => Promise<FillOutcome>,
  doc: Document,
): Promise<FillEntryResult> {
  const forms = detect(doc);
  if (forms.length === 0) return { ok: false, reason: 'no-form' };
  const result = await fill({ id: msg.entryId, username: msg.username ?? undefined }, forms[0]!);
  return result === 'filled' ? { ok: true } : { ok: false, reason: 'error' };
}

export function wireFillReceiver(deps: FillReceiverDeps): void {
  deps.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== deps.ownId) return;   // own extension id only: ignore untrusted senders
    if (!isFillEntryMsg(msg)) return;                  // not ours: let other listeners handle it
    handleFillEntry(msg, deps.detect, deps.fill, deps.doc).then(
      sendResponse,
      () => sendResponse({ ok: false, reason: 'error' }),
    );
    return true; // async sendResponse
  });
}

// Popup-driven TOTP fill. Factored (deps injected) so the sender.id trust guard
// and the find->fill routing are unit-testable without chrome. The
// code is fetched + cleared entirely inside `fill` (fillTotp); the popup only learns
// ok / no-field / error + the metadata `remaining`, never the code.
export interface TotpReceiverDeps {
  ownId: string;
  findOtp: (doc: Document) => HTMLInputElement | null;
  fill: (otpField: HTMLInputElement | null, entryId: string) => Promise<TotpFillOutcome>;
  doc: Document;
  addListener: (
    cb: (msg: unknown, sender: { id?: string }, sendResponse: (r: TotpFillResult) => void) => boolean | void,
  ) => void;
}

export function isTotpFillMsg(msg: unknown): msg is TotpFillMsg {
  return typeof msg === 'object' && msg !== null
    && (msg as { type?: string }).type === 'totp-fill'
    && typeof (msg as { entryId?: unknown }).entryId === 'string';
}

export async function handleTotpFill(
  msg: TotpFillMsg,
  findOtp: (doc: Document) => HTMLInputElement | null,
  fill: (otpField: HTMLInputElement | null, entryId: string) => Promise<TotpFillOutcome>,
  doc: Document,
): Promise<TotpFillResult> {
  const otpField = findOtp(doc);
  const outcome = await fill(otpField, msg.entryId);
  if (outcome.status === 'filled') return { ok: true, remaining: outcome.remaining };
  if (outcome.status === 'no-field') return { ok: false, reason: 'no-field' };
  return { ok: false, reason: 'error' };
}

export function wireTotpReceiver(deps: TotpReceiverDeps): void {
  deps.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== deps.ownId) return;   // own extension id only: ignore untrusted senders
    if (!isTotpFillMsg(msg)) return;                   // not ours: let other listeners handle it
    handleTotpFill(msg, deps.findOtp, deps.fill, deps.doc).then(
      sendResponse,
      () => sendResponse({ ok: false, reason: 'error' }),
    );
    return true; // async sendResponse
  });
}
