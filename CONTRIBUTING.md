# Contributing

Thanks for your interest in Hearth. Bug reports, ideas and pull requests are welcome.

## Reporting bugs

[Open an issue](https://github.com/shotgn16/hearth/issues/new) with:

- the Hearth version (shown at **Settings → App settings & security**, on the add-on page in Home
  Assistant, or at `/api/status`)
- how you run it: desktop app (which setup), Hearth Server, Docker or the Home Assistant add-on
- what you did, what you expected, and what happened
- the relevant log lines, **with email addresses, names, bank details and tokens removed**

Security problems go through [private reporting](SECURITY.md) instead.

## Development setup

```bash
git clone https://github.com/shotgn16/hearth.git
cd hearth/server
npm ci
npm run demo          # sample household on http://localhost:8485 (alex@demo.local / demo1234)
npm test
```

You need Node.js 22.13 or newer. The desktop app is in `desktop/` and the phone app in `mobile/`;
both have `npm test` too. GitHub Actions builds every installer, the APK and the iPhone/iPad app on
every push to a `release/**` branch.

- [Development](docs/development.md): how the code is laid out and how the pieces fit
- [Customising Hearth](docs/customising.md): add, remove or change a feature module, rebrand it
- [Building the apps](docs/building.md): releases, signing, building on your own computer

## Pull requests

- Keep each change focused, and describe *why* as well as *what*.
- Put a new feature in its own module (`server/src/modules/<feature>/`) and its screen in
  `server/web/js/`. No inline `<script>` or `onclick=` handlers: the content security policy blocks them.
- Make sure `npm test` passes in `server/`, `desktop/` and `mobile/`.
- Update the docs and add a line under **[Unreleased]** in `CHANGELOG.md` for any change users
  will notice.
- Never commit a `data/` folder, `hearth.key`, tokens or personal data.
