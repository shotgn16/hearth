# Changelog

All notable changes to Hearth are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

Home Assistant shows the add-on's own changelog ([`hearth/CHANGELOG.md`](hearth/CHANGELOG.md))
on the add-on page. That file is a shorter version of this one.

## [Unreleased]

## [1.6.0] – 2026-11-04

Hearth 1.6 is a clean-up for publishing: it installs on Mac, Windows and Linux with a setup
wizard, has phone and tablet apps, and is built from feature modules you can add, remove or change.

### Added
- **Desktop apps with installers**, with everything included (their own Node.js runtime and the
  Hearth server; nothing else to install):
  - Windows 10/11: `Hearth-<v>-Windows-x64-Setup.exe` (just for you without admin, or for everyone)
  - macOS: `.dmg` for Apple Silicon and Intel (unsigned, ad-hoc signed)
  - Linux: `.deb`, `.rpm` and `.AppImage`, for x64 and arm64
- **Setup wizard** on first launch (and **Change setup…** in the menu bar / system tray later). Choose:
  - **Just me, on this computer**: Hearth runs inside the app on `127.0.0.1`
  - **This computer and my phone**: phones on your Wi-Fi can connect; keeps running in the tray and starts at login
  - **Our household server**: a system service (systemd, launchd or a Windows service) that starts with the computer
  - **Connect to an existing Hearth** on another computer, NAS, Docker or Home Assistant
  - **Install in Docker**: writes a compose file and starts the container
  - **Install in Home Assistant**: adds the repository, installs and starts the add-on and puts it in the sidebar

  It also finds Ollama on the computer, and can bring your data along when you move to a household server.
- **Phone and tablet app** for iPhone, iPad and Android (`Hearth-<v>-Android.apk`,
  `Hearth-<v>-iPhone-iPad-unsigned.ipa`): connect by scanning a QR code, a `hearth://connect` link
  or an address; remembers several Hearths; **Switch server** from inside Hearth.
- **Settings → Phones & devices**: this Hearth's addresses and QR codes for connecting phones.
- **Hearth Server** download for computers without a screen (`Hearth-Server-<v>-Linux-x64.tar.gz`
  and others), with its own Node.js runtime, and the `hearth-server` command: `start`,
  `service install/uninstall/status`, `docker`, `homeassistant install`, `reset-password`, `doctor`.
- **Modules**: the server is built from feature modules (`server/src/modules/<feature>/`), each with
  its routes and, optionally, its own tables and background job. Add or remove one in a single list;
  see [Customising Hearth](docs/customising.md).
- One multi-arch Docker image `ghcr.io/shotgn16/hearth:<version>` / `:latest`, also used by the Home
  Assistant add-on.
- Releases attach every installer, the Android APK, the unsigned iPhone/iPad IPA and the Hearth
  Server downloads, with SHA-256 checksums.
- **Install guides** (`docs/install/`) for macOS, Windows, Linux, phones and tablets, servers and
  Home Assistant, plus [building](docs/building.md) and [customising](docs/customising.md) guides.
- API, CLI and module tests (`npm test` in `server/`, `desktop/` and `mobile/`).
- `CONTRIBUTING.md`, `SECURITY.md` and `THIRD-PARTY-NOTICES.md`.

### Changed
- Code moved: the server is in `server/` (`src/core`, `src/modules`, `src/jobs`, `src/cli`) and the
  web app in `server/web/`. `hearth/` now only holds the Home Assistant add-on files.
- Creating your household is one press: the button waits while it works, so it can't be sent twice
  (which used to log *Already set up*).
- Documentation brought up to date with 1.5.0 (settings locations, bank feeds, encryption, backups,
  troubleshooting).

## [1.5.0] – 2026-11-01

### Added
- Encryption at rest (AES-256-GCM) for bank feed access, mailbox passwords, Microsoft sign-in
  tokens, Home Assistant / ntfy tokens, calendar logins and receipt files; existing data is
  encrypted on first start. Key kept in `hearth.key` (or `HEARTH_SECRET_KEY`).
- Backups downloaded encrypted with a passphrase you choose.
- **Settings → App settings & security**: what's protected and where you're signed in, and
  **Sign out other devices**.

### Changed
- Sign-ins stored only as hashes; 30-day sliding sign-in; changing a password signs out other devices.
- Receipt files open in a sandbox without putting your sign-in in a link; only PDFs and pictures open in the browser.
- Strict Content Security Policy and other security headers; API responses are never cached; phones
  no longer keep an offline copy of your financial data.
- Password guessing is slowed down; bank setup tokens must use HTTPS.

## [1.4.0]

### Changed
- All settings live inside Hearth (**Settings → App settings**, **Settings → Local AI**); the add-on's
  Configuration tab only has the optional network port. Existing choices are carried over.
- The bank connections screen explains connecting Synci step by step.

### Fixed
- A failure in a background job is logged instead of stopping the app, so Hearth no longer
  crash-loops after importing unusual bank data.
- The bank connections screen no longer shows calendar switches by mistake.
- Bank feeds: pending payments without a date, odd amounts and very old dates are handled; the first
  import no longer runs workflows or large-payment alerts for every historical payment.

## [1.3.1]

### Changed
- Bank feeds (SimpleFIN, including Synci): history fetched in 90-day steps, up to about 2 years.
- Clearer messages for a used or expired setup token; the connection is kept if the first import
  fails so **Sync now** can retry.
- SimpleFIN protocol v2 (bank names and error messages).

## [1.3.0]

### Added
- Outlook.com, Hotmail and Microsoft 365 mailboxes through your own Entra app (device-code sign-in), read through Microsoft Graph.
- On-premises Exchange mailboxes through Exchange Web Services (NTLM or Basic).
- Outlook / Microsoft 365 calendars through the same Microsoft sign-in.

## [1.2.0]

### Added
- Email receipts over IMAP, matched to bills, payments, accounts and months, with an approval queue.
- Regular payments tracker: payment dates, this month's checklist, late-payment alerts, statuses, a 12-month history grid.
- Unexpected costs and work expenses (to claim → claimed → paid back, CSV export).

### Changed
- Home Assistant downloads a ready-made image instead of building Hearth.

## [1.1.0]

### Added
- Home Assistant add-on with a sidebar panel and automatic sign-in; HA notify services, calendars,
  `sensor.hearth_*` entities, and workflow actions for HA events and services.
- Local AI assistant that looks up your data, streams answers and proposes actions you confirm;
  receipt scanning, smart search, AI monthly reviews and more.

### Removed
- Browser device recognition and browser push notifications.

## [1.0.0]

- First release.
