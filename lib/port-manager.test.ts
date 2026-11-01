import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PortManager, type NativePort, type ConnectNative } from './port-manager';
import { isKeepaliveId } from './nmh-client';

// A controllable fake native port.
function makeFakePort() {
  let msgCb: ((m: any) => void) | undefined;
  let discCb: (() => void) | undefined;
  const sent: any[] = [];
  const port: NativePort = {
    postMessage: (m: any) => { sent.push(m); },
    onMessage: { addListener: (cb) => { msgCb = cb; } },
    onDisconnect: { addListener: (cb) => { discCb = cb; } },
    disconnect: vi.fn(),
  };
  return {
    port, sent,
    reply: (m: any) => msgCb?.(m),
    drop: () => discCb?.(),
    lastRealRequest: () => [...sent].reverse().find((m) => !isKeepaliveId(m.id)),
  };
}

describe('PortManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('routes a request to a port for the origin and resolves by id', async () => {
    const f = makeFakePort();
    const connect: ConnectNative = () => f.port;
    const pm = new PortManager(connect);

    const p = pm.request('https://a.com', 'get_logins', { url: 'https://a.com' });
    const req = f.lastRealRequest();
    expect(req.action).toBe('get_logins');
    f.reply({ id: req.id, ok: true, payload: { items: [] } });
    await expect(p).resolves.toEqual({ id: req.id, ok: true, payload: { items: [] } });
  });

  it('holds one port per origin (isolation)', async () => {
    const ports = [makeFakePort(), makeFakePort()];
    let n = 0;
    const connect: ConnectNative = () => ports[n++]!.port;
    const pm = new PortManager(connect);

    pm.request('https://a.com', 'ping', {});
    pm.request('https://b.com', 'ping', {});
    expect(pm.openOrigins.sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(n).toBe(2); // two distinct connectNative calls
  });

  it('dispatches two in-flight requests to the right caller by id', async () => {
    const f = makeFakePort();
    const pm = new PortManager(() => f.port);
    const p1 = pm.request('https://a.com', 'ping', {});
    const p2 = pm.request('https://a.com', 'get_status', {});
    const [r1, r2] = f.sent.filter((m) => !isKeepaliveId(m.id));
    f.reply({ id: r2.id, ok: true, payload: { two: true } });
    f.reply({ id: r1.id, ok: true, payload: { one: true } });
    await expect(p1).resolves.toMatchObject({ payload: { one: true } });
    await expect(p2).resolves.toMatchObject({ payload: { two: true } });
  });

  it('posts a keepalive ping while a request is outstanding, then stops', async () => {
    const f = makeFakePort();
    const pm = new PortManager(() => f.port, { keepaliveMs: 20_000 });
    const p = pm.request('https://a.com', 'get_secret', { entry_id: 'x' });
    vi.advanceTimersByTime(20_000);
    expect(f.sent.some((m) => isKeepaliveId(m.id) && m.action === 'ping')).toBe(true);
    const req = f.lastRealRequest();
    f.reply({ id: req.id, ok: true, payload: {} });
    await p;
    const before = f.sent.length;
    vi.advanceTimersByTime(40_000); // nothing outstanding now
    expect(f.sent.length).toBe(before);
  });

  it('fails closed: a disconnect rejects outstanding requests with an error envelope', async () => {
    const f = makeFakePort();
    const pm = new PortManager(() => f.port);
    const p = pm.request('https://a.com', 'get_logins', { url: 'https://a.com' });
    f.drop();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('app_not_running');
  });

  it('reconnects on the next request after a disconnect', async () => {
    const ports = [makeFakePort(), makeFakePort()];
    let n = 0;
    const pm = new PortManager(() => ports[n++]!.port);
    const p1 = pm.request('https://a.com', 'ping', {});
    ports[0]!.drop();
    await p1;
    expect(pm.openOrigins).toHaveLength(0); // dead port removed
    pm.request('https://a.com', 'ping', {});
    expect(n).toBe(2); // a fresh connectNative
  });

  it('fails closed: a postMessage throw resolves the request with an error envelope', async () => {
    const port: NativePort = {
      postMessage: vi.fn(() => { throw new Error('dead'); }),
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
      disconnect: vi.fn(),
    };
    const pm = new PortManager(() => port);
    const p = pm.request('https://a.com', 'get_logins', { url: 'https://a.com' });
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('app_not_running');
  });

  it('tears down the keepalive interval once the outstanding request drains', async () => {
    const f = makeFakePort();
    const pm = new PortManager(() => f.port, { keepaliveMs: 20_000 });
    const p = pm.request('https://a.com', 'get_secret', { entry_id: 'x' });
    expect(vi.getTimerCount()).toBe(1); // keepalive interval armed
    const req = f.lastRealRequest();
    f.reply({ id: req.id, ok: true, payload: {} });
    await p;
    expect(vi.getTimerCount()).toBe(0); // interval actually cleared, not just re-guarded
  });

  it('fails closed when connect() throws synchronously, without retaining the origin', async () => {
    const connect: ConnectNative = () => { throw new Error('spawn failed'); };
    const pm = new PortManager(connect);

    const p = pm.request('https://a.com', 'ping', {});
    await expect(p).resolves.toMatchObject({ ok: false, error: { code: 'app_not_running' } });
    expect(pm.openOrigins).not.toContain('https://a.com');
  });

  it('a postMessage throw tears down the dead port so the next request reconnects', async () => {
    let connectCalls = 0;
    const deadPort: NativePort = {
      postMessage: vi.fn(() => { throw new Error('dead'); }),
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
      disconnect: vi.fn(),
    };
    const freshPort = makeFakePort();
    const connect: ConnectNative = () => {
      connectCalls += 1;
      return connectCalls === 1 ? deadPort : freshPort.port;
    };
    const pm = new PortManager(connect);

    const p = pm.request('https://a.com', 'get_logins', { url: 'https://a.com' });
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('app_not_running');
    expect(pm.openOrigins).not.toContain('https://a.com'); // dead port removed

    pm.request('https://a.com', 'ping', {});
    expect(connectCalls).toBe(2); // a fresh connectNative on the next request
  });

  it('closeOrigin fails closed any pending request and drops the origin', async () => {
    const f = makeFakePort();
    const pm = new PortManager(() => f.port);
    const p = pm.request('https://a.com', 'get_logins', { url: 'https://a.com' });
    pm.closeOrigin('https://a.com');
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('app_not_running');
    expect(pm.openOrigins).not.toContain('https://a.com');
  });
});

function fakePort() {
  let msgCb: (m: any) => void = () => {};
  let discCb: () => void = () => {};
  const port: NativePort = {
    postMessage: vi.fn(),
    onMessage: { addListener: (cb: any) => { msgCb = cb; } },
    onDisconnect: { addListener: (cb: any) => { discCb = cb; } },
    disconnect: vi.fn(),
  };
  return { port, fireMessage: (m: any) => msgCb(m), fireDisconnect: () => discCb() };
}

describe('PortManager onDisconnect generation guard', () => {
  it('a stale disconnect from a superseded port does not tear down the new port', () => {
    const ports = [fakePort(), fakePort()];
    let i = 0;
    const pm = new PortManager(() => ports[i++]!.port, { keepaliveMs: 10_000 });
    pm.request('https://a.com', 'ping', {}); // opens port #0
    pm.closeOrigin('https://a.com');         // manual teardown of #0
    pm.request('https://a.com', 'ping', {}); // opens port #1
    ports[0]!.fireDisconnect();              // LATE disconnect from the dead #0
    expect(pm.openOrigins).toContain('https://a.com'); // #1 still alive
    expect(ports[1]!.port.disconnect).not.toHaveBeenCalled();
  });
});
