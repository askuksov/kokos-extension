import { describe, it, expect } from 'vitest';
import { createFillMemory, fillToken } from './fill-memory';

describe('createFillMemory', () => {
  it('knows a remembered value and nothing else', () => {
    const m = createFillMemory();
    m.remember(fillToken('pw1'));
    expect(m.isFromVault('pw1')).toBe(true);
    expect(m.isFromVault('pw2')).toBe(false);
  });
  it('starts empty and never matches an empty password', () => {
    const m = createFillMemory();
    expect(m.isFromVault('pw1')).toBe(false);
    m.remember(fillToken(''));
    expect(m.isFromVault('')).toBe(false);
  });
  it('tells apart a small edit that collides under the 32-bit gate hash', () => {
    // 'secretAa1!' and 'secretB@1!' share a djb2 valueToken.
    const m = createFillMemory();
    m.remember(fillToken('secretAa1!'));
    expect(m.isFromVault('secretB@1!')).toBe(false);
  });
  it('drops the oldest token past the cap', () => {
    const m = createFillMemory(2);
    m.remember(fillToken('a'));
    m.remember(fillToken('b'));
    m.remember(fillToken('c'));
    expect(m.isFromVault('a')).toBe(false);
    expect(m.isFromVault('b')).toBe(true);
    expect(m.isFromVault('c')).toBe(true);
  });
  it('refreshes a re-filled token instead of letting it age out', () => {
    const m = createFillMemory(2);
    m.remember(fillToken('a'));
    m.remember(fillToken('b'));
    m.remember(fillToken('a'));
    m.remember(fillToken('c'));
    expect(m.isFromVault('a')).toBe(true);
    expect(m.isFromVault('b')).toBe(false);
  });
});
