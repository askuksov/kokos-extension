// lib/generator.ts
// In-page password generator. Pure: finds new-password fields (which
// detectLoginForms deliberately excludes) and fills a freshly generated password
// into the field + its confirm/repeat sibling. generate_password is not vault data
// (no confirm, works while locked), but the generated value is a soon-to-be-real
// credential: filled via native setter, never logged. It is returned to the content
// script only so it can be briefly revealed to the user (who asked to see it).

import type { NmhResponse, GeneratePasswordResult } from './nmh-client';
import { classifyField } from './detection';
import { setNativeValue } from './fill';

export interface PasswordFields {
  primary: HTMLInputElement;
  confirm: HTMLInputElement | null;
}

/** Group new-password fields per form: the first is `primary`, a second in the same
 * form is its confirm/repeat sibling. Login-only pages (no new-password) yield
 * nothing. Matches classifyField's 'new-password' (autocomplete=new-password, or a
 * password field whose name/hint reads new|confirm|retype|repeat|reg|signup|create). */
export function detectPasswordFields(root: ParentNode): PasswordFields[] {
  const byForm = new Map<HTMLFormElement | null, HTMLInputElement[]>();
  for (const el of Array.from(root.querySelectorAll('input'))) {
    const input = el as HTMLInputElement;
    if (classifyField(input) !== 'new-password') continue;
    const key = input.form ?? null;
    const list = byForm.get(key) ?? [];
    list.push(input);
    byForm.set(key, list);
  }
  const out: PasswordFields[] = [];
  for (const list of byForm.values()) {
    if (list.length === 0) continue;
    out.push({ primary: list[0]!, confirm: list[1] ?? null });
  }
  return out;
}

export interface GenerateDeps {
  request: (action: string, payload: object) => Promise<NmhResponse>;
  fields: PasswordFields;
  gen: number;                 // generation token snapshotted at trigger time
  currentGen: () => number;    // live generation counter
  isConnected: (el: Element | null) => boolean;
}

export type GenerateOutcome = { status: 'filled'; value: string } | { status: 'discarded' } | { status: 'error' };

/** Fetch a generated password and fill primary + confirm. generate_password is not
 * url-scoped and needs no confirm, so the payload is empty. Mirrors fillTotp/
 * fillFromMatch's generation guard: a double-click on the generator icon fires two
 * concurrent requests, and without this check both would independently write the
 * field and toast, leaving a field/toast mismatch (the displayed password would not
 * match what's actually filled) — the guard, checked after the await and before any
 * write, ensures only the latest request may fill. Returns the value so the content
 * script can briefly reveal it — the caller must not log it. */
export async function fillGenerated(deps: GenerateDeps): Promise<GenerateOutcome> {
  const resp = await deps.request('generate_password', {});
  if (!resp.ok || !resp.payload) return { status: 'error' };
  const value = (resp.payload as GeneratePasswordResult).password;
  if (!value) return { status: 'error' };
  if (deps.gen !== deps.currentGen()) return { status: 'discarded' };
  if (!deps.isConnected(deps.fields.primary)) return { status: 'discarded' };
  setNativeValue(deps.fields.primary, value);
  if (deps.fields.confirm && deps.isConnected(deps.fields.confirm)) setNativeValue(deps.fields.confirm, value);
  return { status: 'filled', value };
}
