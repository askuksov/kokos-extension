import { describe, it, expect, vi } from 'vitest';
import { routeSaveMessage, type SaveBridgeDeps, type Pending } from './save-bridge';
import { newGateState } from './save-prompt-gate';
import type { NmhResponse } from './nmh-client';

function ok(payload: unknown): NmhResponse { return { id: 'r', ok: true, payload }; }
function fail(code: string): NmhResponse { return { id: 'r', ok: false, error: { code, message: code } }; }

function makeDeps(over: Partial<SaveBridgeDeps> = {}): SaveBridgeDeps {
  return {
    ownId: 'self',
    request: vi.fn(async () => ok({ items: [] })),
    isEnabled: vi.fn(async () => true),
    isSaveIgnored: vi.fn(async () => false),
    addSaveIgnore: vi.fn(async () => {}),
    setBadge: vi.fn(),
    promptSave: vi.fn(),
    now: () => 1000,
    newToken: () => 'tok',
    gate: newGateState(),
    pending: new Map<number, Pending>(),
    captureSeq: new Map<number, number>(),
    ...over,
  };
}
const csSender = { id: 'self', origin: 'https://a.com', url: 'https://a.com/login', tab: { id: 7 } };
const popupSender = { id: 'self' };

describe('routeSaveMessage — auth', () => {
  it('rejects a foreign sender id', async () => {
    const res = await routeSaveMessage({ type: 'save-capture', username: 'u', password: 'p' }, { id: 'evil', origin: 'https://a.com', tab: { id: 7 } }, makeDeps());
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
  it('ignores a non-save message (returns null)', async () => {
    expect(await routeSaveMessage({ type: 'nmh-request' }, popupSender, makeDeps())).toBeNull();
  });
  it('rejects a popup-only action arriving from a tab frame', async () => {
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok' }, csSender, makeDeps());
    expect(res).toEqual({ ok: false, code: 'denied' });
  });
});

describe('save-capture', () => {
  it('stores a pending keyed by the trusted sender tab and badges it', async () => {
    const deps = makeDeps();
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    const p = deps.pending.get(7)!;
    expect(p).toMatchObject({ username: 'alice', password: 'pw', url: 'https://a.com/login', origin: 'https://a.com', token: 'tok' });
    expect(deps.setBadge).toHaveBeenCalledWith(7, true);
    expect(deps.promptSave).toHaveBeenCalledWith(7);
  });
  it('drops a capture from a site that is no longer enabled', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) });
    const res = await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(res).toEqual({ ok: false });
    expect(deps.pending.size).toBe(0);
    expect(deps.setBadge).not.toHaveBeenCalled();
    expect(deps.promptSave).not.toHaveBeenCalled();
  });
  it('checks site access against the trusted sender url, not the message body', async () => {
    const isEnabled = vi.fn(async () => true);
    const deps = makeDeps({ isEnabled });
    await routeSaveMessage(
      { type: 'save-capture', username: 'alice', password: 'pw', url: 'https://evil.com/x' } as any,
      csSender,
      deps,
    );
    expect(isEnabled).toHaveBeenCalledWith('https://a.com/login');
  });
  it('drops a capture while data-sharing consent is missing, before any other check', async () => {
    const isEnabled = vi.fn(async () => true);
    const deps = makeDeps({ hasConsent: vi.fn(async () => false), isEnabled });
    const res = await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(res).toEqual({ ok: false });
    expect(deps.pending.size).toBe(0);
    expect(isEnabled).not.toHaveBeenCalled();
    expect(deps.promptSave).not.toHaveBeenCalled();
  });
  it('drops a capture when consent is withdrawn while the site checks run', async () => {
    let calls = 0;
    const deps = makeDeps({ hasConsent: vi.fn(async () => ++calls === 1) });
    const res = await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(res).toEqual({ ok: false });
    expect(deps.pending.size).toBe(0);
    expect(deps.promptSave).not.toHaveBeenCalled();
  });
  it('keeps a capture once consent is given', async () => {
    const deps = makeDeps({ hasConsent: vi.fn(async () => true) });
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(deps.pending.has(7)).toBe(true);
  });
  it('drops when the origin is on the never-save list', async () => {
    const deps = makeDeps({ isSaveIgnored: vi.fn(async () => true) });
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(deps.pending.size).toBe(0);
    expect(deps.setBadge).not.toHaveBeenCalled();
  });
  it('drops a duplicate (same value) but re-arms on a changed value', async () => {
    const deps = makeDeps();
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    deps.pending.delete(7); (deps.setBadge as any).mockClear();
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'pw' }, csSender, deps);
    expect(deps.pending.size).toBe(0); // deduped
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'CHANGED' }, csSender, deps);
    expect(deps.pending.get(7)).toBeTruthy(); // re-armed
  });
  it('ignores a spoofed origin/url in the save-capture message body — uses the sender', async () => {
    const deps = makeDeps();
    await routeSaveMessage(
      { type: 'save-capture', username: 'alice', password: 'pw', origin: 'https://evil.com', url: 'https://evil.com/x' } as any,
      csSender,
      deps,
    );
    const p = deps.pending.get(7)!;
    expect(p.origin).toBe('https://a.com');
    expect(p.url).toBe('https://a.com/login');
  });
  it('rejects save-capture from a sender with no tab', async () => {
    const deps = makeDeps();
    const res = await routeSaveMessage({ type: 'save-capture', username: 'u', password: 'p' }, popupSender, deps);
    expect(deps.pending.size).toBe(0);
    expect(res).toEqual({ ok: false });
  });
});

describe('get-pending / commit classification', () => {
  const seed = (deps: SaveBridgeDeps) => deps.pending.set(7, { token: 'tok', username: 'alice', password: 'pw', url: 'https://a.com/login', origin: 'https://a.com', ts: 1000 });

  it('classifies save when no username matches', async () => {
    const deps = makeDeps({ request: vi.fn(async () => ok({ items: [{ id: '1', username: 'bob' }] })) }); seed(deps);
    const view = await routeSaveMessage({ type: 'get-pending-save', tabId: 7 }, popupSender, deps);
    expect(view).toMatchObject({ present: true, mode: 'save', username: 'alice' });
  });
  it('classifies update when exactly one username matches', async () => {
    const deps = makeDeps({ request: vi.fn(async () => ok({ items: [{ id: '2', username: 'alice' }] })) }); seed(deps);
    const view = await routeSaveMessage({ type: 'get-pending-save', tabId: 7 }, popupSender, deps);
    expect(view).toMatchObject({ present: true, mode: 'update' });
  });
  it('reports locked instead of a save when the vault is locked', async () => {
    const deps = makeDeps({ request: vi.fn(async () => fail('locked')) }); seed(deps);
    const view = await routeSaveMessage({ type: 'get-pending-save', tabId: 7 }, popupSender, deps);
    expect(view).toMatchObject({ present: true, locked: true });
  });
  it('returns present:false for an expired pending (>2min)', async () => {
    const deps = makeDeps({ now: () => 1000 + 120001 }); seed(deps);
    const view = await routeSaveMessage({ type: 'get-pending-save', tabId: 7 }, popupSender, deps);
    expect(view).toEqual({ present: false });
  });
});

describe('commit', () => {
  const seed = (deps: SaveBridgeDeps) => deps.pending.set(7, { token: 'tok', username: 'alice', password: 'pw', url: 'https://a.com/login', origin: 'https://a.com', ts: 1000 });

  it('issues save_login with a clamped username and the trusted url, then clears', async () => {
    const request = vi.fn(async (_o: string, action: string) => action === 'get_logins' ? ok({ items: [] }) : ok({ entry_id: 'new' }));
    const deps = makeDeps({ request }); seed(deps);
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok' }, popupSender, deps) as NmhResponse;
    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith('https://a.com', 'save_login', { url: 'https://a.com/login', username: 'alice', password: 'pw' });
    expect(deps.pending.has(7)).toBe(false);
    expect(deps.setBadge).toHaveBeenCalledWith(7, false);
  });
  it('issues update_login when one username matches', async () => {
    const request = vi.fn(async (_o: string, action: string) => action === 'get_logins' ? ok({ items: [{ id: '2', username: 'alice' }] }) : ok({ ok: true }));
    const deps = makeDeps({ request }); seed(deps);
    await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok' }, popupSender, deps);
    expect(request).toHaveBeenCalledWith('https://a.com', 'update_login', { entry_id: '2', password: 'pw', url: 'https://a.com/login' });
  });
  it('rejects a superseded (present, non-matching) token and does NOT write', async () => {
    const request = vi.fn(async () => ok({ items: [] }));
    const deps = makeDeps({ request }); seed(deps);
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'stale' }, popupSender, deps) as NmhResponse;
    expect(res.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(deps.pending.has(7)).toBe(true); // kept for a real retry
  });
  it('commits the live pending when the popup omits the token', async () => {
    const request = vi.fn(async (_o: string, action: string) => action === 'get_logins' ? ok({ items: [] }) : ok({ entry_id: 'new' }));
    const deps = makeDeps({ request }); seed(deps);
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7 }, popupSender, deps) as NmhResponse;
    expect(res.ok).toBe(true);
    expect(deps.pending.has(7)).toBe(false);
  });
  it('clears the pending when the write is denied', async () => {
    const request = vi.fn(async (_o: string, action: string) => action === 'get_logins' ? ok({ items: [] }) : fail('denied'));
    const deps = makeDeps({ request }); seed(deps);
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok' }, popupSender, deps) as NmhResponse;
    expect(res.ok).toBe(false);
    expect(deps.pending.has(7)).toBe(false);
  });
  it('keeps the pending when the write is locked (transient)', async () => {
    const request = vi.fn(async (_o: string, action: string) => action === 'get_logins' ? ok({ items: [] }) : fail('locked'));
    const deps = makeDeps({ request }); seed(deps);
    const res = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok' }, popupSender, deps) as NmhResponse;
    expect(res.ok).toBe(false);
    expect(deps.pending.has(7)).toBe(true);
  });
});

describe('dismiss / never', () => {
  it('dismiss clears the pending on a matching token', async () => {
    const deps = makeDeps(); deps.pending.set(7, { token: 'tok', username: 'a', password: 'p', url: 'https://a.com/x', origin: 'https://a.com', ts: 1000 });
    await routeSaveMessage({ type: 'dismiss-pending-save', tabId: 7, token: 'tok' }, popupSender, deps);
    expect(deps.pending.has(7)).toBe(false);
  });
  it('never adds the origin to the ignore list and clears', async () => {
    const deps = makeDeps(); deps.pending.set(7, { token: 'tok', username: 'a', password: 'p', url: 'https://a.com/x', origin: 'https://a.com', ts: 1000 });
    await routeSaveMessage({ type: 'never-save-here', tabId: 7 }, popupSender, deps);
    expect(deps.addSaveIgnore).toHaveBeenCalledWith('https://a.com/x');
    expect(deps.pending.has(7)).toBe(false);
  });
});

describe('save-capture — re-offer after the saved entry is deleted', () => {
  const capture = { type: 'save-capture', username: 'alice', password: 'pw' };
  const commitMsg = { type: 'commit-pending-save', tabId: 7 };

  async function saveOnce(deps: SaveBridgeDeps) {
    await routeSaveMessage(capture, csSender, deps);
    const res = await routeSaveMessage(commitMsg, popupSender, deps);
    expect(res).toMatchObject({ ok: true });
    expect(deps.pending.size).toBe(0);
  }

  it('offers the same login again when the vault no longer has it', async () => {
    const deps = makeDeps(); // get_logins -> no items: the entry is gone
    await saveOnce(deps);
    const res = await routeSaveMessage(capture, csSender, deps);
    expect(res).toEqual({ ok: true });
    expect(deps.pending.get(7)).toBeTruthy();
  });
  it('stays quiet while the vault still has that login', async () => {
    const deps = makeDeps();
    await saveOnce(deps);
    deps.request = vi.fn(async () => ok({ items: [{ id: 'e1', title: 'a.com', username: ' Alice ' }] }));
    const res = await routeSaveMessage(capture, csSender, deps);
    expect(res).toEqual({ ok: false });
    expect(deps.pending.size).toBe(0);
  });
  it('stays quiet when the app is locked (cannot tell)', async () => {
    const deps = makeDeps();
    await saveOnce(deps);
    deps.request = vi.fn(async () => fail('locked'));
    expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: false });
  });
  it('keeps the plain dedupe after Not now, without asking the vault', async () => {
    const deps = makeDeps();
    await routeSaveMessage(capture, csSender, deps);
    await routeSaveMessage({ type: 'dismiss-pending-save', tabId: 7 }, popupSender, deps);
    (deps.request as any).mockClear();
    expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: false });
    expect(deps.request).not.toHaveBeenCalled();
  });
});

describe('save-capture — out-of-order completion', () => {
  it('an older capture finishing its vault check late does not replace a newer one', async () => {
    const deps = makeDeps();
    // Save password A so a repeat of A goes through the vault check.
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await routeSaveMessage({ type: 'commit-pending-save', tabId: 7 }, popupSender, deps);

    let release!: (r: NmhResponse) => void;
    deps.request = vi.fn(() => new Promise<NmhResponse>((r) => { release = r; }));
    const repeatA = routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await vi.waitFor(() => expect(deps.request).toHaveBeenCalled());

    // Password B arrives while A's lookup is still pending.
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'B' }, csSender, deps);
    expect(deps.pending.get(7)?.password).toBe('B');

    release(ok({ items: [] })); // the vault no longer has alice
    expect(await repeatA).toEqual({ ok: false });
    expect(deps.pending.get(7)?.password).toBe('B');
  });
});
