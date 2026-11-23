// The inline autofill affordance: a key-icon over a login field and a dropdown
// of saved-login matches. Rendered in a CLOSED Shadow DOM so the page cannot
// read the offered username list, restyle it, or capture its clicks. Shows
// title + username only — NEVER a secret.

export interface OverlayMatch {
  id: string;
  title?: string;
  username?: string | null;
  hasTotp?: boolean;
}

import { monogram } from './monogram';

const ICON_SIZE = 20;

// Lucide-style strokes, built with createElementNS (no markup strings).
const KEY_PATHS = ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01'];
const WAND_PATHS = ['M15 4V2', 'M15 16v-2', 'M8 9h2', 'M20 9h2', 'M17.8 11.8 19 13', 'M15 9h.01', 'M17.8 6.2 19 5', 'm3 21 9-9', 'M12.2 6.2 11 5'];

function svgIcon(doc: Document, paths: string[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

// `.kokos-toast`'s `width: max-content` is load-bearing: the shadow host is a
// 0x0 box, so an absolutely positioned child shrink-to-fits against a
// ZERO-width containing block and collapses to one character per line
// (the sticky approval toast made it visible in manual testing; the
// generator toast had carried the same bug all along, and `.kokos-list` only
// escapes it through its own min-width). `max-width` then wraps a long message
// at a sane column, and `overflow-wrap: anywhere` replaces the previous
// `word-break: break-all`, which split ordinary words mid-letter while still
// being needed for an unspaced generated password.
// No filter, opacity or scale on hover/press: IntersectionObserver v2 reports
// an element drawn with any of those as not visible, and the activation guard
// would then refuse the very click the user is making.
const OVERLAY_CSS = `
.kokos-ui {
  --bg: oklch(0.205 0.014 60); --bg-hover: oklch(1 0 0 / 0.06); --text-1: oklch(0.93 0.006 65);
  --text-2: oklch(0.68 0.016 65); --line: oklch(1 0 0 / 0.1); --accent: oklch(0.68 0.09 62);
  --accent-deep: oklch(0.58 0.095 55); --accent-soft: oklch(0.68 0.09 62 / 0.16); --on-accent: oklch(0.98 0.012 78);
  --toast-bg: oklch(0.245 0.016 60); --shadow: 0 12px 32px oklch(0 0 0 / 0.45), 0 2px 8px oklch(0 0 0 / 0.3);
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--text-1); -webkit-font-smoothing: antialiased; box-sizing: border-box;
}
@media (prefers-color-scheme: light) {
  .kokos-ui {
    --bg: oklch(1 0 0); --bg-hover: oklch(0.3 0.03 60 / 0.06); --text-1: oklch(0.26 0.02 60);
    --text-2: oklch(0.5 0.018 62); --line: oklch(0.3 0.03 60 / 0.12); --accent: oklch(0.6 0.095 60);
    --accent-deep: oklch(0.52 0.095 54); --accent-soft: oklch(0.6 0.095 60 / 0.12);
    --toast-bg: oklch(0.26 0.02 60); --shadow: 0 12px 32px oklch(0.28 0.03 60 / 0.2), 0 2px 8px oklch(0.28 0.03 60 / 0.12);
  }
}
.kokos-icon, .kokos-gen { position: absolute; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; padding: 0; margin: 0;
  display: grid; place-items: center; border: none; border-radius: 6px; cursor: pointer; color: var(--on-accent);
  background: linear-gradient(180deg, var(--accent), var(--accent-deep));
  box-shadow: 0 1px 3px oklch(0 0 0 / 0.25), inset 0 1px 0 oklch(1 0 0 / 0.2); transition: background .15s ease; }
.kokos-icon:hover, .kokos-gen:hover { background: linear-gradient(180deg, var(--accent-deep), var(--accent-deep)); }
.kokos-icon svg, .kokos-gen svg { width: 12px; height: 12px; display: block; }
.kokos-list { position: absolute; min-width: 240px; max-width: 320px; max-height: 260px; overflow-y: auto; margin-top: 4px; padding: 4px;
  background: var(--bg); border-radius: 11px; box-shadow: inset 0 0 0 1px var(--line), var(--shadow); }
.kokos-row { display: flex; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.kokos-row:hover { background: var(--bg-hover); }
.kokos-mono { flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
  color: oklch(0.98 0.012 78); font-weight: 600; font-size: 12px; text-shadow: 0 1px 2px oklch(0 0 0 / 0.2);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18); }
.kokos-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.kokos-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kokos-user { color: var(--text-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kokos-totp { flex-shrink: 0; font-size: 10px; font-weight: 600; letter-spacing: .04em; color: var(--accent);
  background: var(--accent-soft); border-radius: 999px; padding: 1px 7px; }
.kokos-toast { position: absolute; width: max-content; max-width: 280px; background: var(--toast-bg); color: oklch(0.95 0.006 65);
  font-size: 12px; line-height: 1.4; padding: 7px 10px; border-radius: 9px;
  box-shadow: var(--shadow); overflow-wrap: anywhere; }
`;

// `exclude` is our own overlay host: once the icon has moved left of a field
// button it can sit over the field's centre, and counting it as an obstruction
// would hide the icon on every other scan.
export function isFillableGeometry(el: Element, exclude: Element | null = null): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hit = exclude && typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(cx, cy).find((e) => e !== exclude)
    : document.elementFromPoint(cx, cy);
  return !!hit && (hit === el || el.contains(hit));
}

export function positionFor(rect: { left: number; top: number; width: number; height: number }, scrollX: number, scrollY: number): { left: number; top: number } {
  return {
    left: rect.left + scrollX + rect.width - ICON_SIZE - 4,
    top: rect.top + scrollY + (rect.height - ICON_SIZE) / 2,
  };
}

const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex], [onclick], svg';
// Site controls with no button semantics: an icon-font <i> or an "eye" span
// that a framework wires up with a click listener (a PrimeNG-style password
// field draws its show-password toggle this way). Found by geometry too, so
// the icon does not depend on the hit test alone to see them.
const GLYPH_SELECTOR = 'i, img, [class*="icon"], [class*="Icon"], [class*="eye"], [class*="Eye"]';

// Viewport `left` for an icon at the field's right edge, moved left past any
// page control drawn over that edge (a show-password eye, a clear button):
// sitting on top of it would hide it and swallow its clicks. `exclude` is our
// own host, which elementsFromPoint reports for anything in the shadow root.
export function iconLeftAvoiding(field: Element, doc: Document, exclude: Element | null): number {
  const rect = field.getBoundingClientRect();
  const original = rect.left + rect.width - ICON_SIZE - 4;
  const cy = rect.top + rect.height / 2;
  const iconTop = cy - ICON_SIZE / 2;
  const view = doc.defaultView;
  // Clickable elements and glyphs next to the field (a UI kit may nest the
  // input a level deeper than its buttons), found by geometry so a narrow one
  // between hit-test points is not missed.
  const scope = field.parentElement?.parentElement ?? field.parentElement;
  const nearby = scope ? Array.from(scope.querySelectorAll(CONTROL_SELECTOR)) : [];
  // A glyph only counts when it is small next to the field: a decorative
  // layer that spans the whole input (an outlined-label frame) is not a control.
  const glyphs = scope
    ? Array.from(scope.querySelectorAll(GLYPH_SELECTOR)).filter((g) => {
      if (g.matches(CONTROL_SELECTOR)) return false;
      return g.getBoundingClientRect().width <= rect.width / 2;
    })
    : [];
  nearby.push(...glyphs);
  const isControl = (c: Element) => c !== exclude && !c.contains(field) && !field.contains(c);
  const visible = (c: Element) => view?.getComputedStyle(c).visibility !== 'hidden';
  // The page control (if any) the hit test finds at x, for clickable elements
  // that are neither a button nor an svg.
  const hitAt = (x: number): Element | null => {
    if (typeof doc.elementsFromPoint !== 'function') return null;
    const top = doc.elementsFromPoint(x, cy).find((e) => e !== exclude);
    if (!top || top === field || top.contains(field)) return null;
    // The whole button, not just the glyph inside it.
    const control = top.closest('button, [role="button"]') ?? top.closest('svg') ?? top;
    return isControl(control) ? control : null;
  };
  let left = original;
  // Each step moves at least 4px left (a blocker starts before the icon's
  // right edge), so this ends at a clear spot or the field's left edge; the
  // cap only guards against a page that keeps reporting moving boxes.
  for (let i = 0; i < 50; i++) {
    const right = left + ICON_SIZE;
    const blockers = nearby.filter((c) => {
      if (!isControl(c)) return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < right && r.right > left
        && r.top < iconTop + ICON_SIZE && r.bottom > iconTop && visible(c);
    });
    for (const x of [left + 1, left + ICON_SIZE / 2, right - 1]) {
      const hit = hitAt(x);
      if (hit) blockers.push(hit);
    }
    if (blockers.length === 0) return left;
    left = Math.min(...blockers.map((c) => c.getBoundingClientRect().left)) - ICON_SIZE - 4;
    if (left < rect.left) return original; // no free room inside the field
  }
  return original;
}

function matchesSafe(el: Element, selector: string): boolean {
  try { return el.matches(selector); } catch { return false; } // selector unknown to this engine
}

// The nearest ancestor of `el` that the browser renders in the top layer: a
// modal <dialog> (showModal) or an open popover. Everything else sits under
// the top layer whatever its z-index, and a modal dialog makes everything
// outside it inert, so the overlay must live inside this element to be seen
// and clicked.
function inTopLayerNow(a: Element): boolean {
  return (a.localName === 'dialog' && matchesSafe(a, ':modal'))
    || (a.hasAttribute('popover') && matchesSafe(a, ':popover-open'));
}

export function topLayerAncestor(el: Element): Element | null {
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (inTopLayerNow(a)) return a;
  }
  return null;
}

// Smallest product of `opacity` from the host up to the root that still
// counts as plainly visible.
const MIN_OPACITY = 0.9;

// Whether the overlay host is plainly visible, checked at the moment the user
// activates the icon or a match. The host inherits the opacity, filters,
// clipping and blending of every element above it (the page's <html>, or a
// page-owned <dialog> or popover), so a hostile page could fade, disguise or
// clip the icon and the list and steer the user into a fill click they did not
// mean. Any of those on the chain counts as tampering, except a filter, clip
// or blend mode on <html> or <body>: that applies to the whole page alike (a
// dark-mode extension's invert filter, a site-wide grayscale) and cannot set
// the overlay apart from the content the user sees. Opacity and visibility
// count everywhere. A host inside a modal dialog or open popover is checked up
// to and including that top-layer element and no further: the top layer is
// painted apart from the element's ancestors, so their opacity, filters and
// clipping do not reach it (inherited `visibility` still does, and is read
// from the host). Run on activation only: it reads computed styles for the
// ancestor chain.
export function overlayHostIntact(host: Element): boolean {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  if (!view || !host.isConnected) return false;
  const check = (host as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(host, { opacityProperty: true, visibilityProperty: true })) return false;
  // An unset value reads as '' in some engines; treat it as the initial one.
  const changed = (v: string, initial: string) => v !== '' && v !== initial;
  let opacity = 1;
  for (let el: Element | null = host; el; el = el.parentElement) {
    const cs = view.getComputedStyle(el);
    if (el === host && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) return false;
    const o = parseFloat(cs.opacity);
    if (!Number.isNaN(o)) opacity *= o;
    if (el === doc.documentElement || el === doc.body) continue;
    // Masks are read through their longhands: how the `mask` shorthand is
    // serialized differs between engines, and every mask needs an image.
    if (changed(cs.getPropertyValue('filter'), 'none')
      || changed(cs.getPropertyValue('backdrop-filter'), 'none')
      || changed(cs.getPropertyValue('clip-path'), 'none')
      || changed(cs.getPropertyValue('mix-blend-mode'), 'normal')
      || changed(cs.getPropertyValue('mask-image'), 'none')
      || changed(cs.getPropertyValue('-webkit-mask-image'), 'none')
      || changed(cs.getPropertyValue('-webkit-mask-box-image-source'), 'none')
      || cs.getPropertyValue('content-visibility') === 'hidden') return false;
    if (el !== host && inTopLayerNow(el)) break;
  }
  return opacity >= MIN_OPACITY;
}

// The size a control is drawn at must stay close to its CSS size: a scaled
// (transform, zoom, perspective) icon or row is shrunk to make it hard to see.
const MIN_RENDERED = 0.8;
// The smallest box a match row is laid out at (list min-width minus padding,
// monogram plus padding).
const ROW_MIN_WIDTH = 232;
const ROW_MIN_HEIGHT = 38;

export function drawnFullSize(el: Element, width: number, height: number): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= width * MIN_RENDERED && r.height >= height * MIN_RENDERED;
}

export function insideViewport(el: Element, view: Window): boolean {
  const r = el.getBoundingClientRect();
  const vw = view.innerWidth || el.ownerDocument.documentElement.clientWidth;
  const vh = view.innerHeight || el.ownerDocument.documentElement.clientHeight;
  return r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
}

export function renderMatches(container: HTMLElement | ShadowRoot, matches: OverlayMatch[], onPick: (m: OverlayMatch) => void): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  const doc = container instanceof ShadowRoot ? container.host.ownerDocument : container.ownerDocument;
  for (const m of matches) {
    const row = doc.createElement('div');
    row.className = 'kokos-row';
    const name = m.title || m.username || '(entry)';
    const tile = monogram(name);
    const mono = doc.createElement('span');
    mono.className = 'kokos-mono';
    mono.style.background = tile.bg;
    mono.textContent = tile.letter;
    const text = doc.createElement('span');
    text.className = 'kokos-text';
    const title = doc.createElement('span');
    title.className = 'kokos-title';
    title.textContent = name;
    const user = doc.createElement('span');
    user.className = 'kokos-user';
    user.textContent = m.username ?? '';
    text.append(title, user);
    row.append(mono, text);
    if (m.hasTotp) {
      const dot = doc.createElement('span');
      dot.className = 'kokos-totp';
      dot.textContent = 'TOTP';
      row.append(dot);
    }
    row.addEventListener('click', () => onPick(m));
    container.appendChild(row);
  }
}

export interface OverlayController {
  showIcon(field: HTMLElement, onIconClick: () => void): void;
  showMatches(anchor: HTMLElement, matches: OverlayMatch[], onPick: (m: OverlayMatch) => void): void;
  showGeneratorIcon(field: HTMLElement, onClick: () => void): void;
  hideGenerator(): void;
  // `ms = 0` keeps the toast up until hideToast() or the next showToast —
  // the native confirm prompt can park for a full 60s, far past any timeout
  // that makes sense for a transient message.
  showToast(anchor: HTMLElement, text: string, ms?: number): void;
  // Same toast pinned to the viewport's top-right corner, for messages with no
  // field to anchor to (the page may have navigated since the event).
  showNotice(text: string, ms?: number): void;
  hideToast(): void;
  hide(): void;
  destroy(): void;
}

// Activation timing: a control must have stood still this long before a
// click on it counts, and a click must follow its pointerdown within PAIR_MS.
const DWELL_MS = 300;
const PAIR_MS = 2000;
// How often a moving pointer re-checks the host while it rests on a control.
const HOVER_CHECK_MS = 50;

export interface OverlayOptions {
  // Injected by tests only: jsdom cannot produce trusted events or a clock to step.
  isTrusted?: (e: Event) => boolean;
  now?: () => number;
}

export function createOverlay(doc: Document = document, opts: OverlayOptions = {}): OverlayController {
  const view = doc.defaultView!;
  const isTrusted = opts.isTrusted ?? ((e: Event) => e.isTrusted);
  const now = opts.now ?? (() => Date.now());
  const host = doc.createElement('div');
  const HOST_CSS = 'top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483647;';
  host.style.cssText = `position:absolute;${HOST_CSS}`;
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;
  const icon = doc.createElement('button');
  icon.type = 'button';
  icon.className = 'kokos-icon';
  icon.setAttribute('aria-label', 'Kokos: fill login');
  icon.appendChild(svgIcon(doc, KEY_PATHS));
  icon.style.display = 'none';
  const list = doc.createElement('div');
  list.className = 'kokos-list';
  list.style.display = 'none';
  const gen = doc.createElement('button');
  gen.type = 'button';
  gen.className = 'kokos-gen';
  gen.setAttribute('aria-label', 'Kokos: generate password');
  gen.appendChild(svgIcon(doc, WAND_PATHS));
  gen.style.display = 'none';
  const toast = doc.createElement('div');
  toast.className = 'kokos-toast';
  toast.style.display = 'none';
  // One wrapper carries the theme variables for every piece of the overlay.
  const ui = doc.createElement('div');
  ui.className = 'kokos-ui';
  ui.append(icon, list, gen, toast);
  root.append(style, ui);
  doc.documentElement.appendChild(host);

  // A page can drop the host after we appended it: a React SPA that recovers
  // from a hydration error by client-rendering the whole document replaces
  // <html>, and the host goes with the old one (seen on Plane). Without
  // re-attaching, every show* below would style a detached node and nothing
  // would appear. Called before each show, so the next scan brings it back.
  //
  // A field inside a modal <dialog> or an open popover moves the host into
  // that top-layer element (see topLayerAncestor); a field elsewhere moves it
  // back. Inside, the host is `position: fixed`, so the list and the toast are
  // not clipped by the dialog's own scroll box, and coordinates are taken
  // relative to the host's own box (a transformed dialog becomes the
  // containing block). Called before each show with its anchor. A field
  // outside the top layer does not pull the host out of a dialog or popover
  // that is still open: with icons on fields both inside and outside an open
  // popover, moving the host back and forth would re-trigger the scan forever.
  //
  // The login icon and the generator icon share the host, so they must agree
  // on one parent: the login icon's wins, and a generator icon whose field
  // needs another one is not drawn while the login icon shows (otherwise two
  // open popovers would bounce the host between them on every scan).
  let destroyed = false;
  let inTopLayer = false;
  const targetFor = (anchor: Element | null): Element => {
    const current = host.isConnected ? host.parentElement : null;
    return (anchor ? topLayerAncestor(anchor) : null)
      ?? (current && current !== doc.documentElement && inTopLayerNow(current) ? current : doc.documentElement);
  };
  const attach = (anchor: Element | null) => {
    if (destroyed) return;
    const target = targetFor(anchor);
    if (host.parentElement !== target) target.appendChild(host);
    const fixed = target !== doc.documentElement;
    if (fixed !== inTopLayer) {
      inTopLayer = fixed;
      host.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};${HOST_CSS}`;
    }
  };
  // Host-local coordinates for a viewport point. At the document root the host
  // scrolls with the page, so the page scroll is added; inside the top layer
  // the host's own box is the origin, and a scaled top-layer element (the
  // host's containing block) scales everything in it, so the offset is divided
  // by that scale: drawn size over layout size. Rotation and skew are not
  // undone.
  const at = (x: number, y: number): { left: number; top: number } => {
    if (!inTopLayer) return { left: x + view.scrollX, top: y + view.scrollY };
    const o = host.getBoundingClientRect();
    const box = host.parentElement as HTMLElement | null;
    const r = box?.getBoundingClientRect();
    const sx = box && r && box.offsetWidth > 0 && r.width > 0 ? r.width / box.offsetWidth : 1;
    const sy = box && r && box.offsetHeight > 0 && r.height > 0 ? r.height / box.offsetHeight : 1;
    return { left: (x - o.left) / sx, top: (y - o.top) / sy };
  };

  // Activation guard against DOM-based clickjacking: a page that fades,
  // disguises, shrinks or covers the icon or the list, or moves it under the
  // pointer at the last moment, to steer the user into a fill click.
  //
  // - Only trusted events count.
  // - A pointer click counts only after a pointerdown on the same control that
  //   passed the same checks, so styles changed between press and release are
  //   caught too. A keyboard click (detail 0, on the focused button) has no
  //   pointerdown and no point to test.
  // - Dwell: the control must not have been shown or moved within DWELL_MS.
  // - Hover dwell (mouse, and a pen once it has been seen hovering; not touch
  //   or a contact-only pen, which keep the other checks): the pointer must
  //   have rested on the control for DWELL_MS while it was plainly visible.
  //   The visibility
  //   check runs when the pointer enters and, throttled, as it moves; a failed
  //   check restarts the hover. A control that pops up under a resting cursor
  //   gets a fresh pointerover, and one made visible (opacity) while the
  //   cursor rests on it was last seen hidden, so neither click counts.
  // - The host chain must be plainly visible (overlayHostIntact), the control
  //   drawn at close to its CSS size and inside the viewport.
  // - Occlusion: where IntersectionObserver v2 exists (Chrome), its last
  //   isVisible verdict for the control must not be false. Everywhere, the
  //   topmost element at the pointer must be our host. Only IOv2 catches a
  //   decoy drawn over the icon with pointer-events: none, which the point
  //   test sees through.
  //
  // A failure from waiting (dwell, pairing) just drops the click; any other
  // failure also closes the list.
  type Verdict = 'ok' | 'wait' | 'tamper';
  const shownAt = new Map<Element, number>();
  const ioVisible = new Map<Element, boolean>();
  const IO = (view as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  const Entry = (view as Window & { IntersectionObserverEntry?: { prototype: object } }).IntersectionObserverEntry;
  const io = IO && Entry && 'isVisible' in Entry.prototype
    ? new IO((entries) => {
      for (const en of entries) ioVisible.set(en.target, (en as IntersectionObserverEntry & { isVisible?: boolean }).isVisible !== false);
    }, { trackVisibility: true, delay: 100 } as IntersectionObserverInit)
    : null;
  // IOv2 reports any filter on an ancestor as not visible, so a page-wide
  // filter on <html> or <body> (dark-mode extensions, site-wide grayscale)
  // would block every fill; the point test still runs there.
  const pageFiltered = (): boolean => [doc.documentElement, doc.body].some((el) => {
    if (!el) return false;
    const f = view.getComputedStyle(el).getPropertyValue('filter');
    return f !== '' && f !== 'none';
  });
  // Where each control was last seen on screen. The dwell restarts whenever
  // that moves, whatever moved it: a re-placement by a scan, or the page
  // shifting a top-layer element with the host inside it (no scan at all).
  const seenAt = new Map<Element, DOMRect>();
  const movedOnScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const prev = seenAt.get(el);
    seenAt.set(el, r);
    return !prev || Math.abs(r.left - prev.left) > 2 || Math.abs(r.top - prev.top) > 2;
  };
  // Since when the pointer has rested on each control while it looked intact.
  // Weak: match rows are replaced every time the list opens.
  const hoverSince = new WeakMap<Element, number>();
  const hoverCheckedAt = new WeakMap<Element, number>();
  // While a hover is being timed, the host is re-checked on a short timer:
  // opacity or visibility changes send no pointer event, and a hover must not
  // count time during which the overlay was hidden.
  // Besides the timer, any change that could hide the host between two ticks
  // ends the hover at once: a style/class/hidden change on the host or one of
  // its ancestors, a stylesheet added or removed, or an animation/transition
  // starting on an element that contains the host. Watched only while a hover
  // is being timed, so busy pages pay nothing otherwise.
  const hoverPoll = new WeakMap<Element, ReturnType<Window['setInterval']>>();
  const hoverWatch = new WeakMap<Element, () => void>();
  const watchHostChain = (onChange: () => void): (() => void) => {
    const MO = view.MutationObserver;
    const attrs = new MO(() => onChange());
    for (let el: Element | null = host; el; el = el.parentElement) {
      attrs.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open', 'popover'] });
    }
    const sheets = new MO((records) => {
      for (const r of records) {
        for (const n of [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]) {
          const name = n.nodeName;
          if (name === 'STYLE' || name === 'LINK') { onChange(); return; }
        }
      }
    });
    sheets.observe(doc.documentElement, { childList: true, subtree: true });
    const onAnim = (e: Event) => { const t = e.target; if (t instanceof view.Node && t !== host && (t as Node).contains(host)) onChange(); };
    for (const type of ['animationstart', 'transitionstart', 'transitionrun']) view.addEventListener(type, onAnim, true);
    return () => {
      attrs.disconnect(); sheets.disconnect();
      for (const type of ['animationstart', 'transitionstart', 'transitionrun']) view.removeEventListener(type, onAnim, true);
    };
  };
  const stopHoverPoll = (control: Element) => {
    const id = hoverPoll.get(control);
    if (id !== undefined) { view.clearInterval(id); hoverPoll.delete(control); }
    const unwatch = hoverWatch.get(control);
    if (unwatch) { unwatch(); hoverWatch.delete(control); }
  };
  const endHover = (control: Element) => { hoverSince.delete(control); stopHoverPoll(control); };
  const startHoverPoll = (control: Element) => {
    if (hoverPoll.has(control)) return;
    hoverPoll.set(control, view.setInterval(() => {
      if (destroyed || !control.isConnected || !overlayHostIntact(host)) endHover(control);
    }, HOVER_CHECK_MS));
    hoverWatch.set(control, watchHostChain(() => endHover(control)));
  };
  // A pen is exempt from the hover dwell only on positive proof that it is
  // contact-only: it entered this control with the tip down (buttons bit 1)
  // and no hovering event (tip up, even with the barrel button held) for that
  // pointer reached the control since.
  // The proof comes from the control's own events, so a page that swallows
  // events elsewhere can only make the guard stricter. A pen seen hovering
  // anywhere on the page (tip up) can hover, so it is never exempt.
  const penContactEntry = new WeakMap<Element, number>();
  const hoveringPens = new Set<number>();
  const notePenHover = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerType === 'pen' && (p.buttons & 1) === 0 && isTrusted(e)) hoveringPens.add(p.pointerId);
  };
  view.addEventListener('pointermove', notePenHover, { capture: true, passive: true });
  const notePen = (control: Element, e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerType !== 'pen' || !isTrusted(e)) return;
    if ((p.buttons & 1) === 0) { hoveringPens.add(p.pointerId); penContactEntry.delete(control); }
    else if (e.type === 'pointerover') penContactEntry.set(control, p.pointerId);
  };
  const needsHover = (e: Event, control: Element): boolean => {
    const p = e as PointerEvent;
    if (p.pointerType === 'touch') return false;
    if (p.pointerType === 'pen') return hoveringPens.has(p.pointerId) || penContactEntry.get(control) !== p.pointerId;
    return true;
  };
  const verdict = (e: MouseEvent, control: HTMLElement, ioTarget: Element, w: number, h: number): Verdict => {
    if (!isTrusted(e)) return 'tamper';
    if (movedOnScreen(ioTarget)) shownAt.set(ioTarget, now());
    if (now() - (shownAt.get(ioTarget) ?? -Infinity) < DWELL_MS) return 'wait';
    if (!overlayHostIntact(host)) return 'tamper';
    if (!drawnFullSize(control, w, h)) return 'tamper';
    // A row cut off by the viewport edge is ordinary; scroll and click again.
    if (!insideViewport(control, view)) return 'wait';
    if (ioVisible.get(ioTarget) === false && !pageFiltered()) return 'tamper';
    if (e.type === 'pointerdown' && needsHover(e, control)
      && now() - (hoverSince.get(control) ?? Infinity) < DWELL_MS) return 'wait';
    const keyboard = e.type === 'click' && e.detail === 0;
    if (keyboard) return root.activeElement === control ? 'ok' : 'tamper';
    if (typeof doc.elementsFromPoint === 'function' && doc.elementsFromPoint(e.clientX, e.clientY)[0] !== host) return 'tamper';
    return 'ok';
  };
  let armed: { control: Element; at: number } | null = null;
  // Wires the guard onto one control; `act` runs only for a click that passed.
  const guard = (control: HTMLElement, ioTarget: Element, w: number, h: number, act: () => void) => {
    const checkHover = (e: Event) => {
      notePen(control, e);
      if (!isTrusted(e) || (e as PointerEvent).pointerType === 'touch') return;
      hoverCheckedAt.set(control, now());
      if (!overlayHostIntact(host)) endHover(control);
      else if (!hoverSince.has(control)) { hoverSince.set(control, now()); startHoverPoll(control); }
    };
    control.addEventListener('pointerover', checkHover);
    control.addEventListener('pointermove', (e) => {
      notePen(control, e);
      if (now() - (hoverCheckedAt.get(control) ?? -Infinity) >= HOVER_CHECK_MS) checkHover(e);
    });
    control.addEventListener('pointerleave', () => { endHover(control); penContactEntry.delete(control); });
    control.addEventListener('pointerdown', (e) => {
      const v = verdict(e as MouseEvent, control, ioTarget, w, h);
      armed = v === 'ok' ? { control, at: now() } : null;
      if (v === 'tamper') list.style.display = 'none';
    });
    control.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const keyboard = e.detail === 0;
      const paired = keyboard || (armed !== null && armed.control === control && now() - armed.at <= PAIR_MS);
      armed = null;
      if (!paired) return;
      const v = verdict(e, control, ioTarget, w, h);
      if (v === 'ok') act();
      else if (v === 'tamper') list.style.display = 'none';
    });
  };
  // Places a control and restarts its dwell when it was hidden or now sits
  // somewhere else on screen.
  const placed = (el: HTMLElement, left: number, top: number, display: string) => {
    const wasHidden = el.style.display === 'none';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.display = display;
    if (movedOnScreen(el) || wasHidden) shownAt.set(el, now());
  };

  let iconHandler: (() => void) | null = null;
  guard(icon, icon, ICON_SIZE, ICON_SIZE, () => iconHandler?.());

  // Held so a second showToast (or an explicit hideToast) cancels the first
  // one's pending auto-hide instead of letting it blank the newer message.
  let toastTimer: ReturnType<Window['setTimeout']> | null = null;

  let genHandler: (() => void) | null = null;
  guard(gen, gen, ICON_SIZE, ICON_SIZE, () => genHandler?.());
  if (io) { io.observe(icon); io.observe(gen); io.observe(list); }

  return {
    showIcon(field, onIconClick) {
      if (!isFillableGeometry(field, host)) { this.hide(); return; }
      attach(field);
      const p = positionFor(field.getBoundingClientRect(), 0, 0);
      const q = at(iconLeftAvoiding(field, doc, host), p.top);
      placed(icon, q.left, q.top, 'grid');
      iconHandler = onIconClick;
    },
    showMatches(anchor, matches, onPick) {
      attach(anchor);
      renderMatches(list, matches, () => {});
      // Rows are wired through the guard instead of renderMatches' own click.
      list.querySelectorAll<HTMLElement>('.kokos-row').forEach((row, i) => {
        const m = matches[i]!;
        guard(row, list, ROW_MIN_WIDTH, ROW_MIN_HEIGHT, () => onPick(m));
      });
      const rect = anchor.getBoundingClientRect();
      const put = (x: number, y: number) => {
        const q = at(x, y);
        list.style.left = `${q.left}px`;
        list.style.top = `${q.top}px`;
      };
      put(rect.left, rect.bottom);
      list.style.display = 'block';
      // Keep the list on screen so its rows can pass the guard's viewport
      // check: shift it in from whichever side edge it crosses (the left one
      // wins for a list wider than the viewport), and open it above the field
      // when there is no room below. A list that fits stays at the anchor.
      const r = list.getBoundingClientRect();
      const vw = view.innerWidth || doc.documentElement.clientWidth;
      const vh = view.innerHeight || doc.documentElement.clientHeight;
      const pad = 4;
      let dx = 0;
      let dy = 0;
      if (r.width > 0) {
        if (r.right > vw - pad) dx = vw - pad - r.right;
        if (r.left + dx < pad) dx = pad - r.left;
      }
      if (r.height > 0 && r.bottom > vh - pad) {
        const above = rect.top - pad - r.height; // visual top when opened above
        dy = above >= pad ? above - r.top : Math.max(pad - r.top, vh - pad - r.bottom);
      }
      if (dx !== 0 || dy !== 0) put(rect.left + dx, rect.bottom + dy);
      shownAt.set(list, now()); // a freshly opened list always waits out the dwell
      seenAt.set(list, list.getBoundingClientRect());
    },
    showGeneratorIcon(field, onClick) {
      if (!isFillableGeometry(field, host)) { gen.style.display = 'none'; return; }
      if (icon.style.display !== 'none' && host.isConnected && targetFor(field) !== host.parentElement) {
        gen.style.display = 'none'; // the login icon holds the host elsewhere
        return;
      }
      attach(field);
      const p = positionFor(field.getBoundingClientRect(), 0, 0);
      const q = at(iconLeftAvoiding(field, doc, host), p.top);
      placed(gen, q.left, q.top, 'grid');
      genHandler = onClick;
    },
    hideGenerator() { gen.style.display = 'none'; },
    showToast(anchor, text, ms = 4000) {
      attach(anchor);
      if (toastTimer !== null) { view.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = text; // display-only text node; closed shadow DOM hides it from the page
      const rect = anchor.getBoundingClientRect();
      const q = at(rect.left, rect.bottom + 4);
      toast.style.position = '';
      toast.style.right = '';
      toast.style.left = `${q.left}px`;
      toast.style.top = `${q.top}px`;
      toast.style.display = 'block';
      if (ms > 0) toastTimer = view.setTimeout(() => { toastTimer = null; this.hideToast(); }, ms);
    },
    showNotice(text, ms = 8000) {
      attach(null);
      if (toastTimer !== null) { view.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = text;
      toast.style.position = 'fixed';
      toast.style.left = '';
      toast.style.top = '16px';
      toast.style.right = '16px';
      toast.style.display = 'block';
      if (ms > 0) toastTimer = view.setTimeout(() => { toastTimer = null; this.hideToast(); }, ms);
    },
    hideToast() { toast.style.display = 'none'; toast.textContent = ''; },
    hide() { icon.style.display = 'none'; list.style.display = 'none'; },
    destroy() {
      destroyed = true;
      io?.disconnect();
      view.removeEventListener('pointermove', notePenHover, { capture: true });
      host.remove();
    },
  };
}
