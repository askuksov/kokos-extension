// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fillFromMatch, setNativeValue, type FillDeps } from './fill';
import type { OverlayMatch } from './overlay';
import type { NmhResponse } from './nmh-client';
import { fillToken } from './fill-memory';

const MATCH: OverlayMatch = { id: 'e1', title: 'Aliexpress', username: 'askuksov' };

function fields() {
  const u = document.createElement('input');
  const p = document.createElement('input'); p.type = 'password';
  document.body.append(u, p);
  return { u, p };
}

function deps(over: Partial<FillDeps>, resp: NmhResponse): FillDeps {
  const { u, p } = fields();
  return {
    request: vi.fn(async () => resp),
    url: 'https://aliexpress.com/login',
    usernameField: u,
    passwordField: p,
    gen: 1,
    currentGen: () => 1,
    isConnected: (el) => !!el && el.isConnected,
    ...over,
  };
}

const ok: NmhResponse = { id: 'x', ok: true, payload: { value: 's3cr3t' } };
const err: NmhResponse = { id: 'x', ok: false, error: { code: 'internal', message: 'no' } };
const denied: NmhResponse = { id: 'x', ok: false, error: { code: 'denied', message: 'no' } };

describe('fillFromMatch', () => {
  it('fills username + password together on success', async () => {
    const d = deps({}, ok);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('filled');
    expect(d.passwordField!.value).toBe('s3cr3t');
    expect(d.usernameField!.value).toBe('askuksov');
    // url passed on the secret request (anchor belt+suspenders)
    expect(d.request).toHaveBeenCalledWith('get_secret', { entry_id: 'e1', url: 'https://aliexpress.com/login' });
  });
  it('discards the secret when the generation token moved during the await', async () => {
    const d = deps({ currentGen: () => 2 }, ok);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('discarded');
    expect(d.passwordField!.value).toBe('');
    expect(d.usernameField!.value).toBe('');
  });
  it('reports an error, not a fill, when the secret is not a string', async () => {
    for (const payload of [{}, { value: 42 }, { value: null }]) {
      const d = deps({}, { id: 'x', ok: true, payload });
      expect(await fillFromMatch(d, MATCH)).toBe('error');
      expect(d.passwordField!.value).toBe('');
    }
  });
  it('discards when the password field detached during the await', async () => {
    const d = deps({}, ok);
    d.passwordField!.remove();
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('discarded');
  });
  it('fills nothing on an error envelope (no partial fill)', async () => {
    const d = deps({}, err);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('error');
    expect(d.passwordField!.value).toBe('');
    expect(d.usernameField!.value).toBe('');
  });
  it('reports a denied confirmation as its own outcome, not a generic error', async () => {
    // The page tells the user to retry only for this code — every other
    // failure is not something clicking the key icon again would fix.
    const d = deps({}, denied);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('denied');
    expect(d.passwordField!.value).toBe('');
    expect(d.usernameField!.value).toBe('');
  });
  it('announces the pending approval exactly once, before the secret request', async () => {
    const seen: string[] = [];
    const d = deps(
      {
        request: vi.fn(async () => { seen.push('request'); return ok; }),
        onAwaitingApproval: () => seen.push('awaiting'),
      },
      ok,
    );
    await fillFromMatch(d, MATCH);
    expect(seen).toEqual(['awaiting', 'request']);
  });
  it('never announces a pending approval on a username-only step', async () => {
    const onAwaitingApproval = vi.fn();
    const d = deps({ passwordField: null, onAwaitingApproval }, ok);
    await fillFromMatch(d, MATCH);
    expect(onAwaitingApproval).not.toHaveBeenCalled();
  });
  it('treats ok:false as an error even when a payload is present (no partial fill)', async () => {
    const okFalseWithPayload: NmhResponse = { id: 'x', ok: false, payload: { value: 's3cr3t' } };
    const d = deps({}, okFalseWithPayload);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('error');
    expect(d.passwordField!.value).toBe('');
    expect(d.usernameField!.value).toBe('');
  });
  it('discards when the username field detached during the await', async () => {
    const d = deps({}, ok);
    d.usernameField!.remove();
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('discarded');
    expect(d.passwordField!.value).toBe('');
    expect(d.usernameField!.value).toBe('');
  });
  it('fills only the username on a split-login username step, never fetching the secret', async () => {
    const d = deps({ passwordField: null }, ok);
    const r = await fillFromMatch(d, MATCH);
    expect(r).toBe('filled');
    expect(d.usernameField!.value).toBe('askuksov');
    // secret-minimization: no get_secret on a username-only step
    expect(d.request).not.toHaveBeenCalled();
  });
  it('reports the token of the filled secret, never the plaintext', async () => {
    const onSecretFilled = vi.fn();
    const d = deps({ onSecretFilled }, ok);
    await fillFromMatch(d, MATCH);
    expect(onSecretFilled).toHaveBeenCalledTimes(1);
    expect(onSecretFilled).toHaveBeenCalledWith(fillToken('s3cr3t'));
    expect(onSecretFilled).not.toHaveBeenCalledWith('s3cr3t');
  });
  it('reports the token before the fill events fire', async () => {
    // A page may submit synchronously from an input listener; that submit must
    // already see the token.
    const seen: string[] = [];
    const d = deps({ onSecretFilled: () => seen.push('token') }, ok);
    d.passwordField!.addEventListener('input', () => seen.push('input'));
    await fillFromMatch(d, MATCH);
    expect(seen).toEqual(['token', 'input']);
  });
  it('reports no token when nothing was filled', async () => {
    const onSecretFilled = vi.fn();
    await fillFromMatch(deps({ onSecretFilled, currentGen: () => 2 }, ok), MATCH); // superseded
    await fillFromMatch(deps({ onSecretFilled }, err), MATCH);
    await fillFromMatch(deps({ onSecretFilled }, denied), MATCH);
    await fillFromMatch(deps({ onSecretFilled, passwordField: null }, ok), MATCH); // username-only step
    expect(onSecretFilled).not.toHaveBeenCalled();
  });
});

describe('setNativeValue', () => {
  it('sets the value and dispatches input + change', () => {
    const el = document.createElement('input');
    const input = vi.fn(); const change = vi.fn();
    el.addEventListener('input', input); el.addEventListener('change', change);
    setNativeValue(el, 'hello');
    expect(el.value).toBe('hello');
    expect(input).toHaveBeenCalled();
    expect(change).toHaveBeenCalled();
  });
});
