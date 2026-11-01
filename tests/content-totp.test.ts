// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { TotpFillOutcome } from '../lib/totp';

(globalThis as any).defineContentScript ??= (cfg: unknown) => cfg;

const { isTotpFillMsg, handleTotpFill, wireTotpReceiver } = await import('../entrypoints/content');

const OWN = 'self-id';

describe('isTotpFillMsg', () => {
  it('accepts a well-formed totp-fill message', () => {
    expect(isTotpFillMsg({ type: 'totp-fill', entryId: 'e' })).toBe(true);
  });
  it('rejects other shapes', () => {
    expect(isTotpFillMsg({ type: 'fill-entry', entryId: 'e' })).toBe(false);
    expect(isTotpFillMsg({ type: 'totp-fill' })).toBe(false);
  });
});

describe('handleTotpFill', () => {
  it('passes the entryId to fill and returns remaining on success', async () => {
    let gotEntry = '';
    const fill = async (_otp: any, entryId: string): Promise<TotpFillOutcome> => { gotEntry = entryId; return { status: 'filled', remaining: 21 }; };
    const res = await handleTotpFill({ type: 'totp-fill', entryId: 'E9' }, () => document.createElement('input'), fill, document);
    expect(res).toEqual({ ok: true, remaining: 21 });
    expect(gotEntry).toBe('E9');
  });
  it('returns no-field when the outcome is no-field', async () => {
    const fill = async (): Promise<TotpFillOutcome> => ({ status: 'no-field' });
    const res = await handleTotpFill({ type: 'totp-fill', entryId: 'e' }, () => null, fill, document);
    expect(res).toEqual({ ok: false, reason: 'no-field' });
  });
  it('folds discarded/error to reason:error', async () => {
    const fill = async (): Promise<TotpFillOutcome> => ({ status: 'error' });
    const res = await handleTotpFill({ type: 'totp-fill', entryId: 'e' }, () => null, fill, document);
    expect(res).toEqual({ ok: false, reason: 'error' });
  });
});

describe('wireTotpReceiver', () => {
  function harness() {
    let cb: any;
    const fill = vi.fn(async (): Promise<TotpFillOutcome> => ({ status: 'filled', remaining: 10 }));
    wireTotpReceiver({ ownId: OWN, findOtp: () => document.createElement('input'), fill, doc: document, addListener: (c) => { cb = c; } });
    return { cb, fill };
  }
  it('ignores a sender whose id is not ours', () => {
    const { cb, fill } = harness();
    const sendResponse = vi.fn();
    const ret = cb({ type: 'totp-fill', entryId: 'e' }, { id: 'evil' }, sendResponse);
    expect(ret).toBeFalsy();
    expect(fill).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
  it('handles a trusted totp-fill and replies with remaining only (no code)', async () => {
    const { cb } = harness();
    const sendResponse = vi.fn();
    const ret = cb({ type: 'totp-fill', entryId: 'e' }, { id: OWN }, sendResponse);
    expect(ret).toBe(true); // async response
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, remaining: 10 });
  });
});
