// lib/options-view.ts
// Pure DOM helpers for the options page (no chrome, no top-level side effects) so
// the render logic is unit-testable. Every site string is rendered via textContent,
// never innerHTML.

export function displayHost(origin: string): string {
  try { return new URL(origin).host || origin; } catch { return origin; }
}

/** One management row: the site host as text + an action button that calls
 * onAction(origin). The button label is passed in (localized by the caller). */
export function buildSiteRow(origin: string, actionLabel: string, onAction: (origin: string) => void): HTMLElement {
  const row = document.createElement('div'); row.className = 'site-row';
  const label = document.createElement('span'); label.className = 'site';
  label.textContent = displayHost(origin);
  const btn = document.createElement('button'); btn.textContent = actionLabel;
  btn.onclick = () => onAction(origin);
  row.append(label, btn);
  return row;
}
