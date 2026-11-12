import { listEnabledSites, disableSite } from '../../lib/site-access';
import { listIgnoredSaveSites, removeSaveIgnore } from '../../lib/save-ignore';
import { buildSiteRow } from '../../lib/options-view';
import { t } from '../../lib/strings';
import type { ConsentState } from '../../lib/data-consent';

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
  box.textContent = '';
  const sites = await load();
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

function main(): void {
  const sub = document.getElementById('sub');
  if (sub) sub.textContent = t('optSubtitle');
  document.getElementById('fill-h')!.textContent = t('optFillHeading');
  document.getElementById('save-h')!.textContent = t('optSaveOffHeading');
  void renderConsent();
  void renderList('fill-list', listEnabledSites, t('optDisable'), disableSite);
  void renderList('save-list', listIgnoredSaveSites, t('optReEnable'), removeSaveIgnore);
}

main();
