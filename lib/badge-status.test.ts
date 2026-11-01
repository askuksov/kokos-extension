import { describe, it, expect } from 'vitest';
import { resolveBadge, mapErrCode } from './badge-status';

describe('resolveBadge', () => {
  it('not-running → no dot, app-not-running tooltip', () => {
    expect(resolveBadge({ kind: 'not-running' })).toEqual({ dot: null, title: 'Kokos — app not running' });
  });
  it('locked → gray dot', () => {
    expect(resolveBadge({ kind: 'locked' })).toEqual({ dot: '#9aa0a6', title: 'Kokos — locked' });
  });
  it('no-permission → blue dot', () => {
    expect(resolveBadge({ kind: 'no-permission' })).toEqual({ dot: '#4a90d9', title: 'Kokos — click to enable here' });
  });
  it('permitted 0 → amber dot (enabled but empty), "yet" tooltip', () => {
    expect(resolveBadge({ kind: 'permitted', count: 0 })).toEqual({ dot: '#f5a623', title: 'Kokos — no logins for this site yet' });
  });
  it('permitted 1 → green dot, singular tooltip', () => {
    expect(resolveBadge({ kind: 'permitted', count: 1 })).toEqual({ dot: '#2e7d32', title: 'Kokos — 1 login for this site' });
  });
  it('permitted 3 → green dot, plural tooltip', () => {
    expect(resolveBadge({ kind: 'permitted', count: 3 })).toEqual({ dot: '#2e7d32', title: 'Kokos — 3 logins for this site' });
  });
  it('permitted >9 → green dot, exact count in tooltip', () => {
    expect(resolveBadge({ kind: 'permitted', count: 42 })).toEqual({ dot: '#2e7d32', title: 'Kokos — 42 logins for this site' });
  });
  it('null probe (non-http tab) → no dot, default tooltip', () => {
    expect(resolveBadge(null)).toEqual({ dot: null, title: 'Kokos' });
  });
});

describe('mapErrCode', () => {
  it("'locked' → locked probe", () => {
    expect(mapErrCode('locked')).toEqual({ kind: 'locked' });
  });
  it('any other code → not-running', () => {
    expect(mapErrCode('app_not_running')).toEqual({ kind: 'not-running' });
    expect(mapErrCode('internal')).toEqual({ kind: 'not-running' });
    expect(mapErrCode(undefined)).toEqual({ kind: 'not-running' });
  });
});
