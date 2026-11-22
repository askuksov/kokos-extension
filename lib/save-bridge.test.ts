import { describe, it, expect, vi } from 'vitest';
import { routeSaveMessage, sweepExpiredPending, PENDING_TTL_MS, type SaveBridgeDeps, type Pending } from './save-bridge';
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

    // Only repeat A's vault lookup hangs; B's own lookups answer at once.
    let release!: (r: NmhResponse) => void;
    let calls = 0;
    deps.request = vi.fn(() => ++calls === 1
      ? new Promise<NmhResponse>((r) => { release = r; })
      : Promise.resolve(ok({ items: [] })));
    const repeatA = routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await vi.waitFor(() => expect(deps.request).toHaveBeenCalled());

    // Password B arrives while A's lookup is still pending.
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'B' }, csSender, deps);
    expect(deps.pending.get(7)?.password).toBe('B');

    release(ok({ items: [] })); // the vault no longer has alice
    expect(await repeatA).toEqual({ ok: false });
    expect(deps.pending.get(7)?.password).toBe('B');
  });

  it('an older capture finishing its last consent check late does not replace a newer one', async () => {
    // Capture A's second consent check hangs until released; B runs through meanwhile.
    let releaseA!: (v: boolean) => void;
    let calls = 0;
    const deps = makeDeps({
      hasConsent: vi.fn(() => {
        calls++;
        return calls === 2 ? new Promise<boolean>((r) => { releaseA = r; }) : Promise.resolve(true);
      }),
    });
    const captureA = routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await vi.waitFor(() => expect(calls).toBe(2));

    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'B' }, csSender, deps);
    expect(deps.pending.get(7)?.password).toBe('B');

    releaseA(true);
    expect(await captureA).toEqual({ ok: false });
    expect(deps.pending.get(7)?.password).toBe('B');
  });
});

describe('unlock-and-save', () => {
  const held = (over: Partial<Pending> = {}): Pending => ({ token: 'tok', username: 'alice', password: 'pw', url: 'https://a.com/login', origin: 'https://a.com', ts: 1000, ...over });

  it('is popup-only', async () => {
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7 }, csSender, makeDeps());
    expect(res).toEqual({ ok: false, code: 'denied' });
  });

  it('unlocks with the pending url, then commits the pending', async () => {
    const unlock = vi.fn(async () => ok({ unlocked: true }));
    const request = vi.fn(async (_o: string, action: string) => (action === 'get_logins' ? ok({ items: [] }) : ok({ entry_id: 'e' })));
    const deps = makeDeps({ unlock, request });
    deps.pending.set(7, held());
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7 }, popupSender, deps) as NmhResponse;
    expect(unlock).toHaveBeenCalledWith('https://a.com/login');
    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith('https://a.com', 'save_login', expect.objectContaining({ username: 'alice', password: 'pw' }));
    expect(deps.pending.has(7)).toBe(false);
  });

  it('keeps the pending and writes nothing when the unlock is cancelled', async () => {
    const unlock = vi.fn(async () => fail('denied'));
    const deps = makeDeps({ unlock });
    deps.pending.set(7, held());
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7 }, popupSender, deps) as NmhResponse;
    expect(res.error?.code).toBe('denied');
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.pending.has(7)).toBe(true);
  });

  it('does not commit a capture that replaced the one being unlocked for', async () => {
    const deps = makeDeps();
    deps.pending.set(7, held());
    deps.unlock = vi.fn(async () => { deps.pending.set(7, held({ token: 'newer', password: 'pw2' })); return ok({ unlocked: true }); });
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7 }, popupSender, deps) as NmhResponse;
    expect(res.error?.code).toBe('bad_request');
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.pending.get(7)?.token).toBe('newer');
  });

  it('refuses a token other than the shown capture before unlocking', async () => {
    const deps = makeDeps({ unlock: vi.fn(async () => ok({ unlocked: true })) });
    deps.pending.set(7, held({ token: 'newer' }));
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7, token: 'tok' }, popupSender, deps) as NmhResponse;
    expect(res.error?.code).toBe('bad_request');
    expect(deps.unlock).not.toHaveBeenCalled();
  });

  it('a second save of the same capture while one is in flight writes nothing', async () => {
    let release!: (r: NmhResponse) => void;
    const unlock = vi.fn(() => new Promise<NmhResponse>((r) => { release = r; }));
    const deps = makeDeps({ unlock });
    deps.pending.set(7, held());
    const first = routeSaveMessage({ type: 'unlock-and-save', tabId: 7, token: 'tok' }, popupSender, deps);
    const second = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7, token: 'tok' }, popupSender, deps) as NmhResponse;
    expect(second.error?.code).toBe('bad_request');
    const commitDuring = await routeSaveMessage({ type: 'commit-pending-save', tabId: 7 }, popupSender, deps) as NmhResponse;
    expect(commitDuring.error?.code).toBe('bad_request');
    release(fail('denied'));
    await first;
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(deps.pending.get(7)?.busy).toBe(false);
  });

  it('answers without a pending capture', async () => {
    const res = await routeSaveMessage({ type: 'unlock-and-save', tabId: 7 }, popupSender, makeDeps({ unlock: vi.fn() })) as NmhResponse;
    expect(res.error?.code).toBe('bad_request');
  });
});

describe('pending lifecycle', () => {
  const capture = (password: string) => ({ type: 'save-capture', username: 'alice', password });

  it('a capture that replaces the one being committed survives the commit', async () => {
    let release!: (r: NmhResponse) => void;
    let hold = false; // only the commit's lookup hangs
    const request = vi.fn((_o: string, action: string) =>
      action === 'get_logins' && hold ? new Promise<NmhResponse>((r) => { release = r; hold = false; })
        : Promise.resolve(ok(action === 'get_logins' ? { items: [] } : { entry_id: 'e' })));
    let n = 0;
    const deps = makeDeps({ request, newToken: () => `tok${++n}` });
    await routeSaveMessage(capture('A'), csSender, deps);
    hold = true;
    const committing = routeSaveMessage({ type: 'commit-pending-save', tabId: 7, token: 'tok1' }, popupSender, deps);
    await vi.waitFor(() => expect(hold).toBe(false));

    await routeSaveMessage(capture('B'), csSender, deps);
    (deps.setBadge as any).mockClear();
    release(ok({ items: [] }));
    expect(await committing).toMatchObject({ ok: true });
    expect(deps.pending.get(7)?.password).toBe('B');
    expect(deps.setBadge).not.toHaveBeenCalledWith(7, false);
  });

  it('never-save-here keeps a capture that replaced it while the ignore was written', async () => {
    let release!: () => void;
    const deps = makeDeps({ addSaveIgnore: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    deps.pending.set(7, { token: 'old', username: 'alice', password: 'A', url: 'https://a.com/x', origin: 'https://a.com', ts: 1000 });
    const nevering = routeSaveMessage({ type: 'never-save-here', tabId: 7 }, popupSender, deps);
    await vi.waitFor(() => expect(deps.addSaveIgnore).toHaveBeenCalled());
    deps.pending.set(7, { token: 'new', username: 'alice', password: 'B', url: 'https://a.com/x', origin: 'https://a.com', ts: 1000 });
    release();
    await nevering;
    expect(deps.pending.get(7)?.token).toBe('new');
    expect(deps.setBadge).not.toHaveBeenCalledWith(7, false);
  });

  it('after expiry the same credentials are captured and badged again', async () => {
    let t = 1000;
    const deps = makeDeps({ now: () => t });
    await routeSaveMessage(capture('pw'), csSender, deps);
    t += PENDING_TTL_MS + 1;
    (deps.setBadge as any).mockClear();
    expect(await routeSaveMessage(capture('pw'), csSender, deps)).toEqual({ ok: true });
    expect(deps.pending.get(7)).toMatchObject({ password: 'pw', ts: t });
    expect(deps.setBadge).toHaveBeenCalledWith(7, true);
  });

  it('the sweep drops an idle expired capture and its badge, and keeps a fresh one', async () => {
    let t = 1000;
    const scheduleSweep = vi.fn();
    const deps = makeDeps({ now: () => t, scheduleSweep });
    await routeSaveMessage(capture('pw'), csSender, deps);
    expect(scheduleSweep).toHaveBeenCalledWith(expect.any(Number));
    expect(scheduleSweep.mock.calls[0]![0]).toBeGreaterThan(PENDING_TTL_MS);

    sweepExpiredPending(deps);
    expect(deps.pending.has(7)).toBe(true);

    t += PENDING_TTL_MS + 1;
    sweepExpiredPending(deps);
    expect(deps.pending.has(7)).toBe(false);
    expect(deps.setBadge).toHaveBeenCalledWith(7, false);
  });

  it('expiry keeps the record of a newer capture of the same login', async () => {
    let t = 1000;
    const deps = makeDeps({ now: () => t });
    await routeSaveMessage(capture('A'), csSender, deps);
    t += 60_000;
    await routeSaveMessage(capture('B'), { ...csSender, tab: { id: 8 } }, deps);
    t += 60_001; // tab 7 expired, tab 8 still live
    sweepExpiredPending(deps);
    expect(deps.pending.has(7)).toBe(false);
    // B is still on offer in tab 8, so a repeat of B elsewhere stays quiet.
    expect(await routeSaveMessage(capture('B'), { ...csSender, tab: { id: 9 } }, deps)).toEqual({ ok: false });
  });
});

describe('message shape', () => {
  it.each([
    ['a non-string username', { username: 42, password: 'pw' }],
    ['a missing username', { password: 'pw' }],
    ['a non-string password', { username: 'alice', password: { length: 3 } }],
    ['an empty password', { username: 'alice', password: '' }],
  ])('drops a capture with %s before any state change', async (_name, fields) => {
    const hasConsent = vi.fn(async () => true);
    const deps = makeDeps({ hasConsent });
    const res = await routeSaveMessage({ type: 'save-capture', ...fields }, csSender, deps);
    expect(res).toEqual({ ok: false, code: 'bad_request' });
    expect(deps.pending.size).toBe(0);
    expect(deps.captureSeq.size).toBe(0);
    expect(deps.gate.seen.size).toBe(0);
    expect(hasConsent).not.toHaveBeenCalled();
    expect(deps.setBadge).not.toHaveBeenCalled();
  });

  it('keeps an empty username (password-only forms)', async () => {
    const deps = makeDeps();
    expect(await routeSaveMessage({ type: 'save-capture', username: '', password: 'pw' }, csSender, deps)).toEqual({ ok: true });
  });

  it.each([
    ['get-pending-save', { tabId: '7' }],
    ['commit-pending-save', { tabId: 7.5 }],
    ['commit-pending-save', { tabId: 7, token: 1 }],
    ['dismiss-pending-save', { tabId: 7, token: null }],
    ['never-save-here', {}],
    ['unlock-and-save', { tabId: 7, token: ['tok'] }],
  ])('rejects %s with malformed fields %o', async (type, fields) => {
    const deps = makeDeps({ unlock: vi.fn() });
    deps.pending.set(7, { token: 'tok', username: 'alice', password: 'pw', url: 'https://a.com/x', origin: 'https://a.com', ts: 1000 });
    const res = await routeSaveMessage({ type, ...fields }, popupSender, deps);
    expect(res).toEqual({ ok: false, code: 'bad_request' });
    expect(deps.pending.has(7)).toBe(true);
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.addSaveIgnore).not.toHaveBeenCalled();
  });
});

describe('open popup notification', () => {
  it('fires when a capture is held or replaced, and when it expires', async () => {
    let t = 1000;
    const notifyPendingChanged = vi.fn();
    const deps = makeDeps({ now: () => t, notifyPendingChanged });
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'B' }, csSender, deps);
    expect(notifyPendingChanged).toHaveBeenCalledTimes(2);
    expect(notifyPendingChanged).toHaveBeenLastCalledWith(7);
    t += PENDING_TTL_MS + 1;
    sweepExpiredPending(deps);
    expect(notifyPendingChanged).toHaveBeenCalledTimes(3);
  });
  it('stays silent for a dropped duplicate', async () => {
    const notifyPendingChanged = vi.fn();
    const deps = makeDeps({ notifyPendingChanged });
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    expect(notifyPendingChanged).toHaveBeenCalledTimes(1);
  });
});

describe('typed password already stored', () => {
  const capture = { type: 'save-capture', username: 'alice', password: 'pw' };
  const vault = (check: NmhResponse) => vi.fn(async (_o: string, action: string) =>
    action === 'get_logins' ? ok({ items: [{ id: 'e1', username: 'Alice' }] }) : check);

  it('stays quiet when the one matching login already holds this password', async () => {
    const request = vault(ok({ matches: true }));
    const deps = makeDeps({ request });
    expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: false });
    expect(request).toHaveBeenCalledWith('https://a.com', 'login_password_matches', { entry_id: 'e1', password: 'pw', url: 'https://a.com/login' });
    expect(deps.pending.size).toBe(0);
    expect(deps.setBadge).not.toHaveBeenCalled();
    expect(deps.promptSave).not.toHaveBeenCalled();
  });

  it('does not remember the quiet capture, so a later vault change is offered', async () => {
    const deps = makeDeps({ request: vault(ok({ matches: true })) });
    await routeSaveMessage(capture, csSender, deps);
    deps.request = vault(ok({ matches: false }));
    expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: true });
  });

  it.each([
    ['a different password', ok({ matches: false })],
    ['an app without the action', fail('unknown_action')],
    ['a refused check', fail('denied')],
    ['a malformed answer', ok({ matches: 'yes' })],
  ])('offers the update for %s', async (_name, check) => {
    const deps = makeDeps({ request: vault(check) });
    expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: true });
    expect(deps.pending.get(7)).toMatchObject({ username: 'alice', password: 'pw' });
    expect(deps.promptSave).toHaveBeenCalledWith(7);
  });

  it('asks nothing for a new login or a locked vault', async () => {
    for (const lookup of [ok({ items: [{ id: 'e1', username: 'bob' }] }), fail('locked')]) {
      const request = vi.fn(async () => lookup);
      const deps = makeDeps({ request });
      expect(await routeSaveMessage(capture, csSender, deps)).toEqual({ ok: true });
      expect(request).not.toHaveBeenCalledWith(expect.anything(), 'login_password_matches', expect.anything());
    }
  });

  it('drops the result of a check that a newer capture overtook', async () => {
    let release!: (r: NmhResponse) => void;
    let first = true;
    const request = vi.fn((_o: string, action: string) => {
      if (action === 'get_logins') return Promise.resolve(ok({ items: [{ id: 'e1', username: 'alice' }] }));
      if (first) { first = false; return new Promise<NmhResponse>((r) => { release = r; }); }
      return Promise.resolve(ok({ matches: false }));
    });
    const deps = makeDeps({ request });
    const a = routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'A' }, csSender, deps);
    await vi.waitFor(() => expect(first).toBe(false));
    await routeSaveMessage({ type: 'save-capture', username: 'alice', password: 'B' }, csSender, deps);
    release(ok({ matches: false }));
    expect(await a).toEqual({ ok: false });
    expect(deps.pending.get(7)?.password).toBe('B');
  });
});
