// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { findOtpField, fillTotp } from './totp';
import type { NmhResponse } from './nmh-client';

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

const okTotp = (code: string, remaining: number): NmhResponse =>
  ({ id: 'r', ok: true, payload: { code, period: 30, remaining } });

describe('findOtpField', () => {
  it('finds an autocomplete=one-time-code field', () => {
    document.body.innerHTML = '';
    input({ type: 'text', autocomplete: 'one-time-code' });
    expect(findOtpField(document)).not.toBeNull();
  });
  it('finds a name=otp field', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'otp' });
    expect(findOtpField(document)).not.toBeNull();
  });
  it('returns null when there is no one-time-code field', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'search' });
    expect(findOtpField(document)).toBeNull();
  });
});

describe('fillTotp', () => {
  const live = { currentGen: () => 1, isConnected: (el: Element | null) => !!el && el.isConnected };

  it('fills the field and returns remaining (never the code)', async () => {
    document.body.innerHTML = '';
    const otp = input({ type: 'text', autocomplete: 'one-time-code' });
    const out = await fillTotp({ request: async () => okTotp('123456', 24), url: 'https://s', entryId: 'e', otpField: otp, gen: 1, ...live });
    expect(out).toEqual({ status: 'filled', remaining: 24 });
    expect(otp.value).toBe('123456');
    expect(JSON.stringify(out)).not.toContain('123456'); // code never leaks in the outcome
  });

  it('returns no-field when there is no otp field', async () => {
    const out = await fillTotp({ request: async () => okTotp('1', 24), url: 'https://s', entryId: 'e', otpField: null, gen: 1, ...live });
    expect(out).toEqual({ status: 'no-field' });
  });

  it('discards when the generation moved during the fetch (superseded)', async () => {
    document.body.innerHTML = '';
    const otp = input({ type: 'text', autocomplete: 'one-time-code' });
    const out = await fillTotp({ request: async () => okTotp('999', 24), url: 'https://s', entryId: 'e', otpField: otp, gen: 1, currentGen: () => 2, isConnected: live.isConnected });
    expect(out).toEqual({ status: 'discarded' });
    expect(otp.value).toBe('');
  });

  it('discards when the field detached during the fetch', async () => {
    document.body.innerHTML = '';
    const otp = input({ type: 'text', autocomplete: 'one-time-code' });
    const out = await fillTotp({ request: async () => { otp.remove(); return okTotp('999', 24); }, url: 'https://s', entryId: 'e', otpField: otp, gen: 1, ...live });
    expect(out).toEqual({ status: 'discarded' });
  });

  it('returns error when get_totp fails', async () => {
    document.body.innerHTML = '';
    const otp = input({ type: 'text', autocomplete: 'one-time-code' });
    const out = await fillTotp({ request: async () => ({ id: 'r', ok: false, error: { code: 'denied', message: 'x' } }), url: 'https://s', entryId: 'e', otpField: otp, gen: 1, ...live });
    expect(out).toEqual({ status: 'error' });
  });
});
