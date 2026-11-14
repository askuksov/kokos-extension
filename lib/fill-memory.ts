// Remembers which password values Kokos itself wrote into this page, so a
// submit right after a fill does not offer to save or update the very password
// that just came out of the vault. Holds only fillToken equality hashes, never
// plaintext, and lives only in the content script's isolated world for the
// page's lifetime.
// Keyed by value rather than by field: SPA re-renders swap the <input> element
// and split logins move the password to a later step, but the value survives both.

/** cyrb53: a 53-bit non-crypto equality hash. Not the save-prompt gate's
 * 32-bit djb2: djb2 is linear, so a small edit (+1 on one char, -33 on the next)
 * keeps the token, and an edited password would be mistaken for the filled
 * one and silently skipped. Synchronous on purpose (Web Crypto is async), so
 * the fill path can record the token before it writes the field. */
export function fillToken(password: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

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
      return password.length > 0 && tokens.includes(fillToken(password));
    },
  };
}
