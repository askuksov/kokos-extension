// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { classifyField, detectLoginForms, isUsableField, watch, watchLayout, watchSettle, perFrame, sameOriginAsTop } from './detection';

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
  it('puts a password form before an earlier formless username field', () => {
    const root = document.createElement('div');
    root.innerHTML = `<input name="cta" type="text" autocomplete="username">
      <form>
        <input name="email" type="text" autocomplete="username">
        <input name="pw" type="password" autocomplete="current-password">
      </form>`;
    const forms = detectLoginForms(root);
    expect(forms).toHaveLength(2);
    expect(forms[0]!.password?.getAttribute('name')).toBe('pw');
    expect(forms[0]!.username?.getAttribute('name')).toBe('email');
    expect(forms[1]!.password).toBeNull();
    expect(forms[1]!.username?.getAttribute('name')).toBe('cta');
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

  it('fires when a dialog or details element opens', async () => {
    const root = document.createElement('div');
    const dialog = document.createElement('dialog');
    root.appendChild(dialog);
    document.body.appendChild(root);
    const cb = vi.fn();
    const stop = watch(root, cb);
    dialog.setAttribute('open', '');
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalled();
    stop();
    root.remove();
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

  it('drops a frame that was queued before stop()', () => {
    const { win, frames, resize } = fakeWindow();
    const cb = vi.fn();
    const stop = watchLayout(win as any, cb);
    resize();
    stop();
    frames.shift()!();
    expect(cb).not.toHaveBeenCalled();
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

describe('perFrame', () => {
  function frameWindow() {
    const frames: Array<() => void> = [];
    const win = { requestAnimationFrame: (cb: FrameRequestCallback) => { frames.push(() => cb(0)); return frames.length; } };
    return { win, frames };
  }

  it('runs once per frame however many calls arrive before it', () => {
    const { win, frames } = frameWindow();
    const fn = vi.fn();
    const f = perFrame(win as any, fn);
    f.run(); f.run(); f.run();
    expect(fn).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clears the flag before calling, so a change made during the call queues a new frame', () => {
    const { win, frames } = frameWindow();
    let f: ReturnType<typeof perFrame>;
    const fn = vi.fn(() => { if (fn.mock.calls.length === 1) f.run(); });
    f = perFrame(win as any, fn);
    f.run();
    frames.shift()!();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps scheduling after a call throws', () => {
    const { win, frames } = frameWindow();
    const fn = vi.fn(() => { throw new Error('boom'); });
    const f = perFrame(win as any, fn);
    f.run();
    expect(() => frames.shift()!()).toThrow('boom');
    f.run();
    expect(frames).toHaveLength(1);
  });

  it('drops a queued frame after stop() and ignores later calls', () => {
    const { win, frames } = frameWindow();
    const fn = vi.fn();
    const f = perFrame(win as any, fn);
    f.run();
    f.stop();
    frames.shift()!();
    f.run();
    expect(frames).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('falls back to a timer without requestAnimationFrame', () => {
    const timers: Array<() => void> = [];
    const win = { setTimeout: (cb: () => void) => { timers.push(cb); return timers.length; } };
    const fn = vi.fn();
    const f = perFrame(win as any, fn);
    f.run(); f.run();
    expect(timers).toHaveLength(1);
    timers.shift()!();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('watchSettle', () => {
  function fakeTimers() {
    const timers = new Map<number, () => void>();
    let next = 1;
    const win = {
      setTimeout: (cb: () => void) => { timers.set(next, cb); return next++; },
      clearTimeout: (id: number) => { timers.delete(id); },
    };
    const flush = () => { for (const [id, cb] of [...timers]) { timers.delete(id); cb(); } };
    return { win, timers, flush };
  }

  it('settles once after the last of a burst of DOM changes', () => {
    const { win, timers, flush } = fakeTimers();
    const cb = vi.fn();
    const s = watchSettle(document, win as any, cb);
    s.onMutation(); s.onMutation(); s.onMutation();
    expect(timers.size).toBe(1);
    expect(cb).not.toHaveBeenCalled();
    flush();
    expect(cb).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('settles when a CSS transition or animation ends', () => {
    const { win } = fakeTimers();
    const cb = vi.fn();
    const s = watchSettle(document, win as any, cb);
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.dispatchEvent(new Event('transitionend', { bubbles: true }));
    el.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(2);
    // Popover/dialog toggle and dialog close do not bubble: caught in capture.
    el.dispatchEvent(new Event('toggle'));
    el.dispatchEvent(new Event('close'));
    expect(cb).toHaveBeenCalledTimes(4);
    s.stop();
    el.remove();
  });

  it('settles when fonts finish loading', () => {
    const { win } = fakeTimers();
    const fonts = new EventTarget();
    const doc = document.implementation.createHTMLDocument('t');
    Object.defineProperty(doc, 'fonts', { value: fonts });
    const cb = vi.fn();
    const s = watchSettle(doc, win as any, cb);
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(cb).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('does nothing after stop()', () => {
    const { win, timers, flush } = fakeTimers();
    const cb = vi.fn();
    const s = watchSettle(document, win as any, cb);
    s.onMutation();
    s.stop();
    flush();
    s.onMutation();
    document.body.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(timers.size).toBe(0);
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

describe('isUsableField', () => {
  const mount = (html: string) => { document.body.innerHTML = html; return document.querySelector('input')!; };

  it('accepts a plain visible input', () => {
    expect(isUsableField(mount('<input name="a">'))).toBe(true);
  });
  it('rejects type=hidden, disabled, and visibility:hidden inputs', () => {
    expect(isUsableField(mount('<input type="hidden">'))).toBe(false);
    expect(isUsableField(mount('<input disabled>'))).toBe(false);
    expect(isUsableField(mount('<input style="visibility:hidden">'))).toBe(false);
  });
  it('rejects an input inside a display:none or [hidden] ancestor', () => {
    expect(isUsableField(mount('<div style="display:none"><div><input></div></div>'))).toBe(false);
    expect(isUsableField(mount('<div hidden><input></div>'))).toBe(false);
  });
  it('keeps an input visible when an ancestor is visibility:hidden but the input resets it', () => {
    expect(isUsableField(mount('<div style="visibility:hidden"><input style="visibility:visible"></div>'))).toBe(true);
  });
  it('rejects an input in a disabled fieldset, except inside its first legend', () => {
    expect(isUsableField(mount('<fieldset disabled><input></fieldset>'))).toBe(false);
    expect(isUsableField(mount('<fieldset disabled><legend><input></legend></fieldset>'))).toBe(true);
  });
});

describe('detectLoginForms with unusable fields', () => {
  it('a hidden password form does not displace a visible username-step form', () => {
    document.body.innerHTML = `
      <form id="visible"><input name="email" type="email"></form>
      <div style="display:none"><form id="hidden"><input name="user" type="email"><input name="password" type="password"></form></div>`;
    const forms = detectLoginForms(document);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.password).toBeNull();
    expect(forms[0]!.username?.getAttribute('name')).toBe('email');
  });
  it('still puts a usable password form ahead of a username-only form', () => {
    document.body.innerHTML = `
      <input name="newsletter_email" type="email">
      <form><input name="password" type="password"></form>`;
    const forms = detectLoginForms(document);
    expect(forms[0]!.password?.getAttribute('name')).toBe('password');
  });
  it('keeps username-only detection when the only password form is hidden', () => {
    document.body.innerHTML = `
      <form><input name="email" type="email"></form>
      <form><input name="password" type="password" disabled></form>`;
    const forms = detectLoginForms(document);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.username?.getAttribute('name')).toBe('email');
  });
  it('ignores a type=hidden username field', () => {
    document.body.innerHTML = '<form><input name="user" type="hidden" autocomplete="username"></form>';
    expect(detectLoginForms(document)).toEqual([]);
  });
});
