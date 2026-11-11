import { describe, it, expect } from 'vitest';
import { newGateState, valueToken, shouldBadge, recordPrompt, recordSaved, wasSaved, forgetSaved } from './save-prompt-gate';

describe('save-prompt-gate', () => {
  const k = (token: string) => ({ origin: 'https://a.com', username: 'alice', token });
  it('badges a never-seen (origin,username)', () => {
    expect(shouldBadge(newGateState(), k(valueToken('pw1')))).toBe(true);
  });
  it('suppresses a repeat of the same value', () => {
    const s = newGateState();
    const key = k(valueToken('pw1'));
    recordPrompt(s, key);
    expect(shouldBadge(s, key)).toBe(false);
  });
  it('re-arms when the password value changed', () => {
    const s = newGateState();
    recordPrompt(s, k(valueToken('pw1')));
    expect(shouldBadge(s, k(valueToken('pw2')))).toBe(true);
  });
  it('valueToken is stable and distinguishes different values', () => {
    expect(valueToken('pw1')).toBe(valueToken('pw1'));
    expect(valueToken('pw1')).not.toBe(valueToken('pw2'));
  });
});

describe('save-prompt-gate — saved values', () => {
  const k = { origin: 'https://a.com', username: 'alice', token: valueToken('pw') };
  it('remembers a saved value and forgets it on request', () => {
    const s = newGateState();
    expect(wasSaved(s, k)).toBe(false);
    recordSaved(s, k);
    expect(wasSaved(s, k)).toBe(true);
    expect(wasSaved(s, { ...k, token: valueToken('other') })).toBe(false);
    forgetSaved(s, k);
    expect(wasSaved(s, k)).toBe(false);
  });
});
