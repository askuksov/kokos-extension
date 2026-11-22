import { listEnabledSites, disableSite } from '../../lib/site-access';
import { listIgnoredSaveSites, removeSaveIgnore } from '../../lib/save-ignore';
import { buildSiteRow, buildToggleRow, createQueue } from '../../lib/options-view';
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

// One queue per list: a row action, the redraw after it and a storage-driven
// redraw never overlap, so no update is lost and no row is drawn twice.
const queues = new Map<string, ReturnType<typeof createQueue>>();

function renderList(
  boxId: string,
  load: () => Promise<string[]>,
  actionLabel: string,
  act: (origin: string) => Promise<void>,
): Promise<void> {
  let queue = queues.get(boxId);
  if (!queue) { queue = createQueue(); queues.set(boxId, queue); }
  const run = queue;
  const draw = () => drawList(boxId, load, actionLabel, onAction);
  const onAction = async (origin: string): Promise<void> => {
    // Disable the whole list while the action runs; the redraw replaces the buttons.
    const buttons = Array.from(document.getElementById(boxId)!.querySelectorAll('button'));
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await run(async () => {
        try { await act(origin); } finally { await draw(); }
      });
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  };
  return run(draw);
}

async function drawList(
  boxId: string,
  load: () => Promise<string[]>,
  actionLabel: string,
  onAction: (origin: string) => Promise<void>,
): Promise<void> {
  const box = document.getElementById(boxId)!;
  const sites = await load();
  box.textContent = '';
  if (sites.length === 0) {
    const p = document.createElement('div'); p.className = 'empty'; p.textContent = t('optNoSites');
    box.appendChild(p);
    return;
  }
  for (const origin of sites) box.appendChild(buildSiteRow(origin, actionLabel, onAction));
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
