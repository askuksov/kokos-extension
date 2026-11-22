// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { displayOrigin, createQueue, buildSiteRow, buildToggleRow } from './options-view';

describe('displayOrigin', () => {
  it('shows the scheme and host (with port if present)', () => {
    expect(displayOrigin('https://a.com')).toBe('https://a.com');
    expect(displayOrigin('http://a.com')).toBe('http://a.com');
    expect(displayOrigin('https://localhost:3000')).toBe('https://localhost:3000');
  });
  it('keeps http and https of the same host distinguishable', () => {
    expect(displayOrigin('http://a.com')).not.toBe(displayOrigin('https://a.com'));
  });
  it('strips any path', () => {
    expect(displayOrigin('https://a.com/login?x=1')).toBe('https://a.com');
  });
  it('falls back to the raw string when unparseable or opaque', () => {
    expect(displayOrigin('not a url')).toBe('not a url');
    expect(displayOrigin('data:text/plain,hi')).toBe('data:text/plain,hi');
  });
});

describe('createQueue', () => {
  it('runs tasks one at a time in call order', async () => {
    const queue = createQueue();
    const log: string[] = [];
    const slow = queue(async () => { log.push('a:start'); await new Promise((r) => setTimeout(r, 10)); log.push('a:end'); });
    const fast = queue(async () => { log.push('b:start'); log.push('b:end'); });
    await Promise.all([slow, fast]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
  it('keeps going after a failed task and still rejects that caller', async () => {
    const queue = createQueue();
    const failed = queue(async () => { throw new Error('boom'); });
    const next = queue(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('buildSiteRow', () => {
  it('renders the origin as text (never markup) and wires the action', () => {
    const onAction = vi.fn();
    const row = buildSiteRow('https://evil.com/"><img src=x>', 'Disable', onAction);
    // Origin is rendered via textContent — no injected element.
    expect(row.querySelector('img')).toBeNull();
    const btn = row.querySelector('button')!;
    expect(btn.textContent).toBe('Disable');
    btn.click();
    expect(onAction).toHaveBeenCalledWith('https://evil.com/"><img src=x>');
  });
  it('shows the full origin and names the button after action + origin', () => {
    const row = buildSiteRow('http://a.com', 'Disable', vi.fn());
    expect(row.querySelector('.site')!.textContent).toBe('http://a.com');
    expect(row.querySelector('button')!.getAttribute('aria-label')).toBe('Disable http://a.com');
  });
  it('puts an unparseable markup origin in the label as text, not elements', () => {
    // Does not parse as a URL, so the raw string reaches the label unchanged.
    const raw = '<img src=x onerror=alert(1)><b>bold</b>';
    const row = buildSiteRow(raw, 'Disable', vi.fn());
    const label = row.querySelector('.site')!;
    expect(label.textContent).toBe(raw);
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('b')).toBeNull();
    expect(label.children).toHaveLength(0);
    expect(row.querySelector('button')!.getAttribute('aria-label')).toBe(`Disable ${raw}`);
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
