// lib/entry-picker.test.ts
import { describe, it, expect } from 'vitest';
import { filterEntries, isNearExpiry } from './entry-picker';
import type { LoginItem } from './nmh-client';

const items: LoginItem[] = [
  { id: '1', title: 'GitHub', username: 'alice' },
  { id: '2', title: 'GitLab', username: 'bob@corp' },
  { id: '3', title: 'Bank', username: null },
];

describe('filterEntries', () => {
  it('returns all for an empty or whitespace query', () => {
    expect(filterEntries(items, '')).toHaveLength(3);
    expect(filterEntries(items, '   ')).toHaveLength(3);
  });
  it('matches title case-insensitively', () => {
    expect(filterEntries(items, 'git').map((i) => i.id)).toEqual(['1', '2']);
  });
  it('matches username', () => {
    expect(filterEntries(items, 'bob').map((i) => i.id)).toEqual(['2']);
  });
  it('returns empty when nothing matches', () => {
    expect(filterEntries(items, 'zzz')).toEqual([]);
  });
  it('preserves input order (host returns exact-host-first)', () => {
    expect(filterEntries(items, 'a').map((i) => i.id)).toEqual(['1', '2', '3'].filter((id) =>
      items.find((i) => i.id === id && ((i.title ?? '').toLowerCase().includes('a') || (i.username ?? '').toLowerCase().includes('a')))));
  });
  it('tolerates a null username without throwing', () => {
    expect(() => filterEntries(items, 'bank')).not.toThrow();
    expect(filterEntries(items, 'bank').map((i) => i.id)).toEqual(['3']);
  });
});

describe('isNearExpiry', () => {
  it('is true at or below 3 seconds', () => {
    expect(isNearExpiry(3)).toBe(true);
    expect(isNearExpiry(2)).toBe(true);
    expect(isNearExpiry(0)).toBe(true);
  });
  it('is false above 3 seconds', () => {
    expect(isNearExpiry(4)).toBe(false);
    expect(isNearExpiry(29)).toBe(false);
  });
});
