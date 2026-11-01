import type { PortManager } from './port-manager';
import type { NmhResponse } from './nmh-client';

export interface BridgeRequest {
  type: 'nmh-request';
  origin: string;
  action: string;
  payload?: object;
}

export interface TrustedFrame {
  origin: string;
  url: string;
}

// Structural stand-in for chrome.runtime.MessageSender — keeps this module
// chrome-free (pure, unit-testable without the chrome global).
export interface MessageSenderLike {
  origin?: string;
  url?: string;
}

const URL_ACTIONS = new Set(['get_logins', 'get_secret', 'get_totp', 'update_login', 'save_login']);

function isBridgeRequest(msg: unknown): msg is BridgeRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'nmh-request'
    && typeof m.origin === 'string' && m.origin.length > 0
    && typeof m.action === 'string' && m.action.length > 0;
}

/** The single entry both content scripts and the dev smoke hook use to reach the
 * native host. Validates shape and fails closed. When `trusted` is present (a
 * real content-script message, its origin/url set by the browser and unspoofable)
 * it OVERRIDES the page-supplied origin and url — the content script never
 * decides which origin a secret is scoped to. */
export async function handleBridgeMessage(
  msg: unknown,
  pm: PortManager,
  trusted?: TrustedFrame,
): Promise<NmhResponse> {
  if (!isBridgeRequest(msg)) {
    return { id: 'invalid', ok: false, error: { code: 'bad_request', message: 'malformed bridge message' } };
  }
  const origin = trusted ? trusted.origin : msg.origin;
  const payload: Record<string, unknown> = { ...(msg.payload ?? {}) };
  if (trusted && URL_ACTIONS.has(msg.action)) payload.url = trusted.url;
  return pm.request(origin, msg.action, payload);
}

/** Derives the trusted frame from a browser-supplied sender. `sender.origin`
 * is set by the browser itself and cannot be spoofed by the page/content
 * script, unlike anything the message payload claims. Returns null when no
 * usable origin is present (e.g. the dev smoke hook, which has no sender). */
export function trustedFrame(sender: MessageSenderLike | undefined | null): TrustedFrame | null {
  if (sender && typeof sender.origin === 'string' && sender.origin.length > 0) {
    return { origin: sender.origin, url: typeof sender.url === 'string' && sender.url ? sender.url : sender.origin };
  }
  return null;
}

/** The one function `chrome.runtime.onMessage` should call. Wires the
 * sender-derived trusted frame into handleBridgeMessage so the override is
 * exercised by a unit test rather than only by an untested closure inside
 * the background entrypoint. */
export async function routeRuntimeMessage(
  msg: unknown,
  sender: MessageSenderLike | undefined,
  pm: PortManager,
): Promise<NmhResponse> {
  return handleBridgeMessage(msg, pm, trustedFrame(sender) ?? undefined);
}
