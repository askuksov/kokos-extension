// lib/picker-bridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routePickerMessage, type PickerBridgeDeps } from './picker-bridge';
import type { NmhResponse } from './nmh-client';

function ok(payload: unknown): NmhResponse { return { id: 'r', ok: true, payload }; }
function fail(code: string): NmhResponse { return { id: 'r', ok: false, error: { code, message: code } }; }

function makeDeps(over: Partial<PickerBridgeDeps> = {}): PickerBridgeDeps {
  return {
    ownId: 'self',
    request: vi.fn(async () => ok({ items: [] })),
    getTabUrl: vi.fn(async () => 'https://a.com/login?x=1'),
    ...over,
  };
}
const popup = { id: 'self' };

describe('routePickerMessage — auth & routing', () => {
  it('returns null for a non-picker message', async () => {
    expect(await routePickerMessage({ type: 'nmh-request' }, popup, makeDeps())).toBeNull();
  });
  it('rejects a foreign sender id', async () => {
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, { id: 'evil' }, makeDeps());
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
  it('rejects a picker action arriving from a tab frame (popup-only)', async () => {
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, { id: 'self', tab: { id: 7 } }, makeDeps());
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
  it('rejects a non-http tab url', async () => {
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, popup, makeDeps({ getTabUrl: vi.fn(async () => 'chrome://newtab') }));
    expect(res).toEqual({ ok: false, code: 'invalid_url' });
  });
  it('rejects an absent tab url', async () => {
    const res = await routePickerMessage({ type: 'copy-secret', tabId: 7, entryId: 'e' }, popup, makeDeps({ getTabUrl: vi.fn(async () => undefined) }));
    expect(res).toEqual({ ok: false, code: 'invalid_url' });
  });
  it('rejects a malformed tab url (new URL() throw branch)', async () => {
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, popup, makeDeps({ getTabUrl: vi.fn(async () => 'not-a-url') }));
    expect(res).toEqual({ ok: false, code: 'invalid_url' });
  });
});

describe('list-site-logins', () => {
  it('calls get_logins with the BROWSER-DERIVED tab url + origin (not a message value) and returns metadata', async () => {
    const request = vi.fn(async () => ok({ items: [{ id: '1', title: 'A', username: 'alice', hasTotp: false }] }));
    const deps = makeDeps({ request });
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, popup, deps);
    expect(request).toHaveBeenCalledWith('https://a.com', 'get_logins', { url: 'https://a.com/login?x=1' });
    expect(res).toEqual({ ok: true, items: [{ id: '1', title: 'A', username: 'alice', hasTotp: false }] });
  });
  it('passes through the host error code on failure', async () => {
    const deps = makeDeps({ request: vi.fn(async () => fail('locked')) });
    const res = await routePickerMessage({ type: 'list-site-logins', tabId: 7 }, popup, deps);
    expect(res).toEqual({ ok: false, code: 'locked' });
  });
  it('ignores a url supplied in the message body — uses only the browser-derived tab url', async () => {
    const request = vi.fn(async () => ok({ items: [] }));
    const deps = makeDeps({ request });
    await routePickerMessage({ type: 'list-site-logins', tabId: 7, url: 'https://evil.example/x' } as any, popup, deps);
    expect(request).toHaveBeenCalledWith('https://a.com', 'get_logins', { url: 'https://a.com/login?x=1' });
  });
});

describe('copy-secret', () => {
  it('calls get_secret with the entry id + browser-derived url and returns the value', async () => {
    const request = vi.fn(async () => ok({ value: 's3cr3t' }));
    const deps = makeDeps({ request });
    const res = await routePickerMessage({ type: 'copy-secret', tabId: 7, entryId: 'e9' }, popup, deps);
    expect(request).toHaveBeenCalledWith('https://a.com', 'get_secret', { entry_id: 'e9', url: 'https://a.com/login?x=1' });
    expect(res).toEqual({ ok: true, value: 's3cr3t' });
  });
  it('passes through denied without a value', async () => {
    const deps = makeDeps({ request: vi.fn(async () => fail('denied')) });
    const res = await routePickerMessage({ type: 'copy-secret', tabId: 7, entryId: 'e9' }, popup, deps);
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
});

describe('routePickerMessage copy-totp', () => {
  const ownId = 'self';
  const base = () => {
    const calls: Array<{ origin: string; action: string; payload: any }> = [];
    const deps = {
      ownId,
      request: async (origin: string, action: string, payload: object) => {
        calls.push({ origin, action, payload: payload as any });
        return { id: 'r', ok: true, payload: { code: '445566', period: 30, remaining: 19 } } as any;
      },
      getTabUrl: async (_id: number) => 'https://bank.example/2fa',
    };
    return { calls, deps };
  };

  it('returns the code + remaining using the browser-derived url', async () => {
    const { calls, deps } = base();
    const res = await routePickerMessage({ type: 'copy-totp', tabId: 7, entryId: 'e1' }, { id: ownId }, deps);
    expect(res).toEqual({ ok: true, code: '445566', remaining: 19 });
    expect(calls[0]).toEqual({ origin: 'https://bank.example', action: 'get_totp', payload: { entry_id: 'e1', url: 'https://bank.example/2fa' } });
  });

  it('IGNORES a message-supplied url (never a fallback)', async () => {
    const { calls, deps } = base();
    await routePickerMessage({ type: 'copy-totp', tabId: 7, entryId: 'e1', url: 'https://evil.example' } as any, { id: ownId }, deps);
    expect(calls[0]!.payload.url).toBe('https://bank.example/2fa');
  });

  it('rejects an untrusted sender id', async () => {
    const { deps } = base();
    const res = await routePickerMessage({ type: 'copy-totp', tabId: 7, entryId: 'e1' }, { id: 'other' }, deps);
    expect(res).toEqual({ ok: false, code: 'denied' });
  });

  it('rejects a content-frame sender (popup-only)', async () => {
    const { deps } = base();
    const res = await routePickerMessage({ type: 'copy-totp', tabId: 7, entryId: 'e1' }, { id: ownId, tab: { id: 7 } }, deps);
    expect(res).toEqual({ ok: false, code: 'denied' });
  });

  it('maps a get_totp error code', async () => {
    const { deps } = base();
    deps.request = async () => ({ id: 'r', ok: false, error: { code: 'denied', message: 'x' } }) as any;
    const res = await routePickerMessage({ type: 'copy-totp', tabId: 7, entryId: 'e1' }, { id: ownId }, deps);
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
});
