// lib/options-view.ts
// Pure DOM helpers for the options page (no chrome, no top-level side effects) so
// the render logic is unit-testable. Every site string is rendered via textContent,
// never innerHTML.

/** The full origin including the scheme, so http://a.com and https://a.com
 * (distinct entries in the site lists) never look alike. Anything that does not
 * parse to a tuple origin is shown as-is. */
export function displayOrigin(origin: string): string {
  try {
    const o = new URL(origin).origin;
    return o === 'null' ? origin : o;
  } catch { return origin; }
}

/** Runs tasks one at a time in call order; a failed task does not block the
 * ones after it (its rejection still reaches its own caller). */
export function createQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => { /* keep the queue going */ });
    return run;
  };
}

/** One management row: the site origin as text + an action button that calls
 * onAction(origin). The button label is passed in (localized by the caller);
 * the button's accessible name adds the origin so rows are told apart. */
export function buildSiteRow(origin: string, actionLabel: string, onAction: (origin: string) => void): HTMLElement {
  const row = document.createElement('div'); row.className = 'site-row';
  const label = document.createElement('span'); label.className = 'site';
  label.textContent = displayOrigin(origin);
  const btn = document.createElement('button'); btn.textContent = actionLabel;
  btn.setAttribute('aria-label', `${actionLabel} ${label.textContent}`);
  btn.onclick = () => onAction(origin);
  row.append(label, btn);
  return row;
}

/** A labelled checkbox row. The label is passed in (localized by the caller);
 * onChange gets the new state, and a failed save (onChange rejects) puts the
 * box back so it never shows a setting that was not stored. */
export function buildToggleRow(label: string, checked: boolean, onChange: (on: boolean) => Promise<void>): HTMLElement {
  const row = document.createElement('label'); row.className = 'site-row toggle-row';
  const text = document.createElement('span'); text.textContent = label;
  const box = document.createElement('input'); box.type = 'checkbox'; box.checked = checked;
  box.onchange = async () => {
    const on = box.checked;
    box.disabled = true;
    try { await onChange(on); } catch { box.checked = !on; } finally { box.disabled = false; }
  };
  row.append(text, box);
  return row;
}
