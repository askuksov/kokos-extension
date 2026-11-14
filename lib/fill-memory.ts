// Remembers which password values Kokos itself wrote into this page, so a
// submit right after a fill does not offer to save or update the very password
// that just came out of the vault. Holds only valueToken equality hashes (the
// same non-crypto change-detector the save-prompt gate uses), never plaintext,
// and lives only in the content script's isolated world for the page's lifetime.
// Keyed by value rather than by field: SPA re-renders swap the <input> element
// and split logins move the password to a later step, but the value survives both.

import { valueToken } from './save-prompt-gate';

export interface FillMemory {
  /** Record the token of a password Kokos filled from the vault. */
  remember(token: string): void;
  /** True when `password` equals a value Kokos filled on this page. */
  isFromVault(password: string): boolean;
}

export function createFillMemory(max = 8): FillMemory {
  const tokens: string[] = [];
  return {
    remember(token) {
      const i = tokens.indexOf(token);
      if (i !== -1) tokens.splice(i, 1);
      tokens.push(token);
      if (tokens.length > max) tokens.shift();
    },
    isFromVault(password) {
      return password.length > 0 && tokens.includes(valueToken(password));
    },
  };
}
