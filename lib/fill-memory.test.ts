import { describe, it, expect } from 'vitest';
import { createFillMemory } from './fill-memory';
import { valueToken } from './save-prompt-gate';

describe('createFillMemory', () => {
  it('knows a remembered value and nothing else', () => {
    const m = createFillMemory();
    m.remember(valueToken('pw1'));
    expect(m.isFromVault('pw1')).toBe(true);
    expect(m.isFromVault('pw2')).toBe(false);
  });
  it('starts empty and never matches an empty password', () => {
    const m = createFillMemory();
    expect(m.isFromVault('pw1')).toBe(false);
    m.remember(valueToken(''));
    expect(m.isFromVault('')).toBe(false);
  });
  it('drops the oldest token past the cap', () => {
    const m = createFillMemory(2);
    m.remember(valueToken('a'));
    m.remember(valueToken('b'));
    m.remember(valueToken('c'));
    expect(m.isFromVault('a')).toBe(false);
    expect(m.isFromVault('b')).toBe(true);
    expect(m.isFromVault('c')).toBe(true);
  });
  it('refreshes a re-filled token instead of letting it age out', () => {
    const m = createFillMemory(2);
    m.remember(valueToken('a'));
    m.remember(valueToken('b'));
    m.remember(valueToken('a'));
    m.remember(valueToken('c'));
    expect(m.isFromVault('a')).toBe(true);
    expect(m.isFromVault('b')).toBe(false);
  });
});
