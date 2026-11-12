// lib/data-consent.ts
// Data-sharing consent for Firefox installs made by an enterprise policy.
//
// Firefox shows its built-in consent prompt for data_collection_permissions on
// a normal install, but not when an administrator installs the add-on through
// the ExtensionSettings policy. Mozilla's rule for that case: the add-on shows
// its own disclosure and asks for consent, unless the administrator already
// granted it through the 3rdparty policy (read here from storage.managed).
// Until consent is given, nothing that carries user data goes to the app:
// see FREE_ACTIONS and the gate in PortManager.

/** policies.json: 3rdparty > Extensions > kokos-password-manager@kuksov.dev > dataCollectionConsent: true */
export const MANAGED_CONSENT_KEY = 'dataCollectionConsent';
/** storage.local: 'granted' after the user clicked Agree in the popup. */
export const LOCAL_CONSENT_KEY = 'dataConsent';
/** Error code of a request the gate refused. Local to the extension, never sent by the app. */
export const CONSENT_REQUIRED = 'consent_required';

/** Requests that carry no user data: no page address, no login, no secret. */
const FREE_ACTIONS = new Set(['ping', 'get_status', 'generate_password']);

export function isFreeAction(action: string): boolean {
  return FREE_ACTIONS.has(action);
}

export interface ConsentEnv {
  isFirefox: boolean;
  installType: string | undefined; // management.getSelf().installType
  managed: unknown;                // storage.managed value of MANAGED_CONSENT_KEY
  local: unknown;                  // storage.local value of LOCAL_CONSENT_KEY
}

/**
 * - 'not-needed': the browser asked at install (any non-policy install, and Chrome)
 * - 'managed': the administrator granted it in the policy; the user cannot change it
 * - 'granted': the user agreed in the popup
 * - 'required': ask before sending any user data
 */
export type ConsentState = 'not-needed' | 'managed' | 'granted' | 'required';

// The policy value arrives as JSON true from policies.json, but as the number 1
// from a macOS configuration profile or `defaults`, and may be a string from
// other tooling. Anything else, false included, counts as not granted.
const MANAGED_YES = new Set<unknown>([true, 1, '1', 'true']);

export function consentState(env: ConsentEnv): ConsentState {
  if (!env.isFirefox || env.installType !== 'admin') return 'not-needed';
  if (MANAGED_YES.has(env.managed)) return 'managed';
  if (env.local === 'granted') return 'granted';
  return 'required';
}

export function consentAllows(state: ConsentState, action: string): boolean {
  return state !== 'required' || isFreeAction(action);
}

/** Browser-bound reader. The consent values fail closed to "not set". A failed
 * install-type read rejects instead: an unknown install type would otherwise
 * read as "not a policy install" and skip consent, so the caller falls back to
 * 'required'. */
export async function readConsentEnv(isFirefox: boolean): Promise<ConsentEnv> {
  if (!isFirefox) return { isFirefox, installType: undefined, managed: undefined, local: undefined };
  const installType = (await chrome.management.getSelf()).installType;
  let managed: unknown;
  // storage.managed rejects when no policy sets anything for this add-on.
  try { managed = (await chrome.storage.managed.get(MANAGED_CONSENT_KEY))[MANAGED_CONSENT_KEY]; } catch { managed = undefined; }
  let local: unknown;
  try { local = (await chrome.storage.local.get(LOCAL_CONSENT_KEY))[LOCAL_CONSENT_KEY]; } catch { local = undefined; }
  return { isFirefox, installType, managed, local };
}

export async function setLocalConsent(granted: boolean): Promise<void> {
  if (granted) await chrome.storage.local.set({ [LOCAL_CONSENT_KEY]: 'granted' });
  else await chrome.storage.local.remove(LOCAL_CONSENT_KEY);
}
