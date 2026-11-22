// lib/totp.ts
// SECURITY. The TOTP-code fill core ("Fill code") + the one-time-code
// field finder. The live 2FA code is secret-class: it lives only in a local
// variable, is written to the page's one-time-code field, and is cleared in a
// finally — never stored, logged, or returned to the popup (only { status,
// remaining } leaves this module). Mirrors fill.ts fillFromMatch (generation +
// liveness guard) so a slow confirm/decrypt never fills a superseded/detached field.

import type { NmhResponse, GetTotpResult } from './nmh-client';
import { classifyField, isUsableField } from './detection';
import { setNativeValue } from './fill';

// detection.ts's classifyField only recognises one-time-code via the
// autocomplete=one-time-code token (its behavior is deliberately left
// unchanged). Sites that omit autocomplete but hint via name/id (otp/totp/
// 2fa/one-time) are covered here as a local fallback, kept in this module so
// classifyField's existing classification stays byte-for-byte unchanged.
// Boundaries on separators so e.g. "footprint" does not read as "otp".
const OTP_HINT_RE = /(^|[\s_\-.[\]])(otp|totp|2fa|one[\s_-]?time)($|[\s_\-.[\]])/;

// "One digit per box" 2FA forms: a run of this many adjacent maxlength=1 inputs.
const BOX_MIN = 4;
const BOX_MAX = 8;
const BOX_TYPES = new Set(['', 'text', 'tel', 'number', 'password']);

function usableInputs(root: ParentNode): HTMLInputElement[] {
  return (Array.from(root.querySelectorAll('input')) as HTMLInputElement[]).filter(isUsableField);
}

function isBox(input: HTMLInputElement): boolean {
  return input.maxLength === 1 && BOX_TYPES.has(input.type);
}

/** The run of adjacent single-character boxes (same form, no other usable input
 * in between) around list[idx]; empty when list[idx] is not a box. */
function boxRunAt(list: HTMLInputElement[], idx: number): HTMLInputElement[] {
  const at = list[idx];
  if (!at || !isBox(at)) return [];
  const joins = (j: number): boolean => {
    const el = list[j];
    return !!el && isBox(el) && el.form === at.form;
  };
  let from = idx;
  let to = idx;
  while (joins(from - 1)) from--;
  while (joins(to + 1)) to++;
  return list.slice(from, to + 1);
}

/** The box group `field` belongs to, in document order; [] when it is not part
 * of a BOX_MIN..BOX_MAX run of single-character inputs. */
export function findOtpBoxes(field: HTMLInputElement): HTMLInputElement[] {
  const list = usableInputs(field.ownerDocument);
  const idx = list.indexOf(field);
  if (idx < 0) return [];
  const run = boxRunAt(list, idx);
  return run.length >= BOX_MIN && run.length <= BOX_MAX ? run : [];
}

/** First one-time-code field on the page: autocomplete=one-time-code (via
 * classifyField) first, then a name/id hinting otp|totp|2fa|one-time, then the
 * first box of a one-digit-per-box group. Hidden and disabled inputs are
 * skipped. Returns null when none is present. */
export function findOtpField(root: ParentNode): HTMLInputElement | null {
  const inputs = usableInputs(root);
  for (const input of inputs) {
    if (classifyField(input) === 'one-time-code') return input;
  }
  for (const input of inputs) {
    if (OTP_HINT_RE.test(`${input.name} ${input.id}`.toLowerCase())) return input;
  }
  for (let i = 0; i < inputs.length; i++) {
    const run = boxRunAt(inputs, i);
    const head = run[0];
    if (head && run.length >= BOX_MIN && run.length <= BOX_MAX) return head;
    i += Math.max(run.length - 1, 0);
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
    const p = resp.payload as Partial<GetTotpResult>;
    if (typeof p.code !== 'string' || p.code === '') return { status: 'error' };
    if (typeof p.remaining !== 'number' || !Number.isFinite(p.remaining)) return { status: 'error' };
    code = p.code;
    const remaining = p.remaining;
    if (deps.gen !== deps.currentGen()) return { status: 'discarded' };
    if (!deps.isConnected(otpField)) return { status: 'discarded' };
    if (isBox(otpField)) {
      // One digit per box: only when the group size matches the code length.
      const boxes = findOtpBoxes(otpField);
      if (boxes.length !== code.length) return { status: 'error' };
      boxes.forEach((box, i) => setNativeValue(box, code[i] ?? ''));
    } else {
      setNativeValue(otpField, code);
    }
    return { status: 'filled', remaining };
  } finally {
    code = ''; // clear the transient code regardless of path
    void code;
  }
}
