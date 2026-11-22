// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isFillableGeometry, positionFor, iconLeftAvoiding, renderMatches, createOverlay, topLayerAncestor, overlayHostIntact, type OverlayMatch } from './overlay';

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

describe('overlay host placement', () => {
  function overlayWithRoot() {
    const spy = vi.spyOn(Element.prototype, 'attachShadow');
    const ov = createOverlay(document);
    const root = spy.mock.results[0]!.value as ShadowRoot;
    spy.mockRestore();
    return { ov, root, host: root.host as HTMLElement, list: root.querySelector('.kokos-list') as HTMLElement, gen: root.querySelector('.kokos-gen') as HTMLElement };
  }
  function fieldAt(container: Element, left: number, top: number): HTMLInputElement {
    const field = document.createElement('input');
    field.type = 'password';
    stubRect(field, { left, top, width: 200, height: 24, right: left + 200, bottom: top + 24 });
    container.appendChild(field);
    return field;
  }
  // The list's drawn box follows its style (host at the page origin, no scroll).
  function listFollowsStyle(list: HTMLElement) {
    list.getBoundingClientRect = () => {
      const l = parseFloat(list.style.left);
      const t = parseFloat(list.style.top) + 4; // margin-top
      return { left: l, top: t, width: 240, height: 100, right: l + 240, bottom: t + 100, x: l, y: t, toJSON() {} } as DOMRect;
    };
  }

  it('keeps one parent when the login and generator fields sit in different open popovers', () => {
    document.body.innerHTML = '<div id="a" popover></div><div id="b" popover></div>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    markTopLayer(a, ':popover-open');
    markTopLayer(b, ':popover-open');
    const login = fieldAt(a, 10, 10);
    const signup = fieldAt(b, 10, 300);
    (document as any).elementFromPoint = (_x: number, y: number) => (y < 100 ? login : signup);
    (document as any).elementsFromPoint = (_x: number, y: number) => [y < 100 ? login : signup];
    const { ov, host, gen } = overlayWithRoot();
    const moves = vi.fn();
    for (let i = 0; i < 3; i++) { // three scans
      ov.showIcon(login, () => {});
      const parent = host.parentElement;
      ov.showGeneratorIcon(signup, () => {});
      if (host.parentElement !== parent) moves();
    }
    expect(host.parentElement).toBe(a);
    expect(moves).not.toHaveBeenCalled();
    expect(gen.style.display).toBe('none');
    ov.destroy();
  });

  it('undoes the scale of a scaled top-layer element', () => {
    document.body.innerHTML = '<dialog></dialog>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal');
    // transform: scale(2): laid out 200x150, drawn 400x300.
    Object.defineProperty(dialog, 'offsetWidth', { value: 200 });
    Object.defineProperty(dialog, 'offsetHeight', { value: 150 });
    stubRect(dialog, { left: 100, top: 50, width: 400, height: 300, right: 500, bottom: 350 });
    const anchor = fieldAt(dialog, 300, 176); // bottom edge at 200
    const { ov, host, list } = overlayWithRoot();
    stubRect(host, { left: 100, top: 50, width: 0, height: 0, right: 100, bottom: 50 });
    ov.showMatches(anchor, [{ id: 'a', title: 'A' }], () => {});
    expect(host.parentElement).toBe(dialog);
    expect(list.style.left).toBe('100px'); // (300 - 100) / 2
    expect(list.style.top).toBe('75px');   // (200 - 50) / 2
    ov.destroy();
  });

  it('keeps a list that fits at its anchor', () => {
    document.body.innerHTML = '';
    const anchor = fieldAt(document.body, 10, 10);
    const { ov, list } = overlayWithRoot();
    listFollowsStyle(list);
    ov.showMatches(anchor, [{ id: 'a', title: 'A' }], () => {});
    expect(list.style.left).toBe('10px');
    expect(list.style.top).toBe('34px');
    ov.destroy();
  });

  it('shifts the list left off the right edge and above a field near the bottom', () => {
    document.body.innerHTML = '';
    const vw = window.innerWidth;   // 1024 in jsdom
    const vh = window.innerHeight;  // 768 in jsdom
    const anchor = fieldAt(document.body, vw - 124, vh - 68); // bottom at vh - 44
    const { ov, list } = overlayWithRoot();
    listFollowsStyle(list);
    ov.showMatches(anchor, [{ id: 'a', title: 'A' }], () => {});
    expect(parseFloat(list.style.left) + 240).toBe(vw - 4);
    // Opened above: its drawn bottom sits 4px over the field's top.
    expect(parseFloat(list.style.top) + 4 + 100).toBe(vh - 68 - 4);
    ov.destroy();
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

describe('overlayHostIntact', () => {
  function hostIn(container: Element): HTMLElement {
    const host = document.createElement('div');
    container.appendChild(host);
    return host;
  }

  it('passes for a host with nothing above it faded, filtered or clipped', () => {
    document.body.innerHTML = '';
    const host = hostIn(document.documentElement);
    expect(overlayHostIntact(host)).toBe(true);
    host.remove();
  });

  it('rejects a host inside a dialog the page made transparent', () => {
    document.body.innerHTML = '<dialog style="opacity: 0.5"></dialog>';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
  });

  it('rejects when opacities along the chain multiply below the threshold', () => {
    // 0.95 * 0.9 = 0.855: each alone would pass.
    document.body.innerHTML = '<div style="opacity: 0.95"><dialog style="opacity: 0.9"></dialog></div>';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
  });

  it('rejects a filter on an ancestor', () => {
    document.body.innerHTML = '<dialog style="filter: opacity(0)"></dialog>';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
  });

  it('rejects clip-path and blend modes on an ancestor', () => {
    document.body.innerHTML = '<div popover style="clip-path: inset(50%)"></div><dialog style="mix-blend-mode: multiply"></dialog>';
    expect(overlayHostIntact(hostIn(document.querySelector('[popover]')!))).toBe(false);
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
  });

  it('passes with an invert filter on <html>, as a dark-mode extension sets', () => {
    document.body.innerHTML = '';
    document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
    const host = hostIn(document.documentElement);
    expect(overlayHostIntact(host)).toBe(true);
    host.remove();
    document.documentElement.style.removeProperty('filter');
  });

  it('passes with a page-wide grayscale on <body>', () => {
    document.body.innerHTML = '<dialog></dialog>';
    document.body.style.filter = 'grayscale(1)';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(true);
    document.body.style.removeProperty('filter');
  });

  it('still rejects a filter on a dialog under a filtered <html>', () => {
    document.body.innerHTML = '<dialog style="filter: invert(1)"></dialog>';
    document.documentElement.style.filter = 'invert(1)';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
    document.documentElement.style.removeProperty('filter');
  });

  it('still counts opacity on <body>', () => {
    document.body.innerHTML = '<dialog></dialog>';
    document.body.style.opacity = '0.2';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
    document.body.style.removeProperty('opacity');
  });

  it('rejects a mask or hidden content-visibility on an ancestor', () => {
    document.body.innerHTML = '<dialog style="mask-image: linear-gradient(transparent, transparent)"></dialog>'
      + '<div popover style="-webkit-mask-image: url(x.png)"></div><section style="content-visibility: hidden"></section>';
    expect(overlayHostIntact(hostIn(document.querySelector('dialog')!))).toBe(false);
    expect(overlayHostIntact(hostIn(document.querySelector('[popover]')!))).toBe(false);
    expect(overlayHostIntact(hostIn(document.querySelector('section')!))).toBe(false);
  });

  it('stops at the top-layer element: effects on its ancestors do not reach it', () => {
    document.body.innerHTML = '<div style="opacity: 0.5; filter: blur(4px)"><dialog></dialog></div>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal');
    expect(overlayHostIntact(hostIn(dialog))).toBe(true);
    dialog.style.filter = 'blur(4px)'; // on the top-layer element itself
    expect(overlayHostIntact(hostIn(dialog))).toBe(false);
  });

  it('rejects a host that is not in the document', () => {
    expect(overlayHostIntact(document.createElement('div'))).toBe(false);
  });
});

describe('activation guard', () => {
  // The shadow root is closed; capture it at creation to press the icon and a
  // row. jsdom events are never trusted and its clock does not step, so both
  // are injected.
  function openOverlay(container: Element) {
    const field = document.createElement('input');
    field.type = 'password';
    field.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 24, right: 210, bottom: 34, x: 10, y: 10, toJSON() {} }) as DOMRect;
    container.appendChild(field);
    const env = { t: 1000, trusted: true };
    const spy = vi.spyOn(Element.prototype, 'attachShadow');
    const ov = createOverlay(document, { now: () => env.t, isTrusted: () => env.trusted });
    const root = spy.mock.results[0]!.value as ShadowRoot;
    spy.mockRestore();
    const host = root.host as HTMLElement;
    // Our host is topmost at any point; the field is under it.
    (document as any).elementFromPoint = () => field;
    (document as any).elementsFromPoint = () => [host, field];
    const icon = root.querySelector('.kokos-icon') as HTMLElement;
    stubRect(icon, { left: 186, top: 12, width: 20, height: 20, right: 206, bottom: 32 });
    const rowAt = (i = 0) => {
      const row = root.querySelectorAll('.kokos-row')[i] as HTMLElement;
      stubRect(row, { left: 14, top: 40, width: 232, height: 44, right: 246, bottom: 84 });
      return row;
    };
    const list = root.querySelector('.kokos-list') as HTMLElement;
    return { field, ov, root, host, icon, list, rowAt, env };
  }
  function press(el: HTMLElement, x = 196, y = 22) {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, detail: 1, bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, detail: 1, bubbles: true, cancelable: true }));
  }

  it('lets an icon click and a pick through once they have stood still', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, rowAt, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    const onPick = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    press(icon);
    expect(onIcon).toHaveBeenCalledTimes(1);
    ov.showMatches(field, [{ id: 'a', title: 'A' }], onPick);
    env.t += 400;
    press(rowAt(), 60, 60);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    ov.destroy();
  });

  it('ignores untrusted events', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    env.trusted = false;
    press(icon);
    expect(onIcon).not.toHaveBeenCalled();
    ov.destroy();
  });

  it('ignores a click within the dwell time after showing, without closing the list', () => {
    document.body.innerHTML = '';
    const { field, ov, list, rowAt, env } = openOverlay(document.body);
    const onPick = vi.fn();
    ov.showMatches(field, [{ id: 'a', title: 'A' }], onPick);
    env.t += 100;
    press(rowAt(), 60, 60);
    expect(onPick).not.toHaveBeenCalled();
    expect(list.style.display).toBe('block');
    env.t += 300;
    press(rowAt(), 60, 60);
    expect(onPick).toHaveBeenCalledTimes(1);
    ov.destroy();
  });

  it('restarts the dwell when the icon moves', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    field.getBoundingClientRect = () => ({ left: 10, top: 60, width: 200, height: 24, right: 210, bottom: 84, x: 10, y: 60, toJSON() {} }) as DOMRect;
    stubRect(icon, { left: 186, top: 62, width: 20, height: 20, right: 206, bottom: 82 });
    ov.showIcon(field, onIcon); // moved under the pointer
    env.t += 50;
    press(icon, 196, 72);
    expect(onIcon).not.toHaveBeenCalled();
    ov.destroy();
  });

  it('restarts the dwell when the icon moves on screen without being re-placed', () => {
    // A page shifting the top-layer element that holds the host moves the icon
    // with it; no scan runs and the host-local position stays the same.
    document.body.innerHTML = '';
    const { field, ov, icon, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    stubRect(icon, { left: 286, top: 112, width: 20, height: 20, right: 306, bottom: 132 });
    press(icon, 296, 122);
    expect(onIcon).not.toHaveBeenCalled();
    env.t += 400;
    press(icon, 296, 122);
    expect(onIcon).toHaveBeenCalledTimes(1);
    ov.destroy();
  });

  it('needs a pointerdown on the same control shortly before the click', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    icon.dispatchEvent(new MouseEvent('click', { clientX: 196, clientY: 22, detail: 1, cancelable: true }));
    expect(onIcon).not.toHaveBeenCalled();
    icon.dispatchEvent(new MouseEvent('pointerdown', { clientX: 196, clientY: 22, detail: 1 }));
    env.t += 2500;
    icon.dispatchEvent(new MouseEvent('click', { clientX: 196, clientY: 22, detail: 1, cancelable: true }));
    expect(onIcon).not.toHaveBeenCalled();
    ov.destroy();
  });

  it('honours a keyboard click only on the focused icon', () => {
    document.body.innerHTML = '';
    const { field, ov, root, icon, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    icon.dispatchEvent(new MouseEvent('click', { detail: 0, cancelable: true }));
    expect(onIcon).not.toHaveBeenCalled();
    icon.focus();
    expect(root.activeElement).toBe(icon);
    icon.dispatchEvent(new MouseEvent('click', { detail: 0, cancelable: true }));
    expect(onIcon).toHaveBeenCalledTimes(1);
    ov.destroy();
  });

  it('drops a click on an icon drawn shrunken, and closes the list', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, list, env } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    ov.showMatches(field, [{ id: 'a', title: 'A' }], vi.fn());
    env.t += 400;
    stubRect(icon, { left: 186, top: 12, width: 10, height: 10, right: 196, bottom: 22 }); // transform: scale(0.5), origin top left
    press(icon);
    expect(onIcon).not.toHaveBeenCalled();
    expect(list.style.display).toBe('none');
    ov.destroy();
  });

  it('drops a click when another element is topmost at the pointer', () => {
    document.body.innerHTML = '';
    const { field, ov, icon, env, host } = openOverlay(document.body);
    const onIcon = vi.fn();
    ov.showIcon(field, onIcon);
    env.t += 400;
    const decoy = document.createElement('div');
    document.body.appendChild(decoy);
    (document as any).elementsFromPoint = () => [decoy, host, field];
    press(icon);
    expect(onIcon).not.toHaveBeenCalled();
    ov.destroy();
  });

  it('drops the icon click and the pick, and closes the list, under a faded dialog', () => {
    document.body.innerHTML = '<dialog></dialog>';
    const dialog = document.querySelector('dialog')!;
    markTopLayer(dialog, ':modal'); // mounts the host inside, as for showModal()
    const { field, ov, icon, list, rowAt, env } = openOverlay(dialog);
    const onIcon = vi.fn();
    const onPick = vi.fn();
    ov.showIcon(field, onIcon);
    ov.showMatches(field, [{ id: 'a', title: 'A' }], onPick);
    env.t += 400;
    dialog.style.opacity = '0.01';
    press(icon);
    press(rowAt(), 60, 60);
    expect(onIcon).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    expect(list.style.display).toBe('none');
    ov.destroy();
  });

  describe('with IntersectionObserver v2', () => {
    let callback: ((entries: Array<{ target: Element; isVisible: boolean }>) => void) | null = null;
    const w = window as any;
    beforeEach(() => {
      w.IntersectionObserver = class {
        constructor(cb: typeof callback) { callback = cb; }
        observe() {} disconnect() {}
      };
      w.IntersectionObserverEntry = class {};
      Object.defineProperty(w.IntersectionObserverEntry.prototype, 'isVisible', { get: () => true });
    });
    afterEach(() => {
      delete w.IntersectionObserver;
      delete w.IntersectionObserverEntry;
      callback = null;
      document.documentElement.style.removeProperty('filter');
    });

    it('drops a click while the icon is reported as covered', () => {
      document.body.innerHTML = '';
      const { field, ov, icon, env } = openOverlay(document.body);
      const onIcon = vi.fn();
      ov.showIcon(field, onIcon);
      env.t += 400;
      callback!([{ target: icon, isVisible: false }]); // a pointer-events: none decoy on top
      press(icon);
      expect(onIcon).not.toHaveBeenCalled();
      callback!([{ target: icon, isVisible: true }]);
      press(icon);
      expect(onIcon).toHaveBeenCalledTimes(1);
      ov.destroy();
    });

    it('does not trust the verdict under a page-wide filter on <html>', () => {
      document.body.innerHTML = '';
      const { field, ov, icon, env } = openOverlay(document.body);
      const onIcon = vi.fn();
      ov.showIcon(field, onIcon);
      env.t += 400;
      document.documentElement.style.filter = 'invert(1)';
      callback!([{ target: icon, isVisible: false }]);
      press(icon);
      expect(onIcon).toHaveBeenCalledTimes(1);
      ov.destroy();
    });
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
