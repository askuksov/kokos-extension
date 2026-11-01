// tests/content-fill.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

(globalThis as any).defineContentScript ??= (cfg: unknown) => cfg;

const { wireFillReceiver, handleFillEntry, isFillEntryMsg } = await import('../entrypoints/content');

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
