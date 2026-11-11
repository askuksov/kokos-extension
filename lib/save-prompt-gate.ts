// Pure session-dedupe policy for the save prompt. State is a plain object the
// background owns; no chrome.*, no storage. The value token is a NON-CRYPTO
// equality hash used ONLY to tell "same password again" from "a changed
// password" without keeping the plaintext in the dedupe record. It is a
// change-detector, not a security control; it lives only in SW memory and is
// never persisted or logged.

export interface GateState {
  seen: Map<string, string>;  // `${origin}\n${username}` -> last surfaced value token
  saved: Map<string, string>; // `${origin}\n${username}` -> value token the user saved
}

export function newGateState(): GateState {
  return { seen: new Map(), saved: new Map() };
}

/** djb2. Equality-only. */
export function valueToken(password: string): string {
  let h = 5381;
  for (let i = 0; i < password.length; i++) h = (((h << 5) + h) + password.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function keyOf(origin: string, username: string): string {
  return `${origin}\n${username}`;
}

/** True when this (origin, username) was not surfaced this session, or was
 * surfaced with a DIFFERENT value token (a changed password re-arms the badge).
 * Pure read — does not mutate state. */
export function shouldBadge(state: GateState, k: { origin: string; username: string; token: string }): boolean {
  return state.seen.get(keyOf(k.origin, k.username)) !== k.token;
}

export function recordPrompt(state: GateState, k: { origin: string; username: string; token: string }): void {
  state.seen.set(keyOf(k.origin, k.username), k.token);
}

/** Remember that this exact value was written to the vault, so a repeat can be
 * re-offered if the entry is later deleted in the app. */
export function recordSaved(state: GateState, k: { origin: string; username: string; token: string }): void {
  state.saved.set(keyOf(k.origin, k.username), k.token);
}

export function wasSaved(state: GateState, k: { origin: string; username: string; token: string }): boolean {
  return state.saved.get(keyOf(k.origin, k.username)) === k.token;
}

export function forgetSaved(state: GateState, k: { origin: string; username: string }): void {
  state.saved.delete(keyOf(k.origin, k.username));
}
