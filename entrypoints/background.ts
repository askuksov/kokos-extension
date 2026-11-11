import { PortManager, type NativePort } from '../lib/port-manager';
import { handleBridgeMessage, routeRuntimeMessage } from '../lib/message-bridge';
import type { NmhResponse } from '../lib/nmh-client';
import { resolveBadge } from '../lib/badge-status';
import { composeStatusIcon } from '../lib/badge-icon';
import { computeProbe, isSettleUpdate, type BadgeDeps } from '../lib/badge-controller';

const SAVE_DOT = '#c0392b'; // red corner dot = a login is pending save on this tab
import { initSiteAccess, isEnabled, originPattern } from '../lib/site-access';
import { routeSaveMessage, type SaveBridgeDeps, type Pending } from '../lib/save-bridge';
import { newGateState } from '../lib/save-prompt-gate';
import { isSaveIgnored, addSaveIgnore } from '../lib/save-ignore';
import { routePickerMessage, type PickerBridgeDeps } from '../lib/picker-bridge';
import { routeShortcutFill, type ShortcutFillDeps } from '../lib/shortcut-fill';
import type { FillEntryResult } from '../lib/entry-picker';
import { resolveFillFrame } from '../lib/frame-target';
import { promptSave, shouldRetry, type SavePromptDeps } from '../lib/save-prompt';

// The one native-port holder for the whole extension.
export default defineBackground(() => {
  const pm = new PortManager(
    (host) => chrome.runtime.connectNative(host) as unknown as NativePort,
  );

  async function isPopupOpen(): Promise<boolean> {
    try {
      const ctx = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.POPUP] });
      return ctx.length > 0;
    } catch { return false; } // getContexts missing: assume closed
  }

  // A site enabled while the popup was gone (Firefox closes it for the
  // permission prompt): reload its active tab so the content script runs.
  // With the popup still open (Chrome), the popup reloads the tab itself.
  initSiteAccess((origins) => {
    void (async () => {
      if (await isPopupOpen()) return;
      const wanted = new Set(origins.map((o) => `${o}/*`));
      // Only the window the user just granted from: another window's tab on
      // the same site may hold an unfinished form.
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      for (const t of tabs) {
        if (typeof t.id !== 'number' || !t.url) continue;
        try { if (wanted.has(originPattern(t.url))) void chrome.tabs.reload(t.id); } catch { /* non-http url */ }
      }
    })();
  });

  const badgeDeps: BadgeDeps = {
    request: (origin, action, payload) => pm.request(origin, action, payload),
    isEnabled,
  };

  // The composited status icon = base logo + a colored corner dot. The base
  // bitmap and each composited ImageData set are cached (few distinct colors).
  // OffscreenCanvas exists in the MV3 service worker; if it is ever absent
  // (Firefox fallback), iconFor returns null and the static default_icon stays.
  let baseIconPromise: Promise<ImageBitmap> | null = null;
  function baseIcon(): Promise<ImageBitmap> {
    if (!baseIconPromise) {
      baseIconPromise = fetch(chrome.runtime.getURL('icon/128.png'))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b));
    }
    return baseIconPromise;
  }
  const iconCache = new Map<string, Record<number, ImageData>>();
  async function iconFor(dot: string | null): Promise<Record<number, ImageData> | null> {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const key = dot ?? 'none';
    const cached = iconCache.get(key);
    if (cached) return cached;
    const img = await composeStatusIcon(await baseIcon(), dot);
    iconCache.set(key, img);
    return img;
  }

  // Composite `dot` onto the icon and push it for the tab. Re-checks `pending`
  // after the (usually cached) compose await so a status paint never clobbers a
  // save that landed mid-compose; a SAVE_DOT paint IS the save, so it never skips.
  async function paintDot(tabId: number, dot: string | null): Promise<void> {
    const imageData = await iconFor(dot);
    if (!imageData) return; // no OffscreenCanvas: leave the static default_icon
    if (dot !== SAVE_DOT && pending.has(tabId)) return;
    void chrome.action.setIcon({ tabId, imageData });
  }

  // Paint the active tab's status: a corner dot on the toolbar icon + the
  // tooltip. Skips while a save is pending (that flow owns the red dot — see
  // saveDeps.setBadge below). url is browser-derived (chrome.tabs.get), never
  // page-supplied. Re-checks `pending` after every await.
  async function refreshBadge(tabId: number): Promise<void> {
    if (pending.has(tabId)) return;
    let url: string | undefined;
    try { url = (await chrome.tabs.get(tabId))?.url; } catch { return; } // tab gone
    if (pending.has(tabId)) return;
    const v = resolveBadge(await computeProbe(badgeDeps, url));
    if (pending.has(tabId)) return;
    void chrome.action.setTitle({ tabId, title: v.title });
    await paintDot(tabId, v.dot);
  }

  // Per-tab trailing debounce: onUpdated fires repeatedly per navigation; one
  // NMH round-trip per settle, not per event.
  const refreshTimers = new Map<number, ReturnType<typeof setTimeout>>();
  function scheduleRefresh(tabId: number): void {
    const prev = refreshTimers.get(tabId);
    if (prev) clearTimeout(prev);
    refreshTimers.set(tabId, setTimeout(() => { refreshTimers.delete(tabId); void refreshBadge(tabId); }, 150));
  }

  const pending = new Map<number, Pending>();
  const captureSeq = new Map<number, number>();

  // Auto-open the save popup after a capture (see lib/save-prompt.ts).
  // promptedAt: tab -> capture time, for the one retry after the submit's navigation.
  const promptedAt = new Map<number, number>();
  const promptDeps: SavePromptDeps = {
    getTab: async (tabId) => {
      try {
        const t = await chrome.tabs.get(tabId);
        return { active: t.active, windowId: t.windowId };
      } catch { return undefined; } // tab gone
    },
    isPopupOpen,
    openPopup: async (windowId) => { await chrome.action.openPopup({ windowId }); },
    showHint: (tabId) => new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'save-hint' }, { frameId: 0 }, (r?: { ok?: boolean }) =>
        resolve(!chrome.runtime.lastError && r?.ok === true));
    }),
  };

  const saveDeps: SaveBridgeDeps = {
    ownId: chrome.runtime.id,
    request: (origin, action, payload) => pm.request(origin, action, payload),
    isEnabled,
    isSaveIgnored,
    addSaveIgnore,
    setBadge: (tabId, on) => {
      // Same corner-dot indicator as the status flow, red = pending save.
      if (on) void paintDot(tabId, SAVE_DOT);
      // Save cleared → restore the status dot (pending already deleted by the
      // caller, so refreshBadge won't skip).
      else void refreshBadge(tabId);
    },
    promptSave: (tabId) => {
      promptedAt.set(tabId, Date.now());
      void promptSave(tabId, promptDeps);
    },
    now: () => Date.now(),
    newToken: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    gate: newGateState(),
    pending,
    captureSeq,
  };

  const pickerDeps: PickerBridgeDeps = {
    ownId: chrome.runtime.id,
    request: (origin, action, payload) => pm.request(origin, action, payload),
    getTabUrl: async (tabId) => {
      try { return (await chrome.tabs.get(tabId))?.url; } catch { return undefined; }
    },
  };

  // Keyboard shortcut: fill the best-match login on the active tab. The url is
  // browser-derived (pickerDeps.getTabUrl); the fill runs in the content script via
  // the existing sender.id-guarded fill-entry receiver, so no secret touches the SW.
  const shortcutDeps: ShortcutFillDeps = {
    getTabUrl: pickerDeps.getTabUrl,
    request: (origin, action, payload) => pm.request(origin, action, payload),
    dispatchFill: async (tabId, entryId, username) => {
      const frameId = await resolveFillFrame(tabId, 'login');
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'fill-entry', entryId, username },
          { frameId },
          (r: FillEntryResult) => resolve(chrome.runtime.lastError ? undefined : r),
        );
      });
    },
  };
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'fill-best-match') return;
    if (typeof tab?.id === 'number') { void routeShortcutFill(tab.id, shortcutDeps); return; }
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (typeof t?.id === 'number') void routeShortcutFill(t.id, shortcutDeps);
    });
  });

  // Bound a held capture without any new permission: clear on tab close and on a
  // best-effort origin change (changeInfo.url is delivered for a tab we hold host
  // permission for). Read-time TTL + token supersession bound it otherwise.
  chrome.tabs.onRemoved.addListener((tabId) => {
    pending.delete(tabId);
    promptedAt.delete(tabId);
    captureSeq.delete(tabId);
    // Tab is gone; its per-tab icon dies with it — nothing to reset.
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    const p = pending.get(tabId);
    if (!p || typeof info.url !== 'string') return;
    try {
      if (new URL(info.url).origin !== p.origin) {
        pending.delete(tabId);
        scheduleRefresh(tabId); // new origin: repaint status for the new page (coalesced with the settle listener)
      }
    } catch { /* unparseable url: leave it to the TTL */ }
  });
  // The submit's navigation can close the auto-opened popup or drop the page
  // hint with the old page: retry once when the next page finishes loading.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    const at = promptedAt.get(tabId);
    if (at === undefined) return;
    promptedAt.delete(tabId);
    if (pending.has(tabId) && shouldRetry(at, Date.now())) void promptSave(tabId, promptDeps);
  });

  // Content scripts / popup send { type:'nmh-request', origin, action, payload }.
  // routeRuntimeMessage derives the trusted frame from `sender` (unspoofable —
  // set by the browser) and overrides any page-supplied origin/url with it.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const type = (msg as { type?: string })?.type;
    if (type === 'nmh-request') {
      routeRuntimeMessage(msg, sender, pm).then(
        (res: NmhResponse) => sendResponse(res),
        () => sendResponse({ id: 'invalid', ok: false, error: { code: 'app_not_running', message: 'bridge failure' } }),
      );
      return true; // async sendResponse
    }
    if (type === 'list-site-logins' || type === 'copy-secret' || type === 'copy-totp') {
      routePickerMessage(msg, sender, pickerDeps).then(
        (res) => sendResponse(res ?? { ok: false, code: 'bad_request' }),
        () => sendResponse({ ok: false, code: 'internal' }),
      );
      return true; // async sendResponse
    }
    // Save flow.
    routeSaveMessage(msg, sender, saveDeps).then(
      (res) => sendResponse(res ?? { ok: false, code: 'bad_request' }),
      () => sendResponse({ ok: false, code: 'internal' }),
    );
    return true;
  });

  // Lazy, event-driven badge refresh. Only the active
  // tab is refreshed; background tabs keep their last badge until revisited.
  chrome.tabs.onActivated.addListener(({ tabId }) => scheduleRefresh(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (isSettleUpdate(info)) scheduleRefresh(tabId); });
  chrome.windows.onFocusChanged.addListener((winId) => {
    if (winId === chrome.windows.WINDOW_ID_NONE) return;
    void chrome.tabs.query({ active: true, windowId: winId }).then(([t]) => {
      if (typeof t?.id === 'number') scheduleRefresh(t.id);
    });
  });
  // Initial paint on service-worker start.
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
    if (typeof t?.id === 'number') void refreshBadge(t.id);
  });

  // Dev smoke hook — no sender, so no trusted frame; reads only, never a secret.
  // Drive from the service-worker console:
  //   await self.__kokos.getLogins('https://example.com')
  (self as any).__kokos = {
    ping: (origin = 'https://example.com') =>
      handleBridgeMessage({ type: 'nmh-request', origin, action: 'ping', payload: {} }, pm),
    getStatus: (origin = 'https://example.com') =>
      handleBridgeMessage({ type: 'nmh-request', origin, action: 'get_status', payload: {} }, pm),
    getLogins: (url: string) =>
      handleBridgeMessage({ type: 'nmh-request', origin: url, action: 'get_logins', payload: { url } }, pm),
  };
});
