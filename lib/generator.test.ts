// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectPasswordFields, fillGenerated } from './generator';
import type { NmhResponse } from './nmh-client';

function form(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

describe('detectPasswordFields', () => {
  it('finds a single new-password field on a signup form', () => {
    document.body.innerHTML = '';
    form('<form><input type="password" autocomplete="new-password"></form>');
    const out = detectPasswordFields(document);
    expect(out.length).toBe(1);
    expect(out[0]!.confirm).toBeNull();
  });
  it('pairs new-password + confirm on a change-password form', () => {
    document.body.innerHTML = '';
    form('<form><input type="password" autocomplete="new-password" name="new"><input type="password" name="confirm"></form>');
    const out = detectPasswordFields(document);
    expect(out.length).toBe(1);
    expect(out[0]!.confirm).not.toBeNull();
  });
  it('yields nothing on a login-only form', () => {
    document.body.innerHTML = '';
    form('<form><input type="text" name="user"><input type="password" autocomplete="current-password"></form>');
    expect(detectPasswordFields(document)).toEqual([]);
  });
});

describe('fillGenerated', () => {
  const okGen = (value: string): NmhResponse => ({ id: 'r', ok: true, payload: { password: value } });
  // Not-superseded by default: gen === currentGen(). isConnected always true.
  const live = { gen: 1, currentGen: () => 1, isConnected: (el: Element | null) => !!el && el.isConnected };

  it('fills primary + confirm and returns the value', async () => {
    document.body.innerHTML = '';
    form('<form><input id="p" type="password" autocomplete="new-password"><input id="c" type="password" name="confirm"></form>');
    const primary = document.getElementById('p') as HTMLInputElement;
    const confirm = document.getElementById('c') as HTMLInputElement;
    const out = await fillGenerated({ request: async () => okGen('Xy9$aB2!zQ'), fields: { primary, confirm }, ...live });
    expect(out).toEqual({ status: 'filled', value: 'Xy9$aB2!zQ' });
    expect(primary.value).toBe('Xy9$aB2!zQ');
    expect(confirm.value).toBe('Xy9$aB2!zQ');
  });

  it('fills only primary when there is no confirm field', async () => {
    document.body.innerHTML = '';
    form('<form><input id="p" type="password" autocomplete="new-password"></form>');
    const primary = document.getElementById('p') as HTMLInputElement;
    const out = await fillGenerated({ request: async () => okGen('secret1!'), fields: { primary, confirm: null }, ...live });
    expect(out.status).toBe('filled');
    expect(primary.value).toBe('secret1!');
  });

  it('returns error when generate_password fails', async () => {
    document.body.innerHTML = '';
    form('<form><input id="p" type="password" autocomplete="new-password"></form>');
    const primary = document.getElementById('p') as HTMLInputElement;
    const out = await fillGenerated({ request: async () => ({ id: 'r', ok: false, error: { code: 'internal', message: 'x' } }), fields: { primary, confirm: null }, ...live });
    expect(out).toEqual({ status: 'error' });
  });

  it('discards a superseded response without writing the field (double-click race)', async () => {
    document.body.innerHTML = '';
    form('<form><input id="p" type="password" autocomplete="new-password"></form>');
    const primary = document.getElementById('p') as HTMLInputElement;
    // Snapshot gen=1, but a second (later) generate click has since bumped the live
    // counter to 2 — this response must be discarded, not written, so the toast
    // (shown only on 'filled') can never disagree with what's in the field.
    const out = await fillGenerated({
      request: async () => okGen('stale-value'),
      fields: { primary, confirm: null },
      gen: 1,
      currentGen: () => 2,
      isConnected: (el: Element | null) => !!el && el.isConnected,
    });
    expect(out).toEqual({ status: 'discarded' });
    expect(primary.value).toBe('');
  });

  it('discards without writing when the primary field detaches while the request is in flight', async () => {
    document.body.innerHTML = '';
    const wrap = form('<form><input id="p" type="password" autocomplete="new-password"></form>');
    const primary = document.getElementById('p') as HTMLInputElement;
    // gen is unchanged (no new user gesture) but the field itself leaves the DOM
    // before the response arrives (e.g. the page re-renders the form) — the
    // generation guard alone would pass, so fillGenerated must separately notice
    // the primary is detached and discard rather than report a phantom 'filled'.
    const out = await fillGenerated({
      request: async () => {
        wrap.remove();
        return okGen('orphan-value');
      },
      fields: { primary, confirm: null },
      ...live,
    });
    expect(out).toEqual({ status: 'discarded' });
    expect(primary.value).toBe('');
  });
});
