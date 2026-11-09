import { describe, it, expect, vi } from 'vitest';
import { pickFrame, resolveFillFrame, PROBE_KEY, type ProbedFrame } from './frame-target';

const probe = (login: boolean, otp = false) => ({ login, otp });

describe('pickFrame', () => {
  it('keeps the top frame when it has the form', () => {
    const frames: ProbedFrame[] = [
      { frameId: 0, result: probe(true) },
      { frameId: 7, result: probe(true) },
    ];
    expect(pickFrame(frames, 'login')).toBe(0);
  });

  it('picks the subframe that holds the form when the top frame has none', () => {
    const frames: ProbedFrame[] = [
      { frameId: 0, result: probe(false) },
      { frameId: 3, result: probe(false) },
      { frameId: 5, result: probe(true) },
    ];
    expect(pickFrame(frames, 'login')).toBe(5);
  });

  it('looks for the one-time-code field independently of the login form', () => {
    const frames: ProbedFrame[] = [
      { frameId: 0, result: probe(true, false) },
      { frameId: 4, result: probe(false, true) },
    ];
    expect(pickFrame(frames, 'otp')).toBe(4);
    expect(pickFrame(frames, 'login')).toBe(0);
  });

  it('skips frames without a probe (cross-origin frames never run the content script)', () => {
    const frames: ProbedFrame[] = [
      { frameId: 0, result: probe(false) },
      { frameId: 2, result: null },
      { frameId: 9, result: { login: 'yes' } },
    ];
    expect(pickFrame(frames, 'login')).toBe(0);
  });

  it('falls back to the top frame when nothing matches', () => {
    expect(pickFrame([], 'login')).toBe(0);
  });
});

describe('resolveFillFrame', () => {
  it('probes every frame with the shared key', async () => {
    const executeScript = vi.fn(async () => [
      { frameId: 0, result: probe(false) },
      { frameId: 8, result: probe(true) },
    ]);
    await expect(resolveFillFrame(11, 'login', { executeScript })).resolves.toBe(8);
    expect(executeScript).toHaveBeenCalledWith(11, PROBE_KEY);
  });

  it('keeps the top frame when probing fails (site not enabled, restricted page)', async () => {
    const executeScript = vi.fn(async () => { throw new Error('Cannot access contents of the page'); });
    await expect(resolveFillFrame(11, 'login', { executeScript })).resolves.toBe(0);
  });
});
