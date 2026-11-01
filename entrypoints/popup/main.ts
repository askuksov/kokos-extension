import { enableSite, disableSite, isEnabled } from '../../lib/site-access';
import type { NmhResponse, GetStatusResult, LoginItem } from '../../lib/nmh-client';
import type { PendingView } from '../../lib/save-bridge';
import { filterEntries, isNearExpiry, type PickerListResult, type PickerSecretResult, type FillEntryResult, type TotpFillResult, type CopyTotpResult } from '../../lib/entry-picker';
import { t } from '../../lib/strings';

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send<T>(message: object): Promise<T | undefined> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (r: T) => resolve(chrome.runtime.lastError ? undefined : r)));
}

function statusVia(origin: string): Promise<NmhResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'nmh-request', origin, action: 'get_status', payload: {} }, (r: NmhResponse) =>
      resolve(chrome.runtime.lastError || !r ? { id: 'x', ok: false, error: { code: 'app_not_running', message: 'no app' } } : r),
    );
  });
}

function pendingVia(tabId: number): Promise<PendingView> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'get-pending-save', tabId }, (r: PendingView) =>
      resolve(chrome.runtime.lastError || !r ? { present: false } : r));
  });
}
function saveMsg<T>(message: object): Promise<T> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (r: T) => resolve(r)));
}

async function writeClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; } finally { ta.remove(); }
  return ok;
}

async function renderSave(tab: chrome.tabs.Tab): Promise<void> {
  const box = document.getElementById('save')!;
  box.textContent = '';
  if (tab.id == null) return;
  const view = await pendingVia(tab.id);
  if (!view.present) return;

  if (view.locked) {
    const p = document.createElement('div'); p.className = 'hint';
    p.textContent = t('unlockThenReopenSave');
    box.appendChild(p);
    return;
  }

  const isUpdate = view.mode === 'update';
  const head = document.createElement('div'); head.className = 'row';
  head.textContent = isUpdate ? t('updatePrompt') : t('savePrompt');
  const who = document.createElement('div'); who.className = 'user';
  who.textContent = view.username ? `${view.username} · ${view.site ?? ''}` : (view.site ?? '');
  box.append(head, who);

  const status = document.createElement('div'); status.className = 'status hint';

  const primary = document.createElement('button');
  primary.textContent = isUpdate ? t('update') : t('save');

  const dismiss = document.createElement('button'); dismiss.className = 'ghost'; dismiss.textContent = t('notNow');
  dismiss.onclick = async () => { await saveMsg({ type: 'dismiss-pending-save', tabId: tab.id }); box.textContent = ''; };

  const never = document.createElement('button'); never.className = 'ghost'; never.textContent = t('neverHere');
  never.onclick = async () => { await saveMsg({ type: 'never-save-here', tabId: tab.id }); box.textContent = ''; };

  const finish = (text: string) => { status.textContent = text; primary.disabled = dismiss.disabled = never.disabled = true; };

  primary.onclick = async () => {
    primary.disabled = true; status.textContent = t('confirmInKokos');
    const res = await saveMsg<{ ok: boolean; error?: { code: string } }>({ type: 'commit-pending-save', tabId: tab.id });
    if (res?.ok) finish(isUpdate ? t('updated') : t('saved'));
    else if (res?.error?.code === 'denied') finish(t('cancelledInKokos'));
    else if (res?.error?.code === 'locked') finish(t('unlockThenReopen'));
    else { primary.disabled = false; status.textContent = t('couldNotSave'); }
  };

  box.append(primary, dismiss, never, status);
}

// Per-site login picker. Only rendered when Kokos is running + unlocked.
async function renderList(tab: chrome.tabs.Tab): Promise<void> {
  const box = document.getElementById('list')!;
  box.textContent = '';
  if (tab.id == null) return;
  const res = await send<PickerListResult>({ type: 'list-site-logins', tabId: tab.id });
  if (!res || !res.ok) return; // locked/app already surfaced by the status hint; stay quiet otherwise
  const items = res.items;
  if (items.length === 0) {
    const p = document.createElement('div'); p.className = 'hint';
    p.textContent = t('noLoginsForSite');
    box.appendChild(p);
    return;
  }

  const status = document.createElement('div'); status.className = 'status hint';
  const rows = document.createElement('div');
  const draw = (list: LoginItem[]) => {
    rows.textContent = '';
    for (const it of list) rows.appendChild(buildRow(tab.id!, it, status));
  };

  if (items.length > 4) {
    const filter = document.createElement('input');
    filter.type = 'search'; filter.placeholder = t('filterPlaceholder'); filter.className = 'filter';
    filter.addEventListener('input', () => draw(filterEntries(items, filter.value)));
    box.appendChild(filter);
  }
  box.appendChild(rows);
  box.appendChild(status);
  draw(items);
}

// After a code is filled/copied, show its validity and — only when near expiry —
// a Refresh affordance that re-runs the action (the 2nd confirm is user-initiated).
function showValidity(status: HTMLElement, actions: HTMLElement, remaining: number, label: string, refresh: () => void): void {
  status.textContent = t('validFor', label, String(remaining));
  actions.querySelector('.refresh')?.remove();
  if (isNearExpiry(remaining)) {
    const r = document.createElement('button'); r.className = 'ghost refresh'; r.textContent = t('refresh');
    r.onclick = () => { status.textContent = t('confirmInKokos'); refresh(); };
    actions.appendChild(r);
  }
}

export function buildRow(tabId: number, it: LoginItem, status: HTMLElement): HTMLElement {
  const row = document.createElement('div'); row.className = 'entry';

  const head = document.createElement('div'); head.className = 'entry-head';
  const title = document.createElement('span'); title.className = 'entry-title';
  title.textContent = it.title || it.username || t('entryFallback');
  head.appendChild(title);
  if (it.username) {
    const u = document.createElement('span'); u.className = 'entry-user'; u.textContent = it.username;
    head.appendChild(u);
  }
  if (it.hasTotp) {
    const dot = document.createElement('span'); dot.className = 'entry-totp'; dot.textContent = 'TOTP';
    head.appendChild(dot);
  }
  row.appendChild(head);

  const actions = document.createElement('div'); actions.className = 'entry-actions';

  const fill = document.createElement('button'); fill.textContent = t('fill');
  fill.onclick = () => {
    status.textContent = t('filling');
    chrome.tabs.sendMessage(tabId, { type: 'fill-entry', entryId: it.id, username: it.username ?? undefined }, { frameId: 0 }, (r: FillEntryResult) => {
      if (chrome.runtime.lastError) { status.textContent = t('enableHereToFill'); return; }
      if (r?.ok) status.textContent = t('filled');
      else if (r && !r.ok && r.reason === 'no-form') status.textContent = t('noLoginForm');
      else status.textContent = t('couldNotFill');
    });
  };
  actions.appendChild(fill);

  if (it.username) {
    const cu = document.createElement('button'); cu.className = 'ghost'; cu.textContent = t('copyUser');
    cu.onclick = async () => { status.textContent = (await writeClipboard(it.username!)) ? t('copiedUser') : t('copyFailed'); };
    actions.appendChild(cu);
  }

  const cp = document.createElement('button'); cp.className = 'ghost'; cp.textContent = t('copyPw');
  cp.onclick = async () => {
    status.textContent = t('confirmInKokos');
    const res = await send<PickerSecretResult>({ type: 'copy-secret', tabId, entryId: it.id });
    if (res && res.ok) {
      let value = res.value;
      const wrote = await writeClipboard(value);
      value = ''; void value; // drop the transient secret immediately
      status.textContent = wrote ? t('copiedPassword') : t('copyFailed');
    } else if (res && res.code === 'denied') status.textContent = t('cancelledInKokos');
    else if (res && res.code === 'locked') status.textContent = t('unlockThenReopen');
    else status.textContent = t('couldNotCopy');
  };
  actions.appendChild(cp);

  if (it.hasTotp) {
    const ft = document.createElement('button'); ft.className = 'ghost'; ft.textContent = t('fillCode');
    const doFillCode = () => {
      status.textContent = t('confirmInKokos');
      chrome.tabs.sendMessage(tabId, { type: 'totp-fill', entryId: it.id }, { frameId: 0 }, (r: TotpFillResult) => {
        if (chrome.runtime.lastError) { status.textContent = t('enableHereToFillCode'); return; }
        if (r?.ok) showValidity(status, actions, r.remaining, t('codeFilled'), doFillCode);
        else if (r && !r.ok && r.reason === 'no-field') status.textContent = t('noTotpField');
        else status.textContent = t('couldNotFillCode');
      });
    };
    ft.onclick = doFillCode;
    actions.appendChild(ft);

    const ct = document.createElement('button'); ct.className = 'ghost'; ct.textContent = t('copyCode');
    const doCopyCode = async () => {
      status.textContent = t('confirmInKokos');
      const res = await send<CopyTotpResult>({ type: 'copy-totp', tabId, entryId: it.id });
      if (res && res.ok) {
        let value = res.code;
        const wrote = await writeClipboard(value);
        value = ''; void value; // drop the transient code immediately
        if (wrote) showValidity(status, actions, res.remaining, t('codeCopied'), doCopyCode);
        else status.textContent = t('copyFailed');
      } else if (res && res.code === 'denied') status.textContent = t('cancelledInKokos');
      else if (res && res.code === 'locked') status.textContent = t('unlockThenReopen');
      else status.textContent = t('couldNotCopyCode');
    };
    ct.onclick = doCopyCode;
    actions.appendChild(ct);
  }

  row.appendChild(actions);
  return row;
}

async function render() {
  const tab = await activeTab();
  const toggle = document.getElementById('toggle') as HTMLButtonElement;
  const siteEl = document.getElementById('site')!;
  const hintEl = document.getElementById('hint')!;
  const listEl = document.getElementById('list')!;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    siteEl.textContent = t('noFillableSite'); toggle.style.display = 'none'; listEl.textContent = '';
    return;
  }
  const url = tab.url;
  siteEl.textContent = new URL(url).hostname;

  const status = await statusVia(new URL(url).origin);
  const locked = !!(status.ok && (status.payload as GetStatusResult)?.locked);
  if (locked) hintEl.textContent = t('unlockToFill');
  else if (!status.ok && status.error?.code === 'app_not_running') hintEl.textContent = t('openKokos');
  else hintEl.textContent = '';

  if (status.ok && !locked) await renderList(tab);
  else listEl.textContent = '';

  const enabled = await isEnabled(url);
  toggle.disabled = false;
  toggle.textContent = enabled ? t('disableHere') : t('enableHere');
  toggle.onclick = async () => {
    toggle.disabled = true;
    if (enabled) await disableSite(url); else await enableSite(url);
    if (tab.id != null) chrome.tabs.reload(tab.id);
    await render();
  };

  await renderSave(tab);
}

void render();
