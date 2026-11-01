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

export function detectLoginForms(root: ParentNode): LoginForm[] {
  const groups = new Map<HTMLFormElement | null, { u: HTMLInputElement | null; cur: HTMLInputElement | null; nw: HTMLInputElement | null }>();
  for (const el of Array.from(root.querySelectorAll('input'))) {
    const input = el as HTMLInputElement;
    const role = classifyField(input);
    const key = input.form ?? null;
    const g = groups.get(key) ?? { u: null, cur: null, nw: null };
    if (role === 'username' && !g.u) g.u = input;
    else if (role === 'current-password' && !g.cur) g.cur = input;
    else if (role === 'new-password' && !g.nw) g.nw = input;
    groups.set(key, g);
  }
  const out: LoginForm[] = [];
  for (const g of groups.values()) {
    if (g.cur) out.push({ username: g.u, password: g.cur });
    else if (g.nw) continue; // signup / change-password — not a login
    else if (g.u) out.push({ username: g.u, password: null });
  }
  return out;
}

export function watch(target: Node, onChange: () => void): () => void {
  const obs = new MutationObserver(() => onChange());
  obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'name', 'id'] });
  return () => obs.disconnect();
}

export function sameOriginAsTop(win: Window): boolean {
  if (win === win.top) return true;
  try {
    return win.top!.location.origin === win.location.origin;
  } catch {
    return false;
  }
}
