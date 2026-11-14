// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { isFillableGeometry, positionFor, iconLeftAvoiding, renderMatches, createOverlay, type OverlayMatch } from './overlay';

function stubRect(el: Element, rect: Partial<DOMRect>): void {
  (el as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON() {}, ...rect });
}

describe('isFillableGeometry', () => {
  it('rejects a zero-size field', () => {
    const el = document.createElement('input'); stubRect(el, { width: 0, height: 0, right: 0, bottom: 0 });
    expect(isFillableGeometry(el)).toBe(false);
  });
  it('rejects a field obscured at its centre', () => {
    const el = document.createElement('input'); stubRect(el, {});
    const other = document.createElement('div');
    (document as any).elementFromPoint = vi.fn().mockReturnValue(other);
    expect(isFillableGeometry(el)).toBe(false);
  });
  it('accepts a visible, unobstructed field', () => {
    const el = document.createElement('input'); stubRect(el, {});
    (document as any).elementFromPoint = vi.fn().mockReturnValue(el);
    expect(isFillableGeometry(el)).toBe(true);
  });
  it('rejects a field outside the viewport', () => {
    const el = document.createElement('input'); stubRect(el, { top: -500, bottom: -470, left: 10, right: 110, width: 100, height: 30 });
    (document as any).elementFromPoint = vi.fn().mockReturnValue(el);
    expect(isFillableGeometry(el)).toBe(false);
  });
});

describe('positionFor', () => {
  it('places the icon at the field right edge plus scroll offset', () => {
    const p = positionFor({ left: 10, top: 20, width: 100, height: 30 }, 5, 7);
    expect(p.left).toBe(10 + 5 + 100 - 20 - 4);
    expect(p.top).toBe(20 + 7 + (30 - 20) / 2);
  });
});

describe('iconLeftAvoiding', () => {
  // Field 10..210 x 10..34; the icon's default spot is left = 210 - 20 - 4 = 186.
  function setup(atPoint: (x: number) => Element[]) {
    document.body.innerHTML = '';
    const wrap = document.createElement('div');
    const field = document.createElement('input');
    const eye = document.createElement('button');
    wrap.append(field, eye);
    document.body.appendChild(wrap);
    stubRect(field, { left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34 });
    stubRect(eye, { left: 180, top: 12, width: 24, height: 20, right: 204, bottom: 32 });
    (document as any).elementsFromPoint = vi.fn((x: number) => atPoint(x).concat(wrap, document.body));
    return { field, eye, wrap };
  }

  it('keeps the right-edge spot when the field itself is on top', () => {
    const { field } = setup(() => []);
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(186);
  });

  it('moves left of a show-password button drawn over the edge', () => {
    let field!: HTMLInputElement;
    const s = setup((x) => (x >= 180 ? [s.eye] : [field]));
    field = s.field as HTMLInputElement;
    expect(iconLeftAvoiding(field, document, null)).toBe(180 - 20 - 4);
  });

  it('treats an svg inside the button as the button', () => {
    let field!: HTMLInputElement;
    const s = setup((x) => (x >= 180 ? [svg] : [field]));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.eye.appendChild(svg);
    stubRect(svg, { left: 186, top: 14, width: 12, height: 12, right: 198, bottom: 26 });
    field = s.field as HTMLInputElement;
    expect(iconLeftAvoiding(field, document, null)).toBe(180 - 20 - 4); // the button's edge, not the glyph's
  });

  it('moves left of a control that covers only the icon\'s right part', () => {
    // Icon spans 186..206; a button at 200..210 misses the centre (196).
    let field!: HTMLInputElement;
    const s = setup((x) => (x >= 200 ? [s.eye] : [field]));
    stubRect(s.eye, { left: 200, top: 12, width: 10, height: 20, right: 210, bottom: 32 });
    field = s.field as HTMLInputElement;
    expect(iconLeftAvoiding(field, document, null)).toBe(200 - 20 - 4);
  });

  it('ignores our own host', () => {
    const host = document.createElement('div');
    const { field } = setup(() => []);
    (document as any).elementsFromPoint = vi.fn(() => [host, field]);
    expect(iconLeftAvoiding(field, document, host)).toBe(186);
  });

  it('falls back to the edge when there is no room left of the control', () => {
    const { field, eye } = setup(() => []);
    stubRect(eye, { left: 15, top: 12, width: 190, height: 20, right: 205, bottom: 32 });
    (document as any).elementsFromPoint = vi.fn(() => [eye]);
    expect(iconLeftAvoiding(field, document, null)).toBe(186);
  });
});

describe('renderMatches', () => {
  const matches: OverlayMatch[] = [
    { id: 'a', title: 'Aliexpress', username: 'askuksov', hasTotp: false },
    { id: 'b', title: 'Second', username: 'u2', hasTotp: true },
  ];
  it('renders one row per match with title + username only, and fires onPick', () => {
    const box = document.createElement('div');
    const onPick = vi.fn();
    renderMatches(box, matches, onPick);
    const rows = box.querySelectorAll('.kokos-row');
    expect(rows).toHaveLength(2);
    expect(box.textContent).toContain('Aliexpress');
    expect(box.textContent).toContain('askuksov');
    (rows[0] as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith(matches[0]);
  });
  it('clears previous rows on re-render', () => {
    const box = document.createElement('div');
    renderMatches(box, matches, () => {});
    renderMatches(box, [matches[0]!], () => {});
    expect(box.querySelectorAll('.kokos-row')).toHaveLength(1);
  });
});

describe('createOverlay', () => {
  it('attaches a CLOSED shadow host to documentElement and removes it on destroy', () => {
    const ov = createOverlay(document);
    const hosts = document.documentElement.querySelectorAll('div');
    const host = Array.from(hosts).find((h) => (h as HTMLElement).style.zIndex === '2147483647') as HTMLElement;
    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeNull(); // closed shadow: page cannot read it
    ov.destroy();
    expect(document.documentElement.contains(host)).toBe(false);
  });

  // A React SPA recovering from a hydration error replaces <html>, taking
  // the host with it (Plane does this).
  function overlayHost(): HTMLElement | undefined {
    return Array.from(document.documentElement.children)
      .find((h) => (h as HTMLElement).style?.zIndex === '2147483647') as HTMLElement | undefined;
  }
  function visibleField(): HTMLInputElement {
    document.body.innerHTML = '';
    const field = document.createElement('input');
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    document.body.appendChild(field);
    (document as any).elementFromPoint = () => field;
    return field;
  }

  it('re-attaches a host the page removed before showing the icon', () => {
    const field = visibleField();
    const ov = createOverlay(document);
    const host = overlayHost()!;
    host.remove(); // the old <html> left the document with the host in it
    ov.showIcon(field, () => {});
    expect(host.isConnected).toBe(true);
    expect(host.parentNode).toBe(document.documentElement);
    ov.destroy();
  });

  it('re-attaches a removed host for the toast and the notice too', () => {
    const field = visibleField();
    const ov = createOverlay(document);
    const host = overlayHost()!;
    host.remove();
    ov.showToast(field, 'x');
    expect(host.isConnected).toBe(true);
    host.remove();
    ov.showNotice('y');
    expect(host.isConnected).toBe(true);
    ov.destroy();
  });

  it('does not re-attach after destroy', () => {
    const field = visibleField();
    const ov = createOverlay(document);
    const host = overlayHost()!;
    ov.destroy();
    ov.showIcon(field, () => {});
    expect(host.isConnected).toBe(false);
  });
});

describe('generator icon (independent of the login icon)', () => {
  it('exposes the generator API and both icons coexist without disturbing host lifecycle', () => {
    document.body.innerHTML = '';
    const field = document.createElement('input');
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    document.body.appendChild(field);
    (document as any).elementFromPoint = () => field; // pass isFillableGeometry
    const before = document.documentElement.querySelectorAll('div').length;
    const o = createOverlay(document);
    expect(typeof o.showGeneratorIcon).toBe('function');
    expect(typeof o.hideGenerator).toBe('function');
    expect(typeof o.showToast).toBe('function');
    // both icons can coexist; generator ops don't tear the single overlay host down
    o.showIcon(field, () => {});
    o.showGeneratorIcon(field, () => {});
    o.hideGenerator();
    o.showToast(field, 'Generated password filled: Xy9$');
    expect(document.documentElement.querySelectorAll('div').length).toBe(before + 1); // one host added
    o.destroy();
    expect(document.documentElement.querySelectorAll('div').length).toBe(before);     // host removed
  });

  // The overlay lives in a CLOSED shadow root, so its text is unreachable from
  // the document — these assert the timer contract instead, which is exactly
  // what the sticky-toast change altered.
  function toastFixture() {
    document.body.innerHTML = '';
    const field = document.createElement('input');
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    document.body.appendChild(field);
    return { field, o: createOverlay(document) };
  }

  it('schedules no auto-hide for a sticky toast (ms = 0)', () => {
    const { field, o } = toastFixture();
    const set = vi.spyOn(window, 'setTimeout');
    // The native confirm prompt parks for up to 60s; the 4s default would blank
    // this message long before the user could act on it.
    o.showToast(field, 'Waiting for your approval in Kokos — switch to the app.', 0);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
    o.destroy();
  });

  it('cancels the pending auto-hide when a second toast replaces the first', () => {
    const { field, o } = toastFixture();
    const clear = vi.spyOn(window, 'clearTimeout');
    o.showToast(field, 'first', 4000);
    expect(clear).not.toHaveBeenCalled();   // nothing to cancel yet
    o.showToast(field, 'second', 4000);
    expect(clear).toHaveBeenCalledTimes(1); // the first toast's timer, not the second's
    clear.mockRestore();
    o.destroy();
  });

  it('hideToast is callable with no toast showing', () => {
    const { o } = toastFixture();
    expect(() => o.hideToast()).not.toThrow();
    o.destroy();
  });
});
