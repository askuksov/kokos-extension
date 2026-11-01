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

const ICON_SIZE = 20;

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
.kokos-icon { position: absolute; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; padding: 0;
  border: none; border-radius: 4px; background: #f5c518; cursor: pointer; font-size: 12px; line-height: ${ICON_SIZE}px; }
.kokos-list { position: absolute; min-width: 180px; max-height: 240px; overflow-y: auto;
  background: #fff; color: #111; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.2); font: 13px system-ui; }
.kokos-row { display: flex; gap: 8px; align-items: baseline; padding: 8px 10px; cursor: pointer; }
.kokos-row:hover { background: #f2f2f2; }
.kokos-title { font-weight: 600; }
.kokos-user { color: #666; }
.kokos-totp { margin-left: auto; font-size: 10px; color: #a06400; border: 1px solid #e0c060; border-radius: 3px; padding: 0 4px; }
.kokos-gen { position: absolute; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; padding: 0;
  border: none; border-radius: 4px; background: #4a90d9; color: #fff; cursor: pointer; font-size: 12px; line-height: ${ICON_SIZE}px; }
.kokos-toast { position: absolute; width: max-content; max-width: 260px; background: #111; color: #fff;
  font: 12px system-ui; line-height: 1.4; padding: 6px 8px; border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); overflow-wrap: anywhere; }
`;

export function isFillableGeometry(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return !!hit && (hit === el || el.contains(hit));
}

export function positionFor(rect: { left: number; top: number; width: number; height: number }, scrollX: number, scrollY: number): { left: number; top: number } {
  return {
    left: rect.left + scrollX + rect.width - ICON_SIZE - 4,
    top: rect.top + scrollY + (rect.height - ICON_SIZE) / 2,
  };
}

export function renderMatches(container: HTMLElement | ShadowRoot, matches: OverlayMatch[], onPick: (m: OverlayMatch) => void): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  const doc = container instanceof ShadowRoot ? container.host.ownerDocument : container.ownerDocument;
  for (const m of matches) {
    const row = doc.createElement('div');
    row.className = 'kokos-row';
    const title = doc.createElement('span');
    title.className = 'kokos-title';
    title.textContent = m.title || m.username || '(entry)';
    const user = doc.createElement('span');
    user.className = 'kokos-user';
    user.textContent = m.username ?? '';
    row.append(title, user);
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
  hideToast(): void;
  hide(): void;
  destroy(): void;
}

export function createOverlay(doc: Document = document): OverlayController {
  const view = doc.defaultView!;
  const host = doc.createElement('div');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;
  const icon = doc.createElement('button');
  icon.type = 'button';
  icon.className = 'kokos-icon';
  icon.textContent = '\u{1F511}';
  icon.style.display = 'none';
  const list = doc.createElement('div');
  list.className = 'kokos-list';
  list.style.display = 'none';
  const gen = doc.createElement('button');
  gen.type = 'button';
  gen.className = 'kokos-gen';
  gen.textContent = '\u{1F3B2}'; // 🎲
  gen.style.display = 'none';
  const toast = doc.createElement('div');
  toast.className = 'kokos-toast';
  toast.style.display = 'none';
  root.append(style, icon, list, gen, toast);
  doc.documentElement.appendChild(host);

  let iconHandler: (() => void) | null = null;
  icon.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); iconHandler?.(); });

  // Held so a second showToast (or an explicit hideToast) cancels the first
  // one's pending auto-hide instead of letting it blank the newer message.
  let toastTimer: ReturnType<Window['setTimeout']> | null = null;

  let genHandler: (() => void) | null = null;
  gen.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); genHandler?.(); });

  return {
    showIcon(field, onIconClick) {
      if (!isFillableGeometry(field)) { this.hide(); return; }
      const p = positionFor(field.getBoundingClientRect(), view.scrollX, view.scrollY);
      icon.style.left = `${p.left}px`;
      icon.style.top = `${p.top}px`;
      icon.style.display = 'block';
      iconHandler = onIconClick;
    },
    showMatches(anchor, matches, onPick) {
      renderMatches(list, matches, onPick);
      const rect = anchor.getBoundingClientRect();
      list.style.left = `${rect.left + view.scrollX}px`;
      list.style.top = `${rect.bottom + view.scrollY}px`;
      list.style.display = 'block';
    },
    showGeneratorIcon(field, onClick) {
      if (!isFillableGeometry(field)) { gen.style.display = 'none'; return; }
      const p = positionFor(field.getBoundingClientRect(), view.scrollX, view.scrollY);
      gen.style.left = `${p.left}px`;
      gen.style.top = `${p.top}px`;
      gen.style.display = 'block';
      genHandler = onClick;
    },
    hideGenerator() { gen.style.display = 'none'; },
    showToast(anchor, text, ms = 4000) {
      if (toastTimer !== null) { view.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = text; // display-only text node; closed shadow DOM hides it from the page
      const rect = anchor.getBoundingClientRect();
      toast.style.left = `${rect.left + view.scrollX}px`;
      toast.style.top = `${rect.bottom + view.scrollY + 4}px`;
      toast.style.display = 'block';
      if (ms > 0) toastTimer = view.setTimeout(() => { toastTimer = null; this.hideToast(); }, ms);
    },
    hideToast() { toast.style.display = 'none'; toast.textContent = ''; },
    hide() { icon.style.display = 'none'; list.style.display = 'none'; },
    destroy() { host.remove(); },
  };
}
