# Kokos browser extension

Saves site logins into [Kokos](https://github.com/askuksov/kokos-app), the
local-first encrypted password manager, and fills login forms from it. Works in
Chrome and other Chromium browsers (Manifest V3) and in Firefox 115 or later.

The extension talks only to the Kokos desktop app on the same machine, over the
native-messaging host `dev.kuksov.kokos`. The app stays the sole authority: the
extension keeps no long-term secrets, and every read of a password for a site
needs that site's permission, granted in a confirmation dialog of the app.
Neither the extension nor the host makes any network request.

## Setup

1. Install the Kokos desktop app.
2. In Kokos, open **Settings → Browser integration** and install the
   native-messaging host for your browser.
3. Install the extension and add its id to the allowed list on the same page.

Store listings will be linked here once published.

## Develop

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev            # Chrome, with live reload
npm run dev:firefox
npm run build          # production build in .output/
npm run build:firefox
```

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes. Never
in a public issue.

## Contributing

Bug reports, feature requests and design questions are welcome as issues. Pull
requests are not accepted; [CONTRIBUTING.md](CONTRIBUTING.md) explains why.

## Licence

MIT License. See [LICENSE](LICENSE).

The licence covers the code, not the name. "Kokos" and the Kokos logo are not
licensed: a fork or a derivative may not be distributed under this name or a
confusingly similar one.
