// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { displayHost, buildSiteRow } from './options-view';

describe('displayHost', () => {
  it('shows the host (with port if present)', () => {
    expect(displayHost('https://a.com')).toBe('a.com');
    expect(displayHost('https://localhost:3000')).toBe('localhost:3000');
  });
  it('falls back to the raw string when unparseable', () => {
    expect(displayHost('not a url')).toBe('not a url');
  });
});

describe('buildSiteRow', () => {
  it('renders the host as text (never markup) and wires the action', () => {
    const onAction = vi.fn();
    const row = buildSiteRow('https://evil.com/"><img src=x>', 'Disable', onAction);
    // Host is rendered via textContent — no injected element.
    expect(row.querySelector('img')).toBeNull();
    const btn = row.querySelector('button')!;
    expect(btn.textContent).toBe('Disable');
    btn.click();
    expect(onAction).toHaveBeenCalledWith('https://evil.com/"><img src=x>');
  });
});
