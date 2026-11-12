// Pure probe→status mapping. No chrome.*/DOM — fully unit-testable. The four
// connection states collapse onto one corner dot color on the toolbar icon
// (rendered by badge-icon.ts). `dot === null` = no dot (plain logo).
import { t } from './strings';

export type Probe =
  | { kind: 'not-running' }
  | { kind: 'locked' }
  | { kind: 'no-permission' }
  | { kind: 'needs-consent' }
  | { kind: 'permitted'; count: number };

export interface BadgeVisual {
  dot: string | null; // corner-dot color; null = no dot (plain logo)
  title: string;      // action tooltip (carries the count for the permitted state)
}

const GRAY = '#9aa0a6';
const BLUE = '#4a90d9';
const AMBER = '#f5a623'; // enabled + unlocked but 0 logins saved for this site
const GREEN = '#2e7d32';

/** null probe = the active tab is not a fillable http(s) page → plain logo, no dot. */
export function resolveBadge(probe: Probe | null): BadgeVisual {
  if (probe === null) return { dot: null, title: t('badgeDefault') };
  switch (probe.kind) {
    case 'not-running':
      return { dot: null, title: t('badgeNotRunning') };
    case 'locked':
      return { dot: GRAY, title: t('badgeLocked') };
    case 'no-permission':
      return { dot: BLUE, title: t('badgeNoPermission') };
    case 'needs-consent':
      return { dot: BLUE, title: t('badgeNeedsConsent') };
    case 'permitted': {
      const n = probe.count;
      // Green ONLY when there is at least one login to fill; amber = enabled
      // but nothing saved for this site yet.
      if (n <= 0) return { dot: AMBER, title: t('badgeNoLogins') };
      return { dot: GREEN, title: n === 1 ? t('badgeLoginsOne') : t('badgeLoginsMany', String(n)) };
    }
  }
}

/** Interpret a get_logins failure on an enabled site: 'locked' is locked,
 * 'consent_required' means the user has not agreed to data sharing yet; every
 * other code (app_not_running, internal, timeout…) means unreachable. */
export function mapErrCode(code: string | undefined): Probe {
  if (code === 'locked') return { kind: 'locked' };
  if (code === 'consent_required') return { kind: 'needs-consent' };
  return { kind: 'not-running' };
}
