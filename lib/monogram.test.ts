import { describe, it, expect } from 'vitest';
import { monogram } from './monogram';

describe('monogram', () => {
  it('uses the upper-cased first letter', () => {
    expect(monogram('harbor bank').letter).toBe('H');
  });
  it('keeps an emoji first character whole', () => {
    expect(monogram('🏦 Bank').letter).toBe('🏦');
  });
  it('falls back to ? for an empty or blank title', () => {
    expect(monogram('').letter).toBe('?');
    expect(monogram('   ').letter).toBe('?');
  });
  it('gives the same title the same colour', () => {
    expect(monogram('Fastmail').bg).toBe(monogram('Fastmail').bg);
  });
});
