// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { classifyField, detectLoginForms, watch, watchLayout, sameOriginAsTop } from './detection';

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('classifyField', () => {
  it('reads autocomplete tokens first', () => {
    expect(classifyField(input({ autocomplete: 'section-a current-password', type: 'password' }))).toBe('current-password');
    expect(classifyField(input({ autocomplete: 'new-password', type: 'password' }))).toBe('new-password');
    expect(classifyField(input({ autocomplete: 'one-time-code' }))).toBe('one-time-code');
    expect(classifyField(input({ autocomplete: 'username' }))).toBe('username');
  });
  it('sub-classifies a bare password by name/id hints', () => {
    expect(classifyField(input({ type: 'password', name: 'password' }))).toBe('current-password');
    expect(classifyField(input({ type: 'password', name: 'confirm_password' }))).toBe('new-password');
    expect(classifyField(input({ type: 'password', id: 'newPass' }))).toBe('new-password');
  });
  it('recognises usernames only on a positive signal', () => {
    expect(classifyField(input({ type: 'email' }))).toBe('username');
    expect(classifyField(input({ type: 'text', name: 'login' }))).toBe('username');
    expect(classifyField(input({ type: 'text', name: 'q', placeholder: 'Search' }))).toBe('unknown');
  });
});

describe('detectLoginForms', () => {
  it('groups a classic username + current-password form', () => {
    const root = document.createElement('div');
    root.innerHTML = `<form>
      <input name="email" type="email">
      <input name="password" type="password" autocomplete="current-password">
    </form>`;
    const forms = detectLoginForms(root);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.username?.getAttribute('name')).toBe('email');
    expect(forms[0]!.password?.getAttribute('name')).toBe('password');
  });
  it('returns a username-step form when there is no password field yet', () => {
    const root = document.createElement('div');
    root.innerHTML = `<form><input name="username" type="text" autocomplete="username"></form>`;
    const forms = detectLoginForms(root);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.password).toBeNull();
    expect(forms[0]!.username?.getAttribute('name')).toBe('username');
  });
  it('excludes a signup / change-password form (new-password, no current-password)', () => {
    const root = document.createElement('div');
    root.innerHTML = `<form>
      <input name="email" type="email">
      <input name="new_password" type="password" autocomplete="new-password">
    </form>`;
    expect(detectLoginForms(root)).toHaveLength(0);
  });
});

describe('watch', () => {
  it('fires onChange on a subtree mutation and stops after disconnect', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cb = vi.fn();
    const stop = watch(root, cb);
    root.appendChild(document.createElement('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalled();
    stop();
    cb.mockClear();
    root.appendChild(document.createElement('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps firing on a Document after the page replaces <html>', async () => {
    const doc = document.implementation.createHTMLDocument('t');
    const cb = vi.fn();
    const stop = watch(doc, cb);
    const fresh = doc.createElement('html');
    fresh.appendChild(doc.createElement('body'));
    doc.replaceChild(fresh, doc.documentElement);
    await new Promise((r) => setTimeout(r, 0));
    cb.mockClear();
    doc.body.appendChild(doc.createElement('input')); // the form a SPA renders afterwards
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalled();
    stop();
  });
});

describe('watchLayout', () => {
  function fakeWindow() {
    const target = new EventTarget();
    const frames: Array<() => void> = [];
    const win = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      requestAnimationFrame: (cb: FrameRequestCallback) => { frames.push(() => cb(0)); return frames.length; },
    };
    return { win, frames, resize: () => target.dispatchEvent(new Event('resize')) };
  }

  it('re-places once per frame however many resize events arrive', () => {
    const { win, frames, resize } = fakeWindow();
    const cb = vi.fn();
    watchLayout(win as any, cb);
    resize(); resize(); resize();
    expect(cb).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(cb).toHaveBeenCalledTimes(1);
    resize();
    frames.shift()!();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops listening after the returned stop()', () => {
    const { win, frames, resize } = fakeWindow();
    const cb = vi.fn();
    const stop = watchLayout(win as any, cb);
    stop();
    resize();
    expect(frames).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('sameOriginAsTop', () => {
  it('true when the frame is the top', () => {
    const w = {} as any; w.top = w; w.location = { origin: 'https://a.com' };
    expect(sameOriginAsTop(w)).toBe(true);
  });
  it('true when top has the same origin', () => {
    const w = { location: { origin: 'https://a.com' }, top: { location: { origin: 'https://a.com' } } } as any;
    expect(sameOriginAsTop(w)).toBe(true);
  });
  it('false when reading top.location.origin throws (cross-origin)', () => {
    const w = { location: { origin: 'https://a.com' }, top: { get location() { throw new Error('cross-origin'); } } } as any;
    expect(sameOriginAsTop(w)).toBe(false);
  });
});
