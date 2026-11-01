import { listEnabledSites, disableSite } from '../../lib/site-access';
import { listIgnoredSaveSites, removeSaveIgnore } from '../../lib/save-ignore';
import { buildSiteRow } from '../../lib/options-view';
import { t } from '../../lib/strings';

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
  document.getElementById('fill-h')!.textContent = t('optFillHeading');
  document.getElementById('save-h')!.textContent = t('optSaveOffHeading');
  void renderList('fill-list', listEnabledSites, t('optDisable'), disableSite);
  void renderList('save-list', listIgnoredSaveSites, t('optReEnable'), removeSaveIgnore);
}

main();
