// Per-site "never save here" opt-out. Non-secret origin list in
// chrome.storage.local, independent of the enabledSites fill opt-in (fill-yes /
// save-no is valid). Save-capture already runs only on enabled sites; this is
// the finer opt-out within an enabled site.

const STORAGE_KEY = 'ignoredSaveSites';

function originOf(url: string): string {
  return new URL(url).origin;
}

async function getList(): Promise<string[]> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const v = (got as Record<string, unknown>)[STORAGE_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

export async function isSaveIgnored(url: string): Promise<boolean> {
  return (await getList()).includes(originOf(url));
}

export async function addSaveIgnore(url: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...new Set([...(await getList()), originOf(url)])] });
}

export async function removeSaveIgnore(url: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: (await getList()).filter((o) => o !== originOf(url)) });
}

export async function listIgnoredSaveSites(): Promise<string[]> {
  return getList();
}
