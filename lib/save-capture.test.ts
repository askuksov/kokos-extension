// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { snapshotCredentials, classifySave, clampSaveField, isSubmitControl } from './save-capture';
import type { LoginForm } from './detection';
import type { LoginItem } from './nmh-client';

function field(value: string): HTMLInputElement {
  const el = document.createElement('input');
  el.value = value;
  document.body.appendChild(el); // isConnected === true
  return el;
}
function form(u: string | null, p: string | null): LoginForm {
  return { username: u === null ? null : field(u), password: p === null ? null : field(p) };
}

describe('snapshotCredentials', () => {
  it('reads username + password values once when password is non-empty', () => {
    expect(snapshotCredentials(form('alice', 'hunter2'))).toEqual({ username: 'alice', password: 'hunter2' });
  });
  it('returns null when there is no password field', () => {
    expect(snapshotCredentials(form('alice', null))).toBeNull();
  });
  it('returns null when the password is empty (nothing to save)', () => {
    expect(snapshotCredentials(form('alice', ''))).toBeNull();
  });
  it('uses an empty username when no username field is present', () => {
    expect(snapshotCredentials(form(null, 'hunter2'))).toEqual({ username: '', password: 'hunter2' });
  });
  it('returns null when the password field is detached', () => {
    const pw = document.createElement('input'); pw.value = 'x'; // not appended -> !isConnected
    expect(snapshotCredentials({ username: null, password: pw })).toBeNull();
  });
  it('uses an empty username when the username field is detached', () => {
    const un = document.createElement('input'); un.value = 'stale'; // not appended -> !isConnected
    expect(snapshotCredentials({ username: un, password: field('hunter2') })).toEqual({ username: '', password: 'hunter2' });
  });
});

describe('classifySave', () => {
  const item = (id: string, username: string | null): LoginItem => ({ id, title: 't', username, hasTotp: false });
  it('0 username matches -> save', () => {
    expect(classifySave({ username: 'alice' }, [item('1', 'bob')])).toEqual({ mode: 'save' });
  });
  it('exactly 1 username match -> update that entry', () => {
    expect(classifySave({ username: 'alice' }, [item('1', 'bob'), item('2', 'alice')])).toEqual({ mode: 'update', entryId: '2' });
  });
  it('>=2 username matches -> save (never blind-overwrite the wrong entry)', () => {
    expect(classifySave({ username: 'alice' }, [item('1', 'alice'), item('2', 'alice')])).toEqual({ mode: 'save' });
  });
  it('matches case-insensitively and trimmed', () => {
    expect(classifySave({ username: ' Alice ' }, [item('9', 'alice')])).toEqual({ mode: 'update', entryId: '9' });
  });
});

describe('clampSaveField', () => {
  it('leaves a string at or under the cap unchanged', () => {
    expect(clampSaveField('abc', 3)).toBe('abc');
  });
  it('truncates to exactly max characters', () => {
    expect(clampSaveField('abcdef', 3)).toBe('abc');
  });
  it('never splits a multi-byte character', () => {
    expect(clampSaveField('😀😁', 1)).toBe('😀');
  });
});

describe('isSubmitControl', () => {
  function el(html: string): Element {
    const host = document.createElement('div'); host.innerHTML = html; return host.firstElementChild!;
  }
  it('accepts a bare submit button', () => {
    expect(isSubmitControl(el('<button>Go</button>'))).toBe(true);
  });
  it('accepts a login-labelled type=button', () => {
    expect(isSubmitControl(el('<button type="button">Sign in</button>'))).toBe(true);
  });
  it('rejects a non-login type=button', () => {
    expect(isSubmitControl(el('<button type="button">Menu</button>'))).toBe(false);
  });
  it('rejects an unrelated element', () => {
    expect(isSubmitControl(el('<span>hi</span>'))).toBe(false);
  });
});
