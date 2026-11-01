// Orchestrates ONE native call per refresh and returns a Probe (or null for a
// non-http tab). chrome.*-free (deps injected) so the whole decision is unit-
// testable — mirrors picker-bridge.ts. The url is browser-derived by the caller.
import { mapErrCode, type Probe } from './badge-status';
import type { NmhResponse, GetLoginsResult, GetStatusResult } from './nmh-client';

export interface BadgeDeps {
  request(origin: string, action: string, payload: object): Promise<NmhResponse>;
  isEnabled(url: string): Promise<boolean>;
}

function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** null = not a fillable http(s) page (caller clears the badge). Otherwise the
 * probe is derived from exactly one native call: get_logins for an enabled site
 * (its result yields the count; its error code yields locked/not-running), or
 * get_status for a non-enabled site (running/locked/no-permission). */
export async function computeProbe(deps: BadgeDeps, url: string | undefined): Promise<Probe | null> {
  const origin = httpOrigin(url);
  if (!url || !origin) return null;

  if (await deps.isEnabled(url)) {
    const r = await deps.request(origin, 'get_logins', { url });
    if (r.ok && r.payload) return { kind: 'permitted', count: (r.payload as GetLoginsResult).items?.length ?? 0 };
    return mapErrCode(r.error?.code);
  }

  const r = await deps.request(origin, 'get_status', {});
  if (!r.ok) return { kind: 'not-running' };
  return (r.payload as GetStatusResult)?.locked ? { kind: 'locked' } : { kind: 'no-permission' };
}

/** A tabs.onUpdated change worth a refresh: the page finished loading, or its
 * url changed. Filters the many partial 'loading' events per navigation. */
export function isSettleUpdate(info: { status?: string; url?: string }): boolean {
  return info.status === 'complete' || typeof info.url === 'string';
}
