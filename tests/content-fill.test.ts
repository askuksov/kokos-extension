// tests/content-fill.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

(globalThis as any).defineContentScript ??= (cfg: unknown) => cfg;

const { wireFillReceiver, handleFillEntry, isFillEntryMsg, settleApprovalToast } = await import('../entrypoints/content');

const aForm = () => [{ username: null, password: null } as any];

describe('isFillEntryMsg', () => {
  it('accepts a well-formed fill-entry message', () => {
    expect(isFillEntryMsg({ type: 'fill-entry', entryId: 'e1' })).toBe(true);
  });
  it('rejects other messages', () => {
    expect(isFillEntryMsg({ type: 'nmh-request' })).toBe(false);
    expect(isFillEntryMsg({ type: 'fill-entry' })).toBe(false); // no entryId
    expect(isFillEntryMsg(null)).toBe(false);
  });
});

describe('handleFillEntry', () => {
  it('reports no-form when detection finds nothing', async () => {
    const fill = vi.fn(async () => 'filled' as const);
    const res = await handleFillEntry({ type: 'fill-entry', entryId: 'e1' }, () => [], fill, document);
    expect(res).toEqual({ ok: false, reason: 'no-form' });
    expect(fill).not.toHaveBeenCalled();
  });
  it('delegates to fill and maps a filled result to ok', async () => {
    const fill = vi.fn(async () => 'filled' as const);
    const res = await handleFillEntry({ type: 'fill-entry', entryId: 'e1', username: 'alice' }, aForm, fill, document);
    expect(fill).toHaveBeenCalledWith({ id: 'e1', username: 'alice' }, expect.anything());
    expect(res).toEqual({ ok: true });
  });
  it('maps a non-filled result to error', async () => {
    const fill = vi.fn(async () => 'error' as const);
    const res = await handleFillEntry({ type: 'fill-entry', entryId: 'e1' }, aForm, fill, document);
    expect(res).toEqual({ ok: false, reason: 'error' });
  });
});

describe('wireFillReceiver', () => {
  function wire(over: Partial<Parameters<typeof wireFillReceiver>[0]> = {}) {
    let cb: any;
    const fill = vi.fn(async () => 'filled' as const);
    wireFillReceiver({
      ownId: 'self',
      detect: aForm,
      fill,
      doc: document,
      addListener: (c) => { cb = c; },
      ...over,
    });
    return { cb, fill };
  }
  it('ignores a message from a foreign sender id (no response, no fill)', () => {
    const { cb, fill } = wire();
    const sendResponse = vi.fn();
    const ret = cb({ type: 'fill-entry', entryId: 'e1' }, { id: 'evil' }, sendResponse);
    expect(ret).toBeUndefined();       // not handled -> channel not kept open
    expect(sendResponse).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });
  it('ignores a non-fill message from our own id', () => {
    const { cb, fill } = wire();
    const sendResponse = vi.fn();
    cb({ type: 'something-else' }, { id: 'self' }, sendResponse);
    expect(fill).not.toHaveBeenCalled();
  });
  it('handles a trusted fill-entry and responds ok', async () => {
    const { cb, fill } = wire();
    const sendResponse = vi.fn();
    const ret = cb({ type: 'fill-entry', entryId: 'e1', username: 'alice' }, { id: 'self' }, sendResponse);
    expect(ret).toBe(true);            // keep the channel open for the async response
    await Promise.resolve(); await Promise.resolve();
    expect(fill).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

describe('settleApprovalToast', () => {
  const anchor = () => document.createElement('input');
  const overlay = () => ({ showToast: vi.fn(), hideToast: vi.fn() });

  it('hides the waiting toast once the app approved the fill', () => {
    const o = overlay();
    settleApprovalToast({ outcome: 'filled', awaited: true, current: true, anchor: anchor(), overlay: o });
    expect(o.hideToast).toHaveBeenCalledOnce();
    expect(o.showToast).not.toHaveBeenCalled();
  });

  it('swaps it for the denied message when the user said no', () => {
    const o = overlay();
    const a = anchor();
    settleApprovalToast({ outcome: 'denied', awaited: true, current: true, anchor: a, overlay: o });
    expect(o.showToast).toHaveBeenCalledWith(a, 'Denied in Kokos. Click the key icon to ask again.');
    expect(o.hideToast).not.toHaveBeenCalled();
  });

  it('hides it for a current discarded or failed fill too', () => {
    for (const outcome of ['discarded', 'error'] as const) {
      const o = overlay();
      settleApprovalToast({ outcome, awaited: true, current: true, anchor: anchor(), overlay: o });
      expect(o.hideToast, outcome).toHaveBeenCalledOnce();
    }
  });

  it('leaves the toast alone when a newer fill owns it', () => {
    const o = overlay();
    settleApprovalToast({ outcome: 'denied', awaited: true, current: false, anchor: anchor(), overlay: o });
    expect(o.showToast).not.toHaveBeenCalled();
    expect(o.hideToast).not.toHaveBeenCalled();
  });

  it('does nothing when no approval was asked (username-only step)', () => {
    const o = overlay();
    settleApprovalToast({ outcome: 'filled', awaited: false, current: true, anchor: anchor(), overlay: o });
    expect(o.showToast).not.toHaveBeenCalled();
    expect(o.hideToast).not.toHaveBeenCalled();
  });
});
