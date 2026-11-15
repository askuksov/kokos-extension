// tests/content-icons.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as any).defineContentScript ??= (cfg: unknown) => cfg;

const { scanFieldIcons } = await import('../entrypoints/content');

function fakeOverlay() {
  return { showIcon: vi.fn(), hide: vi.fn(), showGeneratorIcon: vi.fn(), hideGenerator: vi.fn() };
}

const LOGIN = `<form>
  <input name="username" type="text" autocomplete="username">
  <input name="password" type="password" autocomplete="current-password">
</form>`;
const SIGNUP = `<form><input type="password" autocomplete="new-password"></form>`;

beforeEach(() => { document.body.innerHTML = ''; });

describe('scanFieldIcons', () => {
  it('shows the key icon on the password field when icons are on', () => {
    document.body.innerHTML = LOGIN;
    const overlay = fakeOverlay();
    const onOffer = vi.fn();
    scanFieldIcons({ doc: document, overlay, iconsOn: true, onOffer, onGenerate: vi.fn() });
    expect(overlay.showIcon).toHaveBeenCalledTimes(1);
    const [field, click] = overlay.showIcon.mock.calls[0]!;
    expect((field as HTMLInputElement).type).toBe('password');
    (click as () => void)();
    expect(onOffer).toHaveBeenCalledWith(field, expect.objectContaining({ password: field }));
  });
  it('shows the wand on a signup form when icons are on', () => {
    document.body.innerHTML = SIGNUP;
    const overlay = fakeOverlay();
    scanFieldIcons({ doc: document, overlay, iconsOn: true, onOffer: vi.fn(), onGenerate: vi.fn() });
    expect(overlay.showGeneratorIcon).toHaveBeenCalledTimes(1);
  });
  it('draws nothing and hides both icons when icons are off', () => {
    document.body.innerHTML = LOGIN + SIGNUP;
    const overlay = fakeOverlay();
    scanFieldIcons({ doc: document, overlay, iconsOn: false, onOffer: vi.fn(), onGenerate: vi.fn() });
    expect(overlay.showIcon).not.toHaveBeenCalled();
    expect(overlay.showGeneratorIcon).not.toHaveBeenCalled();
    expect(overlay.hide).toHaveBeenCalled();
    expect(overlay.hideGenerator).toHaveBeenCalled();
  });
});
