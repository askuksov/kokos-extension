// tests/manifest.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

describe('dual-browser manifests', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'inherit' });
    execSync('npm run build:firefox', { cwd: process.cwd(), stdio: 'inherit' });
  }, 120_000);

  it('Chrome MV3 manifest declares nativeMessaging and no static host match', () => {
    const m = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toContain('nativeMessaging');
    expect(m.permissions).toContain('tabs'); // badge reads any tab's url passively
    expect(m.optional_host_permissions).toContain('<all_urls>');
    // Per-site opt-in: nothing runs on a site until the user opts in.
    expect(m.content_scripts ?? []).toHaveLength(0);
    expect(m.background.service_worker).toBeTruthy();
    expect(m.commands['fill-best-match'].description).toBe('Fill the best-matching Kokos login on this page');
    expect(m.options_ui.page).toContain('options.html');
    expect(m.icons['16']).toBeTruthy();
    expect(m.icons['128']).toBeTruthy();
    expect(m.action.default_icon).toBeTruthy();
  });

  it('Firefox MV3 manifest fixes the gecko id and uses background scripts', () => {
    const m = JSON.parse(readFileSync('.output/firefox-mv3/manifest.json', 'utf8'));
    expect(m.browser_specific_settings.gecko.id).toBe('kokos@kuksov.dev');
    expect(m.browser_specific_settings.gecko.strict_min_version).toBe('140.0');
    expect(m.browser_specific_settings.gecko.data_collection_permissions).toEqual({
      required: ['authenticationInfo', 'browsingActivity'],
    });
    // Firefox MV3 has no service_worker; WXT emits background.scripts.
    expect(m.background.scripts).toBeTruthy();
    expect(m.background.service_worker).toBeUndefined();
    expect(m.commands['fill-best-match']).toBeTruthy();
    expect(m.options_ui.page).toContain('options.html');
  });
});
