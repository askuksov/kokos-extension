// lib/totp.ts
// SECURITY. The TOTP-code fill core ("Fill code") + the one-time-code
// field finder. The live 2FA code is secret-class: it lives only in a local
// variable, is written to the page's one-time-code field, and is cleared in a
// finally — never stored, logged, or returned to the popup (only { status,
// remaining } leaves this module). Mirrors fill.ts fillFromMatch (generation +
// liveness guard) so a slow confirm/decrypt never fills a superseded/detached field.

import type { NmhResponse, GetTotpResult } from './nmh-client';
import { classifyField } from './detection';
import { setNativeValue } from './fill';

// detection.ts's classifyField only recognises one-time-code via the
// autocomplete=one-time-code token (its behavior is deliberately left
// unchanged). Sites that omit autocomplete but hint via name/id (otp/totp/
// 2fa/one-time) are covered here as a local fallback, kept in this module so
// classifyField's existing classification stays byte-for-byte unchanged.
const OTP_HINT_RE = /(otp|totp|2fa|one[\s_-]?time)/;

/** First one-time-code field on the page: autocomplete=one-time-code (via
 * classifyField), or a name/id hinting otp|totp|2fa|one-time. Returns null when
 * none is present. */
export function findOtpField(root: ParentNode): HTMLInputElement | null {
  for (const el of Array.from(root.querySelectorAll('input'))) {
    const input = el as HTMLInputElement;
    if (classifyField(input) === 'one-time-code') return input;
    if (OTP_HINT_RE.test(`${input.name} ${input.id}`.toLowerCase())) return input;
  }
  return null;
}

export interface TotpFillDeps {
  request: (action: string, payload: object) => Promise<NmhResponse>;
  url: string;
  entryId: string;
  otpField: HTMLInputElement | null;
  gen: number;                 // generation token snapshotted at trigger time
  currentGen: () => number;    // live generation counter
  isConnected: (el: Element | null) => boolean;
}

export type TotpFillOutcome =
  | { status: 'filled'; remaining: number }
  | { status: 'no-field' }
  | { status: 'discarded' }
  | { status: 'error' };

/** Fetch the live code (confirm-gated), then fill the one-time-code field iff the
 * generation + liveness guard still holds. The code never leaves as a return
 * value — only `remaining` (metadata) surfaces so the popup can show validity. */
export async function fillTotp(deps: TotpFillDeps): Promise<TotpFillOutcome> {
  const otpField = deps.otpField;
  if (!otpField) return { status: 'no-field' };
  let code = '';
  try {
    const resp = await deps.request('get_totp', { entry_id: deps.entryId, url: deps.url });
    if (!resp.ok || !resp.payload) return { status: 'error' };
    code = (resp.payload as GetTotpResult).code;
    const remaining = (resp.payload as GetTotpResult).remaining;
    if (deps.gen !== deps.currentGen()) return { status: 'discarded' };
    if (!deps.isConnected(otpField)) return { status: 'discarded' };
    setNativeValue(otpField, code);
    return { status: 'filled', remaining };
  } finally {
    code = ''; // clear the transient code regardless of path
    void code;
  }
}
