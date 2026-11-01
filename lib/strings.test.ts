import { describe, it, expect } from 'vitest';
import { STRINGS, t } from './strings';

describe('t', () => {
  it('returns the catalog value for a key', () => {
    expect(t('save')).toBe('Save');
  });
  it('substitutes positional params', () => {
    expect(t('validFor', 'Code filled', '12')).toBe('Code filled · valid 12s');
  });
  it('every catalog value is a non-empty string', () => {
    for (const [k, v] of Object.entries(STRINGS)) {
      expect(typeof v, k).toBe('string');
      expect(v.length, k).toBeGreaterThan(0);
    }
  });
});
