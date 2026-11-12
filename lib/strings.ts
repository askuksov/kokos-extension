// lib/strings.ts
// Central English string catalog + t(). No _locales yet: extension i18n follows
// the BROWSER locale, which cannot track the app's in-app language without a new
// NMH action (a forbidden app change), so parity is deferred; centralizing here
// makes a future _locales drop-in cheap. A wrong key is a compile error (StringKey).

export const STRINGS = {
  // popup — status / chrome
  noFillableSite: 'No fillable site in this tab.',
  unlockToFill: 'Unlock Kokos to fill.',
  openKokos: 'Open Kokos to continue.',
  enableHere: 'Enable Kokos here',
  disableHere: 'Disable Kokos here',
  stateReady: 'Connected',
  stateLocked: 'Locked',
  stateOffline: 'Not running',
  // popup — save flow
  unlockThenReopenSave: 'Unlock Kokos, then reopen to save this login.',
  updatePrompt: 'Update password in Kokos?',
  savePrompt: 'Save login to Kokos?',
  update: 'Update',
  save: 'Save',
  notNow: 'Not now',
  neverHere: 'Never on this site',
  confirmInKokos: 'Confirm in Kokos…',
  updated: 'Updated ✓',
  saved: 'Saved ✓',
  cancelledInKokos: 'Cancelled in Kokos.',
  unlockThenReopen: 'Unlock Kokos, then reopen.',
  couldNotSave: 'Could not save — try again.',
  // popup — list / fill / copy
  noLoginsForSite: 'No logins saved for this site.',
  filterPlaceholder: 'Filter…',
  entryFallback: '(entry)',
  filling: 'Filling…',
  enableHereToFill: 'Enable Kokos here to fill.',
  filled: 'Filled ✓',
  noLoginForm: 'No login form on this page.',
  couldNotFill: 'Could not fill — try again.',
  copyUser: 'Copy user',
  copiedUser: 'Copied user ✓',
  copyFailed: 'Copy failed.',
  copyPw: 'Copy pw',
  copiedPassword: 'Copied password ✓',
  couldNotCopy: 'Could not copy — try again.',
  // popup — TOTP
  fill: 'Fill',
  fillCode: 'Fill code',
  copyCode: 'Copy code',
  enableHereToFillCode: 'Enable Kokos here to fill the code.',
  codeFilled: 'Code filled',
  codeCopied: 'Code copied',
  noTotpField: 'No 2FA field on this page.',
  couldNotFillCode: 'Could not fill code — try again.',
  couldNotCopyCode: 'Could not copy code — try again.',
  refresh: 'Refresh',
  validFor: '{0} · valid {1}s',
  // content — generator toast
  genFilled: 'Generated password filled: {0}',
  // page overlay — the native confirm prompt. The app's modal opens
  // in the Kokos window, which a full-screen browser hides completely; these two
  // toasts are the only place the user is actually looking.
  awaitingApproval: 'Waiting for your approval in Kokos — switch to the app.',
  requestDenied: 'Denied in Kokos. Click the key icon to ask again.',
  // page overlay — shown when the browser would not open the save popup itself
  saveHint: 'Kokos can save this login — click the Kokos icon in the toolbar.',
  // popup + options — data sharing consent (Firefox, installed by policy)
  consentTitle: 'Agree to data sharing',
  consentIntro: 'Your organization installed Kokos. Before it can fill or save logins, it needs your agreement to pass this data to the Kokos app:',
  consentItemAddress: 'the address of the active tab, to find matching logins;',
  consentItemLogins: 'usernames and passwords on sites you enable, to fill and save them.',
  consentWhere: 'The data goes only to the Kokos Password Manager app on this computer, never to the developer or anyone else.',
  consentPolicy: 'Privacy policy',
  consentAgree: 'Agree',
  consentLater: 'You can withdraw later in the extension settings.',
  optConsentHeading: 'Data sharing',
  optConsentGranted: 'You agreed to pass page addresses and logins to the Kokos app.',
  optConsentRequired: 'Not agreed. Kokos stays inactive until you agree.',
  optConsentManaged: 'Agreed by your organization’s policy.',
  optConsentWithdraw: 'Withdraw',
  // options page
  optFillHeading: 'Sites where Kokos can fill',
  optSaveOffHeading: 'Saving turned off',
  optDisable: 'Disable',
  optReEnable: 'Re-enable',
  optNoSites: 'No sites yet.',
  optSubtitle: 'Browser extension settings',
  // toolbar badge — tooltips
  badgeDefault: 'Kokos',
  badgeNotRunning: 'Kokos — app not running',
  badgeLocked: 'Kokos — locked',
  badgeNoPermission: 'Kokos — click to enable here',
  badgeNeedsConsent: 'Kokos — open to review data sharing',
  badgeNoLogins: 'Kokos — no logins for this site yet',
  badgeLoginsOne: 'Kokos — 1 login for this site',
  badgeLoginsMany: 'Kokos — {0} logins for this site',
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, ...params: string[]): string {
  return STRINGS[key].replace(/\{(\d+)\}/g, (_m, i) => params[Number(i)] ?? '');
}
