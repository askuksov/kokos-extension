import { describe, it, expect } from 'vitest';
import { consentAllows, consentState, isFreeAction, type ConsentEnv } from './data-consent';

const env = (over: Partial<ConsentEnv> = {}): ConsentEnv =>
  ({ isFirefox: true, installType: 'admin', managed: undefined, local: undefined, ...over });

describe('consentState', () => {
  it('is not needed on Chrome, even for a policy install', () => {
    expect(consentState(env({ isFirefox: false }))).toBe('not-needed');
  });
  it('is not needed for a normal Firefox install (the browser asked)', () => {
    expect(consentState(env({ installType: 'normal' }))).toBe('not-needed');
    expect(consentState(env({ installType: 'development' }))).toBe('not-needed');
    expect(consentState(env({ installType: undefined }))).toBe('not-needed');
  });
  it('is required for a policy install with nothing set', () => {
    expect(consentState(env())).toBe('required');
  });
  it('takes the administrator grant as true, 1 (macOS profiles) or their strings', () => {
    for (const v of [true, 1, '1', 'true']) expect(consentState(env({ managed: v }))).toBe('managed');
    for (const v of [false, 0, '0', 'false', 'yes', {}, null]) expect(consentState(env({ managed: v }))).toBe('required');
  });
  it('takes the user grant from local storage', () => {
    expect(consentState(env({ local: 'granted' }))).toBe('granted');
    expect(consentState(env({ local: true }))).toBe('required');
  });
  it('prefers the administrator grant over the user one', () => {
    expect(consentState(env({ managed: true, local: 'granted' }))).toBe('managed');
  });
});

describe('consentAllows', () => {
  it('lets only data-free actions through while consent is required', () => {
    for (const a of ['ping', 'get_status', 'generate_password']) {
      expect(isFreeAction(a)).toBe(true);
      expect(consentAllows('required', a)).toBe(true);
    }
    for (const a of ['get_logins', 'get_secret', 'get_totp', 'save_login', 'update_login']) {
      expect(consentAllows('required', a)).toBe(false);
    }
  });
  it('lets everything through once consent is not needed or given', () => {
    for (const s of ['not-needed', 'managed', 'granted'] as const) {
      expect(consentAllows(s, 'get_logins')).toBe(true);
      expect(consentAllows(s, 'save_login')).toBe(true);
    }
  });
});
