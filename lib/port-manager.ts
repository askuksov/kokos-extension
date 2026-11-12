import {
  buildRequest, isKeepaliveId, KEEPALIVE_PREFIX, NATIVE_HOST, PROTOCOL_VERSION,
  type NmhResponse,
} from './nmh-client';
import { CONSENT_REQUIRED } from './data-consent';

// The subset of chrome.runtime.Port this module uses. Declared locally so the
// module stays pure and unit-testable with a fake (chrome.runtime.connectNative
// returns a Port that structurally satisfies this).
export interface NativePort {
  postMessage(msg: unknown): void;
  onMessage: { addListener(cb: (msg: any) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

export type ConnectNative = (hostName: string) => NativePort;

interface OriginState {
  port: NativePort;
  pending: Map<string, (r: NmhResponse) => void>;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
}

const DEFAULT_KEEPALIVE_MS = 20_000;

/** Owns one native-messaging connection per site origin. Concurrent tabs on
 * different sites get different ports, so the app's per-connection domain
 * anchor (set by the last get_logins on a port) never crosses origins. */
export class PortManager {
  private origins = new Map<string, OriginState>();

  constructor(
    private connect: ConnectNative,
    // allow: a gate asked before every request. A refused (or throwing) gate
    // resolves a consent_required envelope and nothing reaches the app.
    private opts: { keepaliveMs?: number; allow?: (action: string) => boolean | Promise<boolean> } = {},
  ) {}

  get openOrigins(): string[] {
    return [...this.origins.keys()];
  }

  request(origin: string, action: string, payload: object): Promise<NmhResponse> {
    // Never throws or rejects: every failure resolves an app_not_running
    // envelope carrying the request's id, so an async caller can never hang
    // waiting on this promise.
    const req = buildRequest(action, payload);
    const allow = this.opts.allow;
    if (!allow) return this.send(origin, req);
    return Promise.resolve()
      .then(() => allow(action))
      .catch(() => false)
      .then((ok) => ok
        ? this.send(origin, req)
        : errEnvelope(req.id, CONSENT_REQUIRED, 'data sharing not agreed'));
  }

  private send(origin: string, req: ReturnType<typeof buildRequest>): Promise<NmhResponse> {
    return new Promise<NmhResponse>((resolve) => {
      let state: OriginState;
      try {
        state = this.ensure(origin); // connect() may throw synchronously
      } catch {
        resolve(errEnvelope(req.id, 'app_not_running', 'native host unavailable'));
        return;
      }
      state.pending.set(req.id, resolve);
      this.startKeepalive(origin, state);
      try {
        state.port.postMessage(req);
      } catch {
        // postMessage on a dead port: tear the origin down (fails closed all
        // pending, including this request) so the NEXT request reconnects
        // instead of hitting the same dead port.
        this.onDisconnectFor(origin, state);
      }
    });
  }

  closeOrigin(origin: string): void {
    const state = this.origins.get(origin);
    if (!state) return;
    this.stopKeepalive(state);
    try { state.port.disconnect(); } catch { /* already gone */ }
    // Fail closed any stragglers.
    for (const [id, resolve] of state.pending) {
      resolve(errEnvelope(id, 'app_not_running', 'connection closed'));
    }
    state.pending.clear();
    this.origins.delete(origin);
  }

  private ensure(origin: string): OriginState {
    const existing = this.origins.get(origin);
    if (existing) return existing;
    const port = this.connect(NATIVE_HOST);
    const state: OriginState = { port, pending: new Map(), keepaliveTimer: null };
    port.onMessage.addListener((resp) => this.onMessage(origin, resp));
    port.onDisconnect.addListener(() => this.onDisconnectFor(origin, state));
    this.origins.set(origin, state);
    return state;
  }

  private onMessage(origin: string, resp: any): void {
    if (!resp || typeof resp.id !== 'string') return;
    if (isKeepaliveId(resp.id)) return; // keepalive echo: drop
    const state = this.origins.get(origin);
    if (!state) return;
    const resolve = state.pending.get(resp.id);
    if (!resolve) return; // unknown id: nothing waits on it
    state.pending.delete(resp.id);
    resolve(resp as NmhResponse);
    if (state.pending.size === 0) this.stopKeepalive(state);
  }

  private onDisconnectFor(origin: string, state: OriginState): void {
    if (this.origins.get(origin) !== state) return; // superseded port: ignore its late disconnect
    this.stopKeepalive(state);
    for (const [id, resolve] of state.pending) {
      resolve(errEnvelope(id, 'app_not_running', 'native host disconnected'));
    }
    state.pending.clear();
    this.origins.delete(origin);
  }

  private startKeepalive(origin: string, state: OriginState): void {
    if (state.keepaliveTimer !== null) return;
    const ms = this.opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
    state.keepaliveTimer = setInterval(() => {
      if (state.pending.size === 0) { this.stopKeepalive(state); return; }
      try {
        state.port.postMessage({
          id: `${KEEPALIVE_PREFIX}${keepaliveSeq()}`,
          version: PROTOCOL_VERSION,
          action: 'ping',
          payload: {},
        });
      } catch {
        this.onDisconnectFor(origin, state);
      }
    }, ms);
  }

  private stopKeepalive(state: OriginState): void {
    if (state.keepaliveTimer !== null) {
      clearInterval(state.keepaliveTimer);
      state.keepaliveTimer = null;
    }
  }
}

let kaSeq = 0;
function keepaliveSeq(): string {
  kaSeq += 1;
  return `${kaSeq}`;
}

function errEnvelope(id: string, code: string, message: string): NmhResponse {
  return { id, ok: false, error: { code, message } };
}
