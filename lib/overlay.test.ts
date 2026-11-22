// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { isFillableGeometry, positionFor, iconLeftAvoiding, renderMatches, createOverlay, topLayerAncestor, type OverlayMatch } from './overlay';

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
  it('does not count our own overlay host over the centre as an obstruction', () => {
    const el = document.createElement('input'); stubRect(el, {});
    const host = document.createElement('div');
    (document as any).elementsFromPoint = vi.fn().mockReturnValue([host, el]);
    expect(isFillableGeometry(el, host)).toBe(true);
  });
  it('still rejects a page element over the centre when the host is excluded', () => {
    const el = document.createElement('input'); stubRect(el, {});
    const host = document.createElement('div');
    const other = document.createElement('div');
    (document as any).elementsFromPoint = vi.fn().mockReturnValue([host, other, el]);
    expect(isFillableGeometry(el, host)).toBe(false);
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
    const { field, eye } = setup(() => []);
    stubRect(eye, { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }); // not rendered
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

  it('moves left of a narrow button that falls between hit-test points', () => {
    // Icon spans 186..206; a button at 188..195 is missed by x = 187, 196 and 205.
    const { field, eye } = setup(() => []);
    stubRect(eye, { left: 188, top: 12, width: 7, height: 20, right: 195, bottom: 32 });
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(188 - 20 - 4);
  });

  it('moves left of a narrow link that falls between hit-test points', () => {
    const { field, wrap, eye } = setup(() => []);
    stubRect(eye, { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }); // not rendered
    const link = document.createElement('a');
    link.href = '#';
    wrap.appendChild(link);
    stubRect(link, { left: 188, top: 12, width: 7, height: 20, right: 195, bottom: 32 });
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(188 - 20 - 4);
  });

  it('keeps moving past a row of controls until the spot is clear', () => {
    const { field, wrap, eye } = setup(() => []);
    stubRect(eye, { left: 190, top: 12, width: 16, height: 20, right: 206, bottom: 32 });
    for (const l of [170, 150, 130]) {
      const b = document.createElement('button');
      wrap.appendChild(b);
      stubRect(b, { left: l, top: 12, width: 16, height: 20, right: l + 16, bottom: 32 });
    }
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(130 - 20 - 4); // 106..126, clear of all four
  });

  it('ignores a nearby button that does not overlap the icon', () => {
    const { field, eye } = setup(() => []);
    stubRect(eye, { left: 120, top: 12, width: 20, height: 20, right: 140, bottom: 32 });
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(186);
  });

  it('ignores our own host', () => {
    const host = document.createElement('div');
    const { field, eye } = setup(() => []);
    stubRect(eye, { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }); // not rendered
    (document as any).elementsFromPoint = vi.fn(() => [host, field]);
    expect(iconLeftAvoiding(field, document, host)).toBe(186);
  });

  // Markup of a PrimeNG-based password field (captured from a live site): the
  // eye is a plain <span> with a framework click listener around an icon-font
  // <i>, no button role, tabindex or svg.
  function glyphEye() {
    document.body.innerHTML = `<div class="row"><div class="tax-ui-password">
      <input class="p-inputtext tax-ui-password__input" type="password" autocomplete="current-password">
      <span class="tax-ui-password__eye"><i class="pi pi-eye"></i></span>
    </div></div>`;
    const field = document.querySelector('input')!;
    const span = document.querySelector('span')!;
    const glyph = document.querySelector('i')!;
    // Field 10..210 x 10..34; eye at right: 10px, 16 wide, like the live page.
    stubRect(field, { left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34 });
    stubRect(span, { left: 184, top: 8, width: 16, height: 28, right: 200, bottom: 36 });
    stubRect(glyph, { left: 184, top: 14, width: 16, height: 16, right: 200, bottom: 30 });
    return { field, span, glyph };
  }

  it('moves left of an icon-font eye that the hit test does not report', () => {
    const { field } = glyphEye();
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(184 - 20 - 4);
  });

  it('moves left of an icon-font eye found by the hit test', () => {
    const { field, glyph, span } = glyphEye();
    (document as any).elementsFromPoint = vi.fn((x: number) => (x >= 184 && x < 200 ? [glyph, span, field] : [field]));
    expect(iconLeftAvoiding(field, document, null)).toBe(184 - 20 - 4);
  });

  it('ignores a decorative layer with an icon class that spans the whole field', () => {
    document.body.innerHTML = '<div><div><input type="password"><span class="input-icon-frame"></span></div></div>';
    const field = document.querySelector('input')!;
    const frame = document.querySelector('span')!;
    stubRect(field, { left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34 });
    stubRect(frame, { left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34 });
    (document as any).elementsFromPoint = vi.fn(() => [field]);
    expect(iconLeftAvoiding(field, document, null)).toBe(186);
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
    (document as any).elementFromPoint = () => field; (document as any).elementsFromPoint = () => [field];
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

// jsdom does not know :modal / :popover-open, so the top-layer state is
// stubbed on the element the way the browser would report it.
function markTopLayer(el: Element, pseudo: ':modal' | ':popover-open', on = true): void {
  const base = Element.prototype.matches;
  (el as any).matches = function (sel: string) { return sel === pseudo ? on : base.call(this, sel); };
}

describe('topLayerAncestor', () => {
  it('finds the modal dialog around a field', () => {
    document.body.innerHTML = '<dialog><form><input type="password"></form></dialog>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal');
    expect(topLayerAncestor(document.querySelector('input')!)).toBe(dialog);
  });
  it('ignores a dialog opened without showModal', () => {
    document.body.innerHTML = '<dialog open><input type="password"></dialog>';
    markTopLayer(document.querySelector('dialog')!, ':modal', false);
    expect(topLayerAncestor(document.querySelector('input')!)).toBeNull();
  });
  it('finds an open popover, the nearest top-layer element first', () => {
    document.body.innerHTML = '<dialog><div popover><input type="password"></div></dialog>';
    const dialog = document.querySelector('dialog')!;
    const pop = document.querySelector('[popover]')!;
    markTopLayer(dialog, ':modal');
    markTopLayer(pop, ':popover-open');
    expect(topLayerAncestor(document.querySelector('input')!)).toBe(pop);
  });
  it('treats a selector the engine does not know as not in the top layer', () => {
    document.body.innerHTML = '<dialog><input type="password"></dialog>';
    (document.querySelector('dialog') as any).matches = () => { throw new SyntaxError('unknown pseudo-class'); };
    expect(topLayerAncestor(document.querySelector('input')!)).toBeNull();
  });
});

describe('overlay host in the top layer', () => {
  function hostOf(): HTMLElement | undefined {
    return Array.from(document.querySelectorAll('div'))
      .find((h) => (h as HTMLElement).style.zIndex === '2147483647') as HTMLElement | undefined;
  }
  function fieldIn(container: Element): HTMLInputElement {
    const field = document.createElement('input');
    field.type = 'password';
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    container.appendChild(field);
    return field;
  }
  function stubHitTest(field: Element) {
    (document as any).elementFromPoint = () => field; (document as any).elementsFromPoint = () => [field];
  }

  it('mounts inside a modal dialog so the icon is above the backdrop and not inert', () => {
    document.body.innerHTML = '<dialog></dialog>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal');
    const field = fieldIn(dialog);
    stubHitTest(field);
    const ov = createOverlay(document);
    ov.showIcon(field, () => {});
    const host = hostOf()!;
    expect(host.parentElement).toBe(dialog);
    expect(host.style.position).toBe('fixed'); // not clipped by the dialog's scroll box
    ov.destroy();
  });

  it('moves the matches list and toast with the field into an open popover', () => {
    document.body.innerHTML = '<div popover></div>';
    const pop = document.querySelector('[popover]')!;
    markTopLayer(pop, ':popover-open');
    const field = fieldIn(pop);
    const ov = createOverlay(document);
    ov.showMatches(field, [{ id: 'a', title: 'A' }], () => {});
    expect(hostOf()!.parentElement).toBe(pop);
    ov.destroy();
  });

  it('returns to the document root once the dialog has closed', () => {
    document.body.innerHTML = '<dialog></dialog>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal');
    const inside = fieldIn(dialog);
    stubHitTest(inside);
    const ov = createOverlay(document);
    ov.showIcon(inside, () => {});
    markTopLayer(dialog, ':modal', false); // dialog.close()
    const outside = fieldIn(document.body);
    stubHitTest(outside);
    ov.showIcon(outside, () => {});
    const host = hostOf()!;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.style.position).toBe('absolute');
    ov.destroy();
  });

  it('stays in a popover that is still open when a field outside it is shown', () => {
    // Moving out and back in on every scan would trigger the next scan forever.
    document.body.innerHTML = '<div popover></div>';
    const pop = document.querySelector('[popover]')!;
    markTopLayer(pop, ':popover-open');
    const inside = fieldIn(pop);
    const outside = fieldIn(document.body);
    stubHitTest(inside);
    const ov = createOverlay(document);
    ov.showIcon(inside, () => {});
    stubHitTest(outside);
    ov.showGeneratorIcon(outside, () => {});
    expect(hostOf()!.parentElement).toBe(pop);
    ov.destroy();
  });

  it('stays at the document root for a field outside any top layer', () => {
    document.body.innerHTML = '';
    const field = fieldIn(document.body);
    stubHitTest(field);
    const ov = createOverlay(document);
    ov.showIcon(field, () => {});
    expect(hostOf()!.parentElement).toBe(document.documentElement);
    ov.destroy();
  });
});

describe('generator icon (independent of the login icon)', () => {
  it('exposes the generator API and both icons coexist without disturbing host lifecycle', () => {
    document.body.innerHTML = '';
    const field = document.createElement('input');
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    document.body.appendChild(field);
    (document as any).elementFromPoint = () => field; (document as any).elementsFromPoint = () => [field]; // pass isFillableGeometry
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
