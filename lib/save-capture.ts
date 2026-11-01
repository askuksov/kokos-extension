// Pure save-capture logic: read a detected form's field values once, classify
// Save vs Update from login METADATA only, length-bound fields, and recognise a
// formless submit control. No chrome.*, no DOM writes, no secret retention here.
// classifySave never needs the stored secret — a metadata username match is all
// it decides on (fetching the secret to compare would add a confirm + violate
// secret-minimisation).

import type { LoginForm } from './detection';
import type { LoginItem } from './nmh-client';

export interface Captured {
  username: string;
  password: string;
}

/** Read the username + password VALUES once, at the submit gesture. Returns null
 * unless a connected password field holds a non-empty value (mirrors the host's
 * non-empty-password requirement and skips empty submits). Values only — never
 * keystrokes. */
export function snapshotCredentials(form: LoginForm): Captured | null {
  const pw = form.password;
  if (!pw || !pw.isConnected) return null;
  const password = pw.value;
  if (password.length === 0) return null;
  const username = form.username?.isConnected ? form.username.value : '';
  return { username, password };
}

export type SaveDecision = { mode: 'save' } | { mode: 'update'; entryId: string };

/** Save vs Update from metadata alone. 0 username matches -> save; exactly 1 ->
 * update that entry; >=2 -> save (ambiguous: a new entry is recoverable, blindly
 * overwriting the wrong one is not). Case-insensitive + trimmed compare. */
export function classifySave(captured: { username: string }, items: LoginItem[]): SaveDecision {
  const key = captured.username.trim().toLowerCase();
  const matches = items.filter((i) => (i.username ?? '').trim().toLowerCase() === key);
  if (matches.length === 1) return { mode: 'update', entryId: matches[0]!.id };
  return { mode: 'save' };
}

/** Length-bound a field on a char boundary before it leaves the extension.
 * The spread iterator counts whole code points, so a multi-byte
 * char is never split (a naive slice would). Never applied to a password. */
export function clampSaveField(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

function looksLikeLogin(s: string): boolean {
  return /log\s?in|sign\s?in|continue|submit|войти|вход/i.test(s);
}

/** Whether a clicked element is a plausible login submit control, for FORMLESS
 * SPA capture where no `submit` event fires. Heuristic only — the caller further
 * gates on a formless detected form with a non-empty password, so a false
 * positive here still cannot capture an empty or non-login form. A bare submit
 * button is accepted; a type=button / role=button only when its label reads like
 * a login action (keeps "Menu"/"Cancel" buttons from triggering capture). */
export function isSubmitControl(el: Element): boolean {
  const node = el.closest('button, input[type=submit], input[type=button], [role=button]');
  if (!node) return false;
  if (node instanceof HTMLButtonElement) {
    const type = (node.getAttribute('type') ?? 'submit').toLowerCase();
    return type !== 'button' || looksLikeLogin(node.textContent ?? '');
  }
  if (node instanceof HTMLInputElement) {
    return node.type === 'submit' || (node.type === 'button' && looksLikeLogin(node.value));
  }
  return looksLikeLogin(node.textContent ?? '');
}
