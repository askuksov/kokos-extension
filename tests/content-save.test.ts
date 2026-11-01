// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as any).defineContentScript ??= (cfg: unknown) => cfg;

const { wireSaveCapture } = await import('../entrypoints/content');

beforeEach(() => { document.body.innerHTML = ''; });

function loginForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="f">
      <input name="username" type="text" value="alice">
      <input name="password" type="password" value="hunter2">
      <button type="submit">Log in</button>
    </form>`;
  return document.getElementById('f') as HTMLFormElement;
}

describe('wireSaveCapture', () => {
  it('captures on submit and sends the snapshot', () => {
    const f = loginForm();
    const send = vi.fn();
    wireSaveCapture(document, send);
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(send).toHaveBeenCalledWith({ username: 'alice', password: 'hunter2' });
  });

  it('does not send when the password is empty', () => {
    const f = loginForm();
    (f.querySelector('[name=password]') as HTMLInputElement).value = '';
    const send = vi.fn();
    wireSaveCapture(document, send);
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
  });

  it('captures a formless SPA login on a login-button click', () => {
    document.body.innerHTML = `
      <div>
        <input name="email" type="text" value="alice">
        <input name="password" type="password" value="hunter2">
        <button type="button" id="go">Sign in</button>
      </div>`;
    const send = vi.fn();
    wireSaveCapture(document, send);
    (document.getElementById('go') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({ username: 'alice', password: 'hunter2' });
  });

  it('ignores a click on a non-submit control', () => {
    loginForm();
    document.body.insertAdjacentHTML('beforeend', '<button type="button" id="menu">Menu</button>');
    const send = vi.fn();
    wireSaveCapture(document, send);
    (document.getElementById('menu') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not capture a signup form (new-password, no current)', () => {
    document.body.innerHTML = `
      <form id="s">
        <input name="email" type="text" value="alice">
        <input name="new_password" type="password" value="hunter2">
        <button type="submit">Create account</button>
      </form>`;
    const send = vi.fn();
    wireSaveCapture(document, send);
    (document.getElementById('s') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled(); // detectLoginForms excludes new-password-only forms
  });
});
