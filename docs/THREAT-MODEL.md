# Kokos Password Manager — Extension Threat Model

Companion document to the desktop app's
[`docs/THREAT-MODEL.md`](https://github.com/askuksov/kokos-app/blob/main/docs/THREAT-MODEL.md).
The heavy security surface — crypto, vault, per-site grants, native origin
authentication — lives **app-side** and is covered there (see its "NMH (browser
native messaging)" boundary). This document covers only what the browser
extension itself adds: the manifest permissions it requests, the autofill /
save surface it exposes in the page, and the trust basis for the URLs and
metadata it acts on.

## Scope & assumptions

The extension is a **thin client** for Kokos Password Manager (Chrome MV3
+ Firefox MV3). It saves site logins into Kokos and autofills login forms over
the Native Messaging host `dev.kuksov.kokos`. **The desktop app is the sole
authority; the extension holds no long-term secrets** (README) — every secret
is fetched on demand across the NMH bridge and never persisted by the
extension.

Adversaries considered in scope for the extension layer:

- **A malicious or compromised web page** the extension runs on — attempting
  to phish an autofill, spoof its origin, or read a filled secret.
- **A malicious page trying to widen the extension's reach** — provoke a
  content-script injection, or trick the extension into treating an untrusted
  string as the tab's URL.
- **The install-time permission cost** the extension imposes on the user (the
  warnings Chrome shows, and what each granted permission actually buys an
  attacker who later compromises the extension).

Out of scope (delegated to the app-side threat model): the NMH origin
authentication and per-site confirmation gating, all vault crypto, and any
same-OS-user attacker (the app cannot defend its decrypted in-memory vault
against a same-user process — that is the OS's job). The extension never sees
the master password or the derived key.

## Permission surface

Manifest (`wxt.config.ts`) — `permissions` + `optional_host_permissions`:

| Permission | Why it's requested | What it buys / attack surface | Boundary |
|---|---|---|---|
| `nativeMessaging` | The only channel to the app (fetch logins, save, TOTP, status). | Speaks the stdio protocol to the `kokos-nmh` host; through it, everything the app exposes. | App-side: origin proven from the browser's launch args (not the extension's messages), canonicalized whitelist compare, and a native confirmation dialog for anything not already granted — `save_login`/`update_login` **always** confirm. See the app's NMH boundary. |
| `storage` | Extension-local settings: enabled fill-sites and save-off sites. | Local `chrome.storage` only; keyed by canonical origin. **No secret is ever stored here** — only which sites the user opted in/out of. | A read of extension storage discloses the user's per-site preferences, not any credential. |
| `scripting` | Register the autofill content script **dynamically, per granted site** (`lib/site-access.ts`). | Can inject the fill script into pages the user has granted host access to. | **No static `content_scripts` match** in the manifest (`wxt.config.ts`): injection is gated on an explicit per-site host grant; a page with no grant never receives the content script. |
| `activeTab` | Act on the active tab in response to a user gesture (toolbar / shortcut). | Transient, gesture-scoped access to the active tab only. | Limited to the user-invoked tab; expires — not a standing grant to all tabs. |
| **`tabs`** | **Badge state #3** — read the active tab's URL passively on tab-switch to show "app unlocked, this page not enabled here". | **Passive read of the URL (and title) of ANY tab**, without a host grant on that site. Triggers the install-time "read your browsing history" warning. | **Read-only.** Reads URL metadata to pick a badge color/tooltip; **never injects content** into non-granted pages and **never reads a secret** (secrets cross only the confirm-gated NMH channel). URL is browser-derived. See the audit-history entry below. |
| `optional_host_permissions: ['<all_urls>']` | Per-site opt-in host access for autofill. | Would be broad if granted wholesale — but it is **optional**, never granted at install. | Requested one pattern at a time via `chrome.permissions.request({ origins:[pattern] })` (`lib/site-access.ts`), only when the user enables a specific site. Per-site minimalism is the design DNA. |

## Trust boundaries

### URL provenance — always browser-derived

Every URL the extension acts on comes from the browser
(`chrome.tabs.get(tabId).url` / `chrome.tabs.query(...)`), **never from
page-supplied content**. The picker, keyboard-shortcut, and badge paths all
document this (`lib/picker-bridge.ts`, `lib/shortcut-fill.ts`,
`entrypoints/background.ts`). A page cannot make the extension treat an
attacker-chosen origin as its own address — origin decisions are anchored to
the browser's view of the tab, matching the app-side NMH trust basis.

### Autofill / content-script surface

Autofill runs only on origins the user has explicitly granted (`scripting` +
`optional_host_permissions`, registered dynamically in `lib/site-access.ts`).
There is no static content-script match, so an arbitrary page cannot pull the
fill logic into itself. The site-access map is keyed by the **portless
canonical origin**, the same key the host grant uses: a Chrome host permission
is host-wide and ignores the port, so a grant for a host covers every port on
it. Storage and the grant therefore cannot drift apart (a ported origin cannot
self-disable), but the extension does not tell ports of one host apart. The
app-side origin check is a separate boundary and is not affected by this.

### Secret handling

The extension holds no long-term secrets. A credential is fetched from the app
across NMH only in direct response to a user fill action and lives only as long
as the fill takes. Save/update **always** trigger a native confirmation dialog
app-side regardless of any prior grant. The badge path calls `get_logins`,
whose response lists the matching login items (id, title, username, TOTP flag),
but the badge uses only **non-secret metadata** from it — the item count — plus
the `running` / `locked` flags. It never receives a password or TOTP seed.

## Audit history

Change ledger for the extension's security-relevant surface — what was added,
why, and the boundaries that keep it contained. Modeled on the app's
`THREAT-MODEL.md` "Audit history" section.

**2026-08-16 — `tabs` permission added (badge connection status).**

- **What.** Added `'tabs'` to the manifest `permissions` array
  (`wxt.config.ts`). This is a real attack-surface change: it grants passive
  read access to the URL (and title) of **any** tab, not just tabs the user
  has granted host access to.
- **Why.** The toolbar badge shows four connection states; **state #3** ("app
  running, vault unlocked, but this page is **not** enabled in Kokos") requires
  reading the active tab's URL on tab-switch to decide the badge. Chrome
  exposes a tab's URL only to an extension that holds **`"tabs"` OR host access
  for that site**. Enabled sites already have a host grant, but non-enabled
  pages (exactly the pages state #3 is about) have none — so a passive URL read
  on tab-switch is impossible without `"tabs"`. The 4-state passive badge was a
  deliberate design decision; the accepted cost is the install-time **"read
  your browsing history"** warning and a partial reversal of the extension's
  per-site-minimalism DNA.
- **Boundaries (what it does NOT buy).**
  - **Read-only.** The permission is used only to read `tab.url` for a
    badge color/tooltip decision. It does **not** enable content injection —
    the content script is still gated behind a per-site host grant
    (`scripting` + `optional_host_permissions`, no static `content_scripts`),
    so no code runs in a page the user has not enabled.
  - **No secret exposure.** The badge probe uses only non-secret metadata
    (the `get_logins` item count, `running`/`locked`) over the confirm-gated
    NMH channel; the `get_logins` response also carries login titles and
    usernames, but never a password or TOTP seed;
    `"tabs"` itself grants no access to page content or to any credential.
  - **Browser-derived only.** The URL is taken from `chrome.tabs.get(...).url`,
    never from a page message, so a hostile page cannot influence which origin
    the extension reads or acts on.
  - **App-side authorization is unchanged.** `"tabs"` widens only what the
    extension can *observe* in the browser; it grants no new capability across
    the NMH bridge. Every login fetch, save, and per-site grant remains gated
    by the app's origin authentication and confirmation dialogs (see the app's
    NMH boundary).
