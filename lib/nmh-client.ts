// Typed mirror of the Kokos NMH wire protocol (kokos-nmh/src/protocol.rs).
// Pure module: no chrome.* / no DOM. Encodes requests and names the contract;
// it does NOT open ports (that is port-manager.ts).

export const PROTOCOL_VERSION = 1 as const;
export const NATIVE_HOST = 'dev.kuksov.kokos' as const;
export const KEEPALIVE_PREFIX = 'keepalive-' as const;

// Order mirrors protocol.rs `mod codes` exactly (the test pins the order).
export const NMH_CODES = {
  BAD_REQUEST: 'bad_request',
  UNSUPPORTED_VERSION: 'unsupported_version',
  UNKNOWN_ACTION: 'unknown_action',
  APP_NOT_RUNNING: 'app_not_running',
  LOCKED: 'locked',
  NO_VAULT: 'no_vault',
  DENIED: 'denied',
  NOT_IN_SCOPE: 'not_in_scope',
  ENTRY_NOT_FOUND: 'entry_not_found',
  INVALID_URL: 'invalid_url',
  TOO_LARGE: 'too_large',
  TIMEOUT: 'timeout',
  UNSUPPORTED_PLATFORM: 'unsupported_platform',
  INTERNAL: 'internal',
} as const;

export type NmhCode = (typeof NMH_CODES)[keyof typeof NMH_CODES];

export interface NmhErrorObj {
  code: string;
  message: string;
}

export interface NmhRequest {
  id: string;
  version: typeof PROTOCOL_VERSION;
  action: string;
  payload: object;
}

export interface NmhResponse<P = unknown> {
  id: string;
  ok: boolean;
  payload?: P;
  error?: NmhErrorObj;
}

// Per-action payloads (from tools/stub-extension/panel.js — authoritative).
export interface GetLoginsPayload { url: string; }
export interface GetSecretPayload { entry_id: string; field?: string; url?: string; }
export interface GetTotpPayload { entry_id: string; url?: string; }
export interface SaveLoginPayload { url: string; username: string; password: string; title?: string; }
export interface UpdateLoginPayload { entry_id: string; password: string; url?: string; }
export interface GeneratePasswordPayload { length?: number; }

// Response payload shapes we rely on.
export interface LoginItem { id: string; title?: string; username?: string | null; hasTotp?: boolean; }
export interface GetLoginsResult { items: LoginItem[]; }
export interface GetStatusResult { running: boolean; locked: boolean; [k: string]: unknown; }
export interface GetSecretResult { value: string; }
export interface GetTotpResult { code: string; period: number; remaining: number; }
export interface GeneratePasswordResult { password: string; }

let counter = 0;

/** Unique request id. crypto.randomUUID keeps ids distinct across service-worker
 * restarts; the counter guarantees intra-process uniqueness even if two calls
 * land in the same UUID-less environment. */
function nextId(): string {
  counter += 1;
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}`;
  return `req-${counter}-${uuid}`;
}

export function buildRequest(action: string, payload: object): NmhRequest {
  return { id: nextId(), version: PROTOCOL_VERSION, action, payload };
}

export function isKeepaliveId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(KEEPALIVE_PREFIX);
}
