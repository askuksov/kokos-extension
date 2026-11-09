// lib/entry-picker.ts
// Pure popup-picker contract: the case-insensitive filter the popup runs over
// the site's login list, plus the message shapes the popup, background, and
// content script share. Chrome-free and DOM-free so it is unit-testable.

import type { LoginItem } from './nmh-client';

/** Case-insensitive substring match over title + username. Empty/whitespace
 * query returns the list unchanged; input order is preserved (the host already
 * returns exact-host-first). */
export function filterEntries(items: LoginItem[], query: string): LoginItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => (i.title ?? '').toLowerCase().includes(q) || (i.username ?? '').toLowerCase().includes(q),
  );
}

// Popup -> background (site-scoped; the popup supplies only the tab id + entry id;
// the background derives the trusted url from the tab record).
export interface ListSiteLoginsMsg { type: 'list-site-logins'; tabId: number; }
export interface CopySecretMsg { type: 'copy-secret'; tabId: number; entryId: string; }
// Popup -> content script (the frame holding the form, see frame-target.ts). Fill runs in the content script so the
// secret never reaches the popup.
export interface FillEntryMsg { type: 'fill-entry'; entryId: string; username?: string; }

export type PickerListResult = { ok: true; items: LoginItem[] } | { ok: false; code: string };
export type PickerSecretResult = { ok: true; value: string } | { ok: false; code: string };
export type FillEntryResult = { ok: true } | { ok: false; reason: 'no-form' | 'error' };

// Popup -> content script (the frame holding the field): fill the entry's live TOTP code into
// the page's one-time-code field. The code is fetched + used in the content
// script; only { ok, remaining } (metadata) returns to the popup — never the code.
export interface TotpFillMsg { type: 'totp-fill'; entryId: string; }
// Popup -> background: copy the entry's live TOTP code (browser-derived url).
export interface CopyTotpMsg { type: 'copy-totp'; tabId: number; entryId: string; }

export type TotpFillResult = { ok: true; remaining: number } | { ok: false; reason: 'no-field' | 'error' };
// On success `code` is the live TOTP code; on failure `code` is the NMH error code
// (denied/locked/…). Discriminated by `ok` (mirrors PickerSecretResult's shape).
export type CopyTotpResult = { ok: true; code: string; remaining: number } | { ok: false; code: string };

/** Popup shows a Refresh affordance when the just-fetched code is near expiry. */
export function isNearExpiry(remaining: number): boolean {
  return remaining <= 3;
}
