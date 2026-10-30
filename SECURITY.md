# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub: open this repository's **Security** tab and
choose **Report a vulnerability**. Only the maintainers see the report. Include
a description of the issue, the steps to reproduce it, and the browser, its
version and the extension version you saw it on.

Never include a real password, vault file or key file in a report. A synthetic
reproduction is always sufficient.

## Scope

In scope: the extension itself, its messages to the native-messaging host, and
how it reads and fills pages — for example a page that can make the extension
fill a password for a different site, or read one without the site permission
granted in the app.

The response targets, the full scope and the threat model are shared with the
desktop app; see the
[Kokos security policy](https://github.com/askuksov/kokos-app/blob/main/SECURITY.md).
A problem in the desktop app or the native-messaging host belongs in a report
on [kokos-app](https://github.com/askuksov/kokos-app/security/advisories/new).
