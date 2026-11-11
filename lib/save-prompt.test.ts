import { describe, it, expect, vi } from 'vitest';
import { promptSave, shouldRetry, RETRY_WINDOW_MS, type SavePromptDeps } from './save-prompt';

function makeDeps(over: Partial<SavePromptDeps> = {}): SavePromptDeps {
  return {
    getTab: vi.fn(async () => ({ active: true, windowId: 3 })),
    isPopupOpen: vi.fn(async () => false),
    openPopup: vi.fn(async () => {}),
    showHint: vi.fn(async () => true),
    ...over,
  };
}

describe('promptSave', () => {
  it('opens the popup in the tab window', async () => {
    const deps = makeDeps();
    expect(await promptSave(7, deps)).toBe('popup');
    expect(deps.openPopup).toHaveBeenCalledWith(3);
    expect(deps.showHint).not.toHaveBeenCalled();
  });
  it('does nothing for a background tab', async () => {
    const deps = makeDeps({ getTab: vi.fn(async () => ({ active: false, windowId: 3 })) });
    expect(await promptSave(7, deps)).toBe('none');
    expect(deps.openPopup).not.toHaveBeenCalled();
    expect(deps.showHint).not.toHaveBeenCalled();
  });
  it('does nothing for a closed tab', async () => {
    const deps = makeDeps({ getTab: vi.fn(async () => undefined) });
    expect(await promptSave(7, deps)).toBe('none');
    expect(deps.openPopup).not.toHaveBeenCalled();
  });
  it('leaves an already open popup alone', async () => {
    const deps = makeDeps({ isPopupOpen: vi.fn(async () => true) });
    expect(await promptSave(7, deps)).toBe('popup');
    expect(deps.openPopup).not.toHaveBeenCalled();
  });
  it('falls back to the page hint when the browser refuses the popup', async () => {
    const deps = makeDeps({ openPopup: vi.fn(async () => { throw new Error('no user gesture'); }) });
    expect(await promptSave(7, deps)).toBe('hint');
    expect(deps.showHint).toHaveBeenCalledWith(7);
  });
  it('reports none when neither the popup nor the hint could be shown', async () => {
    const deps = makeDeps({
      openPopup: vi.fn(async () => { throw new Error('no window'); }),
      showHint: vi.fn(async () => false),
    });
    expect(await promptSave(7, deps)).toBe('none');
  });
});

describe('shouldRetry', () => {
  it('retries inside the window after the capture', () => {
    expect(shouldRetry(1000, 1000 + RETRY_WINDOW_MS)).toBe(true);
  });
  it('does not retry after the window', () => {
    expect(shouldRetry(1000, 1001 + RETRY_WINDOW_MS)).toBe(false);
  });
  it('does not retry without a capture', () => {
    expect(shouldRetry(undefined, 1000)).toBe(false);
  });
});
