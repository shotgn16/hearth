# Customising Hearth

[← Documentation](../README.md#documentation)

Hearth is plain JavaScript with no build step: change a file, restart, and see the result. This guide shows where things live and how to add, remove or rebrand features.

## The pieces

```
server/            the Hearth server and web app — everything else uses this
  src/
    index.js       starts the server
    app.js         builds it: security headers → each module's routes → the web app
    core/          shared plumbing: database, sign-in, encryption, settings, HTTP helpers
    modules/       one folder per feature (banks, budgets, email receipts, AI, …)
    jobs/          the background jobs (bank sync, alerts, sensors) that run every 15 minutes
    cli/           the hearth-server command (services, Docker, Home Assistant, passwords)
  web/             the web app people use: index.html, styles.css and one js/ file per screen
desktop/           the desktop app and installers (Electron): setup wizard, tray, bundled server
mobile/            the phone and tablet app (Capacitor): connect screen, Android and iOS projects
hearth/            the Home Assistant add-on description (config.yaml, DOCS.md, CHANGELOG.md)
tools/             make-icons.js (rebranding), set-version.js (versions everywhere)
```

The desktop app, Docker image, Home Assistant add-on and Hearth Server download all run the same `server/` folder. Change it once and every install gets the change.

## Run it while you work

```bash
cd server
npm ci
npm run demo     # a sample household on http://localhost:8485 — alex@demo.local / demo1234
npm test         # API, CLI and module tests
```

Edits to `server/web/` show up when you reload the page; edits to `server/src/` need a restart.

## Feature modules

Each feature is a folder in `server/src/modules/` with an `index.js`:

```js
// server/src/modules/pets/index.js
const { q } = require('../../core/db');
const { wrap, err, crud } = require('../../core/http');

module.exports = {
  name: 'pets',
  title: 'Pet costs',
  // Tables this module needs (created at start-up if missing)
  schema: `CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY, household_id INTEGER, name TEXT, vet TEXT)`,
  // API routes for signed-in people — req.user and req.hid (their household) are set for you
  routes(api) {
    crud(api, 'pets', ['name', 'vet']);   // GET/POST /api/pets, PATCH/DELETE /api/pets/:id
    api.get('/pets/:id/spending', wrap(async (req, res) => {
      const pet = q.get('SELECT * FROM pets WHERE id=? AND household_id=?', req.params.id, req.hid);
      if (!pet) throw err('Not found', 404);
      res.json(q.get(`SELECT ROUND(SUM(-amount),2) total FROM transactions WHERE household_id=? AND merchant LIKE ?`, req.hid, `%${pet.vet}%`));
    }));
  },
  // Optional: runs with the background jobs every 15 minutes, once per household
  async job(householdId) {},
  // Optional: routes that work before signing in (rarely needed)
  // publicRoutes(api) {},
};
```

Then add it to the list in `server/src/modules/index.js`:

```js
  require('./pets'),
```

**Removing a feature:** delete its line from `server/src/modules/index.js` and its screen from the web app (below). Some modules are used by others: if Hearth stops starting, the error names the file that still needs it.

**Rules every module should follow:**
- Always filter by `household_id = req.hid`, so households never see each other's data.
- Use `wrap()` around async routes so errors become friendly `{ error }` replies, and `err('message', status)` to send one.
- Store passwords or tokens with `encrypt()` / `decrypt()` from `core/secrets.js` (or `crud(…, { secret: ['field'] })`), never as plain text.
- Add a test to `server/test/`. `test/helpers.js` starts a real server with an empty data folder.

## Screens in the web app

Each screen is an ES module in `server/web/js/` that exports a `render…(el)` function. To add one:

1. Create `server/web/js/pets.js`:

   ```js
   import { api, esc } from './core.js';
   export async function renderPets(el) {
     const pets = await api('/pets');
     el.innerHTML = `<div class="surface"><ul class="list">${pets.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul></div>`;
   }
   ```
2. In `server/web/js/app.js`, import it, add it to `ROUTES` (`pets: ['Pets', renderPets, 'more']`), and to the `extra` list in `shell()` so it appears in the sidebar and under **More**.

Hearth's pages use a strict Content Security Policy: no inline `<script>`, no `onclick="…"`, and nothing loaded from other websites. Use `data-*` attributes with `addEventListener` (the `on(el, 'click', '[data-x]', …)` helper in `core.js` does this). If a feature really must load something from another site, allow it in `server/src/core/security.js`.

Colours, spacing and dark mode are CSS variables at the top of `server/web/styles.css`.

## Rebranding

| Change | Where |
|---|---|
| Icon (every app, tray, phone) | Replace `server/web/icon.svg`, then `npx -y playwright@1 install chromium && node tools/make-icons.js`, then `cd mobile && npm run icons` |
| Name | `productName` in `desktop/package.json`, `appName` in `mobile/capacitor.config.json`, `name` in `hearth/config.yaml`, `<title>` in `server/web/index.html` |
| App IDs | `appId` in `desktop/electron-builder.yml` and `mobile/capacitor.config.json`; on Android also `namespace`/`applicationId` in `mobile/android/app/build.gradle` and the Java package folder; on iOS `PRODUCT_BUNDLE_IDENTIFIER` in Xcode |
| Your GitHub account | Search the repository for `shotgn16` — it appears in update checks, download links, the Docker image name and the Home Assistant repository |
| Colours | `server/web/styles.css`, `desktop/src/wizard/wizard.css`, `mobile/www/app.css` |

## The desktop app

`desktop/src/`:

| File | What it does |
|---|---|
| `main.js` | Windows, tray menu, updates, links like `hearth://connect` |
| `setup.js` | The six setups and switching between them, with no Electron code, so it's easy to test |
| `local-server.js` | Runs the bundled server for "this computer" setups and restarts it if it stops |
| `cli-runner.js` | Runs `hearth-server` commands, with an administrator prompt when needed |
| `wizard/` | The setup wizard's page (HTML, CSS, JS) |

Run it from source with `cd desktop && npm ci && node scripts/prepare-resources.mjs --local-node && npm start`. Test it with `npm test`.

## The phone app

`mobile/www/` is the app's own connect screen. `servers.js` holds the logic and is tested with `npm test`. After connecting, the app shows your Hearth server's web app, so most changes belong in `server/web/` and reach phones without a new app. Details in [Building the apps yourself](building.md).

## Versions

```bash
node tools/set-version.js 1.7.0     # server, desktop, phone apps and the Home Assistant add-on together
node tools/set-version.js --check
```
