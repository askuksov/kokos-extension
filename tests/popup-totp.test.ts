// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal chrome stub so importing main.ts (which calls render() at load) does not throw.
beforeEach(() => {
  (globalThis as any).chrome = {
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn(), get: vi.fn(), reload: vi.fn() },
    runtime: { sendMessage: vi.fn(), lastError: undefined, id: 'self' },
  };
  document.body.innerHTML = '<div id="site"></div><div id="hint"></div><button id="toggle"></button><div id="list"></div><div id="save"></div>';
});

describe('buildRow TOTP actions', () => {
  it('renders Fill code + Copy code for a hasTotp entry', async () => {
    const { buildRow } = await import('../entrypoints/popup/main');
    const status = document.createElement('div');
    const row = buildRow(7, { id: 'e1', title: 'Bank', username: 'me', hasTotp: true }, status);
    const labels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toContain('Fill code');
    expect(labels).toContain('Copy code');
  });
  it('omits the TOTP actions when hasTotp is falsy', async () => {
    const { buildRow } = await import('../entrypoints/popup/main');
    const status = document.createElement('div');
    const row = buildRow(7, { id: 'e2', title: 'Site', username: 'me' }, status);
    const labels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Fill code');
    expect(labels).not.toContain('Copy code');
  });
});
