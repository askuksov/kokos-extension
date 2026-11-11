// Brings a held save capture in front of the user. The red dot on the toolbar
// icon is easy to miss, so after a capture the background opens the popup
// itself (action.openPopup without a user gesture: Chrome 127+, Firefox 149+).
// When the browser refuses (older Firefox, window not focused) the top frame
// shows a text-only hint instead. The hint carries no buttons, so the page can
// never drive a save: commit stays popup-only.
// Chrome-free (deps injected) so the decision logic is unit-testable.

export type PromptResult = 'popup' | 'hint' | 'none';

export interface SavePromptDeps {
  getTab(tabId: number): Promise<{ active: boolean; windowId: number } | undefined>;
  isPopupOpen(): Promise<boolean>;
  openPopup(windowId: number): Promise<void>;
  showHint(tabId: number): Promise<boolean>;
}

export async function promptSave(tabId: number, deps: SavePromptDeps): Promise<PromptResult> {
  const tab = await deps.getTab(tabId);
  // A background tab keeps the red dot only: popping a popup over the tab the
  // user is looking at would offer a save for a different page.
  if (!tab || !tab.active) return 'none';
  if (await deps.isPopupOpen()) return 'popup';
  try {
    await deps.openPopup(tab.windowId);
    return 'popup';
  } catch {
    return (await deps.showHint(tabId)) ? 'hint' : 'none';
  }
}

// A classic form submit navigates right after the capture, which can close the
// popup or drop the hint with the old page. The background retries once when
// that navigation finishes, but only shortly after the capture: a later
// same-origin page load must not pop the popup again after the user closed it.
export const RETRY_WINDOW_MS = 15_000;

export function shouldRetry(capturedAt: number | undefined, now: number): boolean {
  return capturedAt !== undefined && now - capturedAt <= RETRY_WINDOW_MS;
}
