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
  box-shadow: 0 1px 3px oklch(0 0 0 / 0.25), inset 0 1px 0 oklch(1 0 0 / 0.2); transition: filter .15s ease, transform .1s ease; }
.kokos-icon:hover, .kokos-gen:hover { filter: brightness(1.1); }
.kokos-icon:active, .kokos-gen:active { transform: scale(0.94); }
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

export function createOverlay(doc: Document = document): OverlayController {
  const view = doc.defaultView!;
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
  let destroyed = false;
  let inTopLayer = false;
  const attach = (anchor: Element | null) => {
    if (destroyed) return;
    const current = host.isConnected ? host.parentElement : null;
    const target = (anchor ? topLayerAncestor(anchor) : null)
      ?? (current && current !== doc.documentElement && inTopLayerNow(current) ? current : doc.documentElement);
    if (host.parentElement !== target) target.appendChild(host);
    const fixed = target !== doc.documentElement;
    if (fixed !== inTopLayer) {
      inTopLayer = fixed;
      host.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};${HOST_CSS}`;
    }
  };
  // Host-local coordinates for a viewport point. At the document root the host
  // scrolls with the page, so the page scroll is added; inside the top layer
  // the host's own box is the origin.
  const at = (x: number, y: number): { left: number; top: number } => {
    if (!inTopLayer) return { left: x + view.scrollX, top: y + view.scrollY };
    const o = host.getBoundingClientRect();
    return { left: x - o.left, top: y - o.top };
  };

  let iconHandler: (() => void) | null = null;
  icon.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); iconHandler?.(); });

  // Held so a second showToast (or an explicit hideToast) cancels the first
  // one's pending auto-hide instead of letting it blank the newer message.
  let toastTimer: ReturnType<Window['setTimeout']> | null = null;

  let genHandler: (() => void) | null = null;
  gen.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); genHandler?.(); });

  return {
    showIcon(field, onIconClick) {
      if (!isFillableGeometry(field, host)) { this.hide(); return; }
      attach(field);
      const p = positionFor(field.getBoundingClientRect(), 0, 0);
      const q = at(iconLeftAvoiding(field, doc, host), p.top);
      icon.style.left = `${q.left}px`;
      icon.style.top = `${q.top}px`;
      icon.style.display = 'grid';
      iconHandler = onIconClick;
    },
    showMatches(anchor, matches, onPick) {
      attach(anchor);
      renderMatches(list, matches, onPick);
      const rect = anchor.getBoundingClientRect();
      const q = at(rect.left, rect.bottom);
      list.style.left = `${q.left}px`;
      list.style.top = `${q.top}px`;
      list.style.display = 'block';
    },
    showGeneratorIcon(field, onClick) {
      if (!isFillableGeometry(field, host)) { gen.style.display = 'none'; return; }
      attach(field);
      const p = positionFor(field.getBoundingClientRect(), 0, 0);
      const q = at(iconLeftAvoiding(field, doc, host), p.top);
      gen.style.left = `${q.left}px`;
      gen.style.top = `${q.top}px`;
      gen.style.display = 'grid';
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
    destroy() { destroyed = true; host.remove(); },
  };
}
