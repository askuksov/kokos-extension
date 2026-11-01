import { describe, it, expect, vi } from 'vitest';
import { handleBridgeMessage, trustedFrame, routeRuntimeMessage } from './message-bridge';

// Minimal PortManager stand-in: records the routed call, returns a canned reply.
function fakePM(reply: any = { id: 'x', ok: true, payload: {} }) {
  const calls: any[] = [];
  return {
    calls,
    request: async (origin: string, action: string, payload: object) => {
      calls.push({ origin, action, payload });
      return reply;
    },
  } as any;
}

describe('handleBridgeMessage', () => {
  it('routes a well-formed nmh-request to the port manager', async () => {
    const pm = fakePM({ id: '1', ok: true, payload: { items: [] } });
    const res = await handleBridgeMessage(
      { type: 'nmh-request', origin: 'https://a.com', action: 'get_logins', payload: { url: 'https://a.com' } },
      pm,
    );
    expect(res).toMatchObject({ ok: true });
    expect(pm.calls[0]).toEqual({ origin: 'https://a.com', action: 'get_logins', payload: { url: 'https://a.com' } });
  });

  it('defaults an absent payload to an empty object', async () => {
    const pm = fakePM();
    await handleBridgeMessage({ type: 'nmh-request', origin: 'https://a.com', action: 'ping' }, pm);
    expect(pm.calls[0].payload).toEqual({});
  });

  it('fails closed on a malformed message without touching the port manager', async () => {
    const pm = fakePM();
    const res = await handleBridgeMessage({ type: 'nope' }, pm);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('bad_request');
    expect(pm.calls).toHaveLength(0);
  });

  it('fails closed when origin or action is missing', async () => {
    const pm = fakePM();
    const res = await handleBridgeMessage({ type: 'nmh-request', action: 'ping' }, pm);
    expect(res.ok).toBe(false);
    expect(pm.calls).toHaveLength(0);
  });
});

function fakePm() {
  const calls: Array<{ origin: string; action: string; payload: any }> = [];
  return {
    calls,
    request: vi.fn(async (origin: string, action: string, payload: object) => {
      calls.push({ origin, action, payload });
      return { id: 'x', ok: true, payload: {} };
    }),
  } as any;
}

describe('handleBridgeMessage trusted-frame override', () => {
  it('replaces a spoofed origin with the trusted frame origin', async () => {
    const pm = fakePm();
    await handleBridgeMessage(
      { type: 'nmh-request', origin: 'https://evil.example', action: 'get_secret', payload: { entry_id: 'e1', url: 'https://evil.example' } },
      pm,
      { origin: 'https://aliexpress.com', url: 'https://aliexpress.com/login' },
    );
    expect(pm.calls[0].origin).toBe('https://aliexpress.com');
    expect(pm.calls[0].payload.url).toBe('https://aliexpress.com/login');
  });
  it('overrides payload.url only for URL-bearing actions', async () => {
    const pm = fakePm();
    await handleBridgeMessage({ type: 'nmh-request', origin: 'https://a.com', action: 'ping', payload: {} }, pm, { origin: 'https://a.com', url: 'https://a.com/x' });
    expect(pm.calls[0].payload.url).toBeUndefined();
  });
  it('without a trusted frame (dev smoke hook) uses the message as-is', async () => {
    const pm = fakePm();
    await handleBridgeMessage({ type: 'nmh-request', origin: 'https://a.com', action: 'get_logins', payload: { url: 'https://a.com' } }, pm);
    expect(pm.calls[0].origin).toBe('https://a.com');
    expect(pm.calls[0].payload.url).toBe('https://a.com');
  });
  it('fails closed on a malformed message without opening a port', async () => {
    const pm = fakePm();
    const res = await handleBridgeMessage({ nope: true }, pm, { origin: 'https://a.com', url: 'https://a.com' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('bad_request');
    expect(pm.request).not.toHaveBeenCalled();
  });
});

describe('trustedFrame', () => {
  it('derives origin and url from a sender-like object', () => {
    expect(trustedFrame({ origin: 'https://a.com', url: 'https://a.com/login' }))
      .toEqual({ origin: 'https://a.com', url: 'https://a.com/login' });
  });
  it('falls back to origin when url is absent', () => {
    expect(trustedFrame({ origin: 'https://a.com' }))
      .toEqual({ origin: 'https://a.com', url: 'https://a.com' });
  });
  it('returns null for an undefined sender', () => {
    expect(trustedFrame(undefined)).toBeNull();
  });
  it('returns null for an empty origin', () => {
    expect(trustedFrame({ origin: '' })).toBeNull();
  });
});

describe('routeRuntimeMessage', () => {
  it('threads the sender-derived trusted frame through to pm.request, overriding a spoofed origin/url', async () => {
    const pm = fakePm();
    await routeRuntimeMessage(
      { type: 'nmh-request', origin: 'https://evil.example', action: 'get_secret', payload: { entry_id: 'e1', url: 'https://evil.example' } },
      { origin: 'https://aliexpress.com', url: 'https://aliexpress.com/login' },
      pm,
    );
    expect(pm.calls[0].origin).toBe('https://aliexpress.com');
    expect(pm.calls[0].payload.url).toBe('https://aliexpress.com/login');
  });
  it('with no sender, uses the message as-is (dev smoke hook path)', async () => {
    const pm = fakePm();
    await routeRuntimeMessage(
      { type: 'nmh-request', origin: 'https://a.com', action: 'get_logins', payload: { url: 'https://a.com' } },
      undefined,
      pm,
    );
    expect(pm.calls[0].origin).toBe('https://a.com');
    expect(pm.calls[0].payload.url).toBe('https://a.com');
  });
});
