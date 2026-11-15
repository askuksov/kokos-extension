// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { displayHost, buildSiteRow, buildToggleRow } from './options-view';

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

describe('buildToggleRow', () => {
  it('renders the label as text and reflects the initial state', () => {
    const row = buildToggleRow('<b>Show</b>', true, async () => {});
    expect(row.querySelector('b')).toBeNull();
    expect(row.textContent).toBe('<b>Show</b>');
    expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });
  it('passes the new state to onChange', async () => {
    const onChange = vi.fn(async () => {});
    const row = buildToggleRow('Show', true, onChange);
    document.body.append(row); // jsdom fires change on click only for a connected box
    const box = row.querySelector('input') as HTMLInputElement;
    box.click();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it('puts the box back when saving fails', async () => {
    const row = buildToggleRow('Show', true, async () => { throw new Error('quota'); });
    document.body.append(row);
    const box = row.querySelector('input') as HTMLInputElement;
    box.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });
});
