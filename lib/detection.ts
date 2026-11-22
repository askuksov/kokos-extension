// Pure login-form detection: classify fields, group login forms, watch for SPA
// re-render, and decide whether the current frame may be filled. No chrome.*,
// no DOM writes. Signup / change-password forms (new-password, no current) are
// deliberately excluded — login fill handles existing logins only (new-password
// fields belong to the password generator).

export type FieldRole = 'username' | 'current-password' | 'new-password' | 'one-time-code' | 'unknown';

export interface LoginForm {
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
}

function hintOf(el: HTMLInputElement): string {
  return `${el.name} ${el.id} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
}

export function classifyField(el: HTMLInputElement): FieldRole {
  const type = (el.getAttribute('type') ?? el.type ?? 'text').toLowerCase();
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (ac.includes('current-password')) return 'current-password';
  if (ac.includes('new-password')) return 'new-password';
  if (ac.includes('one-time-code')) return 'one-time-code';
  if (ac.includes('username')) return 'username';
  if (type === 'password') {
    return /(new|confirm|retype|repeat|reg|sign[\s_-]?up|create)/.test(hintOf(el)) ? 'new-password' : 'current-password';
  }
  if (type === 'email') return 'username';
  if (type === 'text' || type === 'tel' || type === '') {
    if (/(user(name)?|email|e[\s_-]?mail|login|account|phone|mobile|tel)/.test(hintOf(el))) return 'username';
  }
  return 'unknown';
}

/** Can the user see and type in this input? False for type=hidden, an
 * effectively disabled control (own attribute or a disabled fieldset, minus
 * its first legend), a hidden/display:none ancestor, or visibility:hidden.
 * Computed style and attributes only, so it also works without layout (jsdom). */
export function isUsableField(input: HTMLInputElement): boolean {
  if (input.type === 'hidden' || input.matches(':disabled')) return false;
  const view = input.ownerDocument.defaultView;
  // display is not inherited: a display:none ancestor hides the subtree while
  // the input's own computed display stays unchanged, so walk up.
  for (let el: Element | null = input; el; el = el.parentElement) {
    if (el.hasAttribute('hidden')) return false;
    if (view?.getComputedStyle(el).display === 'none') return false;
  }
  // visibility is inherited, so the input's own computed value is the answer.
  return view?.getComputedStyle(input).visibility !== 'hidden';
}

export function detectLoginForms(root: ParentNode): LoginForm[] {
  const groups = new Map<HTMLFormElement | null, { u: HTMLInputElement | null; cur: HTMLInputElement | null; nw: HTMLInputElement | null }>();
  for (const el of Array.from(root.querySelectorAll('input'))) {
    const input = el as HTMLInputElement;
    const role = classifyField(input);
    // Only classified fields are checked: the style walk is not free. A hidden
    // form must not displace a visible one in forms[0].
    if (role === 'unknown' || !isUsableField(input)) continue;
    const key = input.form ?? null;
    const g = groups.get(key) ?? { u: null, cur: null, nw: null };
    if (role === 'username' && !g.u) g.u = input;
    else if (role === 'current-password' && !g.cur) g.cur = input;
    else if (role === 'new-password' && !g.nw) g.nw = input;
    groups.set(key, g);
  }
  // Forms with a password field come first: callers act on forms[0], and a
  // stray username-like field earlier in the page (a newsletter or signup
  // email box outside any form) must not win over the real login form.
  const withPassword: LoginForm[] = [];
  const usernameOnly: LoginForm[] = [];
  for (const g of groups.values()) {
    if (g.cur) withPassword.push({ username: g.u, password: g.cur });
    else if (g.nw) continue; // signup / change-password — not a login
    else if (g.u) usernameOnly.push({ username: g.u, password: null });
  }
  return [...withPassword, ...usernameOnly];
}

export function watch(target: Node, onChange: () => void): () => void {
  const obs = new MutationObserver(() => onChange());
  obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'name', 'id', 'open'] });
  return () => obs.disconnect();
}

type FrameWindow = Partial<Pick<Window, 'requestAnimationFrame' | 'setTimeout'>>;

// Runs `fn` at most once per animation frame however often `run()` is called
// before that frame. The flag is cleared before `fn` runs, so a change made
// during `fn` (or a throw) schedules a fresh frame instead of being lost.
export function perFrame(win: FrameWindow, fn: () => void): { run: () => void; stop: () => void } {
  let pending = false;
  let stopped = false;
  const schedule = win.requestAnimationFrame
    ? (cb: () => void) => { win.requestAnimationFrame!(() => cb()); }
    : (cb: () => void) => { (win.setTimeout ?? setTimeout)(cb, 16); };
  return {
    run() {
      if (pending || stopped) return;
      pending = true;
      // A frame queued before stop() must not call back after it.
      schedule(() => { pending = false; if (!stopped) fn(); });
    },
    stop() { stopped = true; },
  };
}

// Layout changes that touch no DOM node (a window resize re-flowing a centred
// form) still move the fields; the icon is placed in page coordinates, so it
// must be re-placed. Coalesced to one call per animation frame.
export function watchLayout(win: Pick<Window, 'addEventListener' | 'removeEventListener'> & FrameWindow, onChange: () => void): () => void {
  const frame = perFrame(win, onChange);
  win.addEventListener('resize', frame.run, { passive: true });
  return () => { frame.stop(); win.removeEventListener('resize', frame.run); };
}

// Layout that settles with no DOM mutation and no resize: a modal that scales
// in (script-driven animations fire no DOM event), a page that hides its
// scrollbar while a modal is open, an icon font that loads after the field
// rendered, a popover or dialog that opens or closes. `onMutation` is called
// on every DOM change; `onSettle` runs when a CSS transition or animation
// ends, when a popover or dialog toggles or a dialog closes (caught in the
// capture phase, as these do not bubble), when fonts finish loading, and once
// more `settleMs` after the last DOM change.
export function watchSettle(
  doc: Document,
  win: Pick<Window, 'setTimeout' | 'clearTimeout'>,
  onSettle: () => void,
  settleMs = 400,
): { onMutation: () => void; stop: () => void } {
  let timer: ReturnType<Window['setTimeout']> | null = null;
  let stopped = false;
  const fire = () => { if (!stopped) onSettle(); };
  const events = ['transitionend', 'animationend', 'toggle', 'close'];
  for (const e of events) doc.addEventListener(e, fire, true);
  const fonts = (doc as Document & { fonts?: EventTarget }).fonts;
  fonts?.addEventListener?.('loadingdone', fire);
  return {
    onMutation() {
      if (stopped) return;
      if (timer !== null) win.clearTimeout(timer);
      timer = win.setTimeout(() => { timer = null; fire(); }, settleMs);
    },
    stop() {
      stopped = true;
      if (timer !== null) win.clearTimeout(timer);
      for (const e of events) doc.removeEventListener(e, fire, true);
      fonts?.removeEventListener?.('loadingdone', fire);
    },
  };
}

export function sameOriginAsTop(win: Window): boolean {
  if (win === win.top) return true;
  try {
    return win.top!.location.origin === win.location.origin;
  } catch {
    return false;
  }
}
