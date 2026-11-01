// The secret-fill core, factored pure so the secret boundary is unit- and
// mutation-testable. The fetched secret lives only in a local variable, is
// written to the intended field, and is cleared in a finally — never stored,
// logged, or retained. Fill is all-or-nothing: username + password land
// together only after get_secret succeeds and the generation guard passes.

import type { NmhResponse, GetSecretResult } from './nmh-client';
import type { OverlayMatch } from './overlay';

export function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// One definition for every consumer (content.ts's receiver included) — the
// 'denied' case was added later and a second, hand-copied union would
// have gone stale the moment it was.
export type FillOutcome = 'filled' | 'discarded' | 'error' | 'denied';

export interface FillDeps {
  request: (action: string, payload: object) => Promise<NmhResponse>;
  url: string;
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement | null;
  gen: number;                 // generation token snapshotted at pick time
  currentGen: () => number;    // live generation counter
  isConnected: (el: Element | null) => boolean;
  // Called once, immediately before the get_secret round-trip that may park on
  // the app's native confirm prompt. The caller uses it to say so
  // on the page; nothing here depends on it, so it stays optional and the pure
  // fill path is unchanged when it is absent.
  onAwaitingApproval?: () => void;
}

export async function fillFromMatch(
  deps: FillDeps,
  match: OverlayMatch,
): Promise<FillOutcome> {
  // Split-login username step: no password field to receive a secret, so NEVER
  // fetch/transmit the secret — fill only the (non-secret) username. Avoids a
  // needless confirm+decrypt and a double prompt on username-then-password flows.
  if (!deps.passwordField) {
    if (deps.usernameField && deps.isConnected(deps.usernameField) && match.username) {
      setNativeValue(deps.usernameField, match.username);
      return 'filled';
    }
    return 'discarded';
  }
  let secret = '';
  try {
    deps.onAwaitingApproval?.();
    const resp = await deps.request('get_secret', { entry_id: match.id, url: deps.url });
    // `denied` is separated from every other failure because it is the only one
    // the user caused and the only one they can retry — the page says so.
    if (!resp.ok && resp.error?.code === 'denied') return 'denied';
    if (!resp.ok || !resp.payload) return 'error';
    secret = (resp.payload as GetSecretResult).value;
    // Generation + liveness guard — a slow decrypt must never fill a superseded
    // or detached field (mirrors the app's reveal race-guard).
    if (deps.gen !== deps.currentGen()) return 'discarded';
    if (deps.passwordField && !deps.isConnected(deps.passwordField)) return 'discarded';
    if (deps.usernameField && !deps.isConnected(deps.usernameField)) return 'discarded';
    if (deps.passwordField) setNativeValue(deps.passwordField, secret);
    if (deps.usernameField && match.username) setNativeValue(deps.usernameField, match.username);
    return 'filled';
  } finally {
    secret = ''; // clear the transient secret regardless of path
    void secret;
  }
}
