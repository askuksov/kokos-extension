import { listEnabledSites, disableSite } from '../../lib/site-access';
import { listIgnoredSaveSites, removeSaveIgnore } from '../../lib/save-ignore';
import { buildSiteRow, buildToggleRow } from '../../lib/options-view';
import { loadIconPrefs, setShowIcon, listIconHiddenSites, showIconOn, isIconPrefsChange } from '../../lib/icon-prefs';
import { t } from '../../lib/strings';
import { LOCAL_CONSENT_KEY, MANAGED_CONSENT_KEY, type ConsentState } from '../../lib/data-consent';

function send<T>(message: object): Promise<T | undefined> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (r: T) => resolve(chrome.runtime.lastError ? undefined : r)));
}

// Data sharing: shown only for a policy-installed Firefox add-on. The user can
// withdraw here; agreeing again happens in the toolbar popup, next to the disclosure.
async function renderConsent(): Promise<void> {
  const section = document.getElementById('consent')!;
  const r = await send<{ state: ConsentState }>({ type: 'get-consent' });
  const state = r?.state;
  if (!state || state === 'not-needed') { section.hidden = true; return; }
  section.hidden = false;
  document.getElementById('consent-h')!.textContent = t('optConsentHeading');
  const text = document.getElementById('consent-text')!;
  const btn = document.getElementById('consent-btn') as HTMLButtonElement;
  text.textContent = state === 'managed' ? t('optConsentManaged')
    : state === 'granted' ? t('optConsentGranted') : t('optConsentRequired');
  btn.hidden = state !== 'granted';
  btn.textContent = t('optConsentWithdraw');
  btn.onclick = async () => {
    btn.disabled = true;
    await send({ type: 'set-consent', granted: false });
    btn.disabled = false;
    await renderConsent();
  };
}

async function renderList(
  boxId: string,
  load: () => Promise<string[]>,
  actionLabel: string,
  act: (origin: string) => Promise<void>,
): Promise<void> {
  const box = document.getElementById(boxId)!;
  const sites = await load();
  // Cleared after the read, not before: two overlapping renders (an action's own
  // redraw and the storage.onChanged one) would otherwise both append their rows.
  box.textContent = '';
  if (sites.length === 0) {
    const p = document.createElement('div'); p.className = 'empty'; p.textContent = t('optNoSites');
    box.appendChild(p);
    return;
  }
  for (const origin of sites) {
    box.appendChild(buildSiteRow(origin, actionLabel, async (o) => {
      await act(o);
      await renderList(boxId, load, actionLabel, act);
    }));
  }
}

// In-field icon: global switch + the sites where the popup hid it.
async function renderIcon(): Promise<void> {
  const prefs = await loadIconPrefs();
  const sw = document.getElementById('icon-switch')!;
  sw.textContent = '';
  sw.appendChild(buildToggleRow(t('optIconToggle'), prefs.showIcon, setShowIcon));
  await renderList('icon-hidden-list', listIconHiddenSites, t('optShowIcon'), showIconOn);
}

function main(): void {
  const sub = document.getElementById('sub');
  if (sub) sub.textContent = t('optSubtitle');
  document.getElementById('fill-h')!.textContent = t('optFillHeading');
  document.getElementById('save-h')!.textContent = t('optSaveOffHeading');
  document.getElementById('icon-h')!.textContent = t('optIconHeading');
  document.getElementById('icon-note')!.textContent = t('optIconNote');
  document.getElementById('icon-hidden-h')!.textContent = t('optIconHiddenHeading');
  void renderConsent();
  // Consent can change while this page is open (Agree in the popup, a new
  // policy): redraw on the storage change and whenever the page is shown again.
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && LOCAL_CONSENT_KEY in changes) || (area === 'managed' && MANAGED_CONSENT_KEY in changes)) {
      void renderConsent();
    }
    // The popup hid or showed the icon for a site while this page is open.
    if (isIconPrefsChange(changes, area)) void renderIcon();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void renderConsent(); });
  void renderIcon();
  void renderList('fill-list', listEnabledSites, t('optDisable'), disableSite);
  void renderList('save-list', listIgnoredSaveSites, t('optReEnable'), removeSaveIgnore);
}

main();
