import { defineConfig } from 'wxt';

// The manifest object uses raw MV3 keys; WXT adapts background (service_worker
// for Chrome, scripts for Firefox) and injects the Firefox gecko settings for
// the `-b firefox` target. Host access is per-site opt-in:
// NO static content_scripts match, only optional_host_permissions.
export default defineConfig({
  // WXT defaults Firefox builds to MV2. This project targets Firefox MV3
  // (background.scripts, no service_worker) — hence the explicit override —
  // consistent with the gecko strict_min_version below (140.0 has MV3 support).
  manifestVersion: 3,
  manifest: {
    name: 'Kokos',
    description: 'Save and autofill logins from the Kokos password manager.',
    permissions: ['nativeMessaging', 'storage', 'scripting', 'activeTab', 'tabs'],
    optional_host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Kokos',
      default_popup: 'popup.html',
      default_icon: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' },
    },
    commands: {
      'fill-best-match': {
        suggested_key: { default: 'Ctrl+Shift+L', mac: 'Command+Shift+L' },
        description: 'Fill the best-matching Kokos login on this page',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'kokos@kuksov.dev',
        // 140.0 is the first release that shows the built-in consent prompt
        // for data_collection_permissions; older ones would skip it.
        strict_min_version: '140.0',
        // AMO counts data sent to the native app as transmission: page URLs
        // (badge and login lookup) and the credentials the user saves.
        data_collection_permissions: { required: ['authenticationInfo', 'browsingActivity'] },
      },
    },
  },
});
