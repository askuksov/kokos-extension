// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { findOtpField, findOtpBoxes, fillTotp } from './totp';
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
  it('prefers a later autocomplete=one-time-code field over an earlier weak name match', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'otp_hint' });
    const strong = input({ type: 'text', autocomplete: 'one-time-code' });
    expect(findOtpField(document)).toBe(strong);
  });
  it('skips hidden and disabled inputs', () => {
    document.body.innerHTML = '';
    input({ type: 'hidden', name: 'otp_token' });
    input({ type: 'text', name: 'totp', disabled: '' });
    input({ type: 'text', name: 'otp', style: 'display:none' });
    const visible = input({ type: 'text', name: 'code', autocomplete: 'one-time-code' });
    expect(findOtpField(document)).toBe(visible);
  });
  it('returns null when only hidden or disabled hint matches exist', () => {
    document.body.innerHTML = '';
    input({ type: 'hidden', name: 'otp_token' });
    input({ type: 'text', id: 'totp', disabled: '' });
    expect(findOtpField(document)).toBeNull();
  });
  it('does not treat a substring as an otp hint (footprint, hotpot)', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'footprint' });
    input({ type: 'text', id: 'hotpot' });
    expect(findOtpField(document)).toBeNull();
  });
  it('matches hints delimited by _ - or whitespace', () => {
    for (const name of ['totp_code', 'login-otp', 'one-time-code', 'one_time_pass', 'user[otp]', '2fa']) {
      document.body.innerHTML = '';
      const el = input({ type: 'text', name });
      expect(findOtpField(document), name).toBe(el);
    }
  });
  it('returns null when there is no one-time-code field', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'search' });
    expect(findOtpField(document)).toBeNull();
  });
});

function boxes(n: number, parent: HTMLElement = document.body, extra: Record<string, string> = {}): HTMLInputElement[] {
  return Array.from({ length: n }, () => {
    const el = document.createElement('input');
    el.setAttribute('type', 'text');
    el.setAttribute('maxlength', '1');
    for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
    const wrap = document.createElement('div'); // boxes are often individually wrapped
    wrap.appendChild(el);
    parent.appendChild(wrap);
    return el;
  });
}

describe('one digit per box', () => {
  const live = { currentGen: () => 1, isConnected: (el: Element | null) => !!el && el.isConnected };
  const run = (field: HTMLInputElement | null, code: string) =>
    fillTotp({ request: async () => okTotp(code, 20), url: 'https://s', entryId: 'e', otpField: field, gen: 1, ...live });

  it('finds the first box of a 6-box group without any hint', () => {
    document.body.innerHTML = '';
    input({ type: 'text', name: 'email' });
    const group = boxes(6);
    expect(findOtpField(document)).toBe(group[0]);
    expect(findOtpBoxes(group[3])).toEqual(group);
  });

  it('spreads the code one digit per box and fires input/change on each', async () => {
    document.body.innerHTML = '';
    const group = boxes(6);
    const events: string[] = [];
    group.forEach((b, i) => ['input', 'change'].forEach((t) => b.addEventListener(t, () => events.push(`${i}:${t}`))));
    const out = await run(findOtpField(document), '123456');
    expect(out).toEqual({ status: 'filled', remaining: 20 });
    expect(group.map((b) => b.value).join('')).toBe('123456');
    expect(events).toHaveLength(12);
  });

  it('does not treat a group outside 4-8 boxes as an otp group', () => {
    document.body.innerHTML = '';
    boxes(3);
    expect(findOtpField(document)).toBeNull();
    document.body.innerHTML = '';
    boxes(9);
    expect(findOtpField(document)).toBeNull();
  });

  it('errors without filling when the group size does not match the code length', async () => {
    document.body.innerHTML = '';
    const group = boxes(8);
    const out = await run(findOtpField(document), '123456');
    expect(out).toEqual({ status: 'error' });
    expect(group.every((b) => b.value === '')).toBe(true);
  });

  it('keeps boxes separate when another input or form sits between them', () => {
    document.body.innerHTML = '';
    boxes(3);
    input({ type: 'text', name: 'other' });
    boxes(3);
    expect(findOtpField(document)).toBeNull();
    document.body.innerHTML = '<form id="a"></form><form id="b"></form>';
    boxes(3, document.getElementById('a')!);
    boxes(3, document.getElementById('b')!);
    expect(findOtpField(document)).toBeNull();
  });

  it('skips hidden boxes when forming the group', () => {
    document.body.innerHTML = '';
    const first = boxes(2);
    boxes(1, document.body, { type: 'hidden' });
    const rest = boxes(2);
    expect(findOtpField(document)).toBe(first[0]); // the hidden one is dropped; 4 usable remain adjacent
    expect(findOtpBoxes(first[0])).toEqual([...first, ...rest]);
  });

  it('prefers a single one-time-code field over box detection (mixed page)', async () => {
    document.body.innerHTML = '';
    boxes(6);
    const single = input({ type: 'text', autocomplete: 'one-time-code' });
    expect(findOtpField(document)).toBe(single);
    const out = await run(single, '654321');
    expect(out).toEqual({ status: 'filled', remaining: 20 });
    expect(single.value).toBe('654321');
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

  it('returns error when the payload has no usable code or remaining', async () => {
    document.body.innerHTML = '';
    const otp = input({ type: 'text', autocomplete: 'one-time-code' });
    const bad: unknown[] = [
      {}, { code: '', remaining: 10 }, { code: 123456, remaining: 10 },
      { code: '123456' }, { code: '123456', remaining: '10' }, { code: '123456', remaining: Infinity },
    ];
    for (const payload of bad) {
      const out = await fillTotp({ request: async () => ({ id: 'r', ok: true, payload }), url: 'https://s', entryId: 'e', otpField: otp, gen: 1, ...live });
      expect(out).toEqual({ status: 'error' });
      expect(otp.value).toBe('');
    }
  });
});
