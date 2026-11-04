# Third-party notices

Hearth includes or depends on the following third-party components.

## Server (every kind of install)

| Component | Use | Licence |
|---|---|---|
| [Node.js](https://github.com/nodejs/node) 22 | Runtime. The desktop installers and Hearth Server downloads include an official, checksum-verified build. | MIT and others ([licence](https://github.com/nodejs/node/blob/main/LICENSE)) |
| [Express](https://github.com/expressjs/express) 5 | Web framework | MIT |
| [ImapFlow](https://github.com/postalsys/imapflow) | Reading IMAP mailboxes for email receipts | MIT |
| [Mailparser](https://github.com/nodemailer/mailparser) | Parsing receipt emails | MIT |
| [node-ical](https://github.com/jens-maus/node-ical) | Reading iCal calendar links | Apache-2.0 |
| [unpdf](https://github.com/unjs/unpdf) | Reading PDF receipts and bills | MIT |
| [httpntlm](https://github.com/SamDecrock/node-http-ntlm) | Signing in to on-premises Exchange (EWS) | MIT |
| [node-qrcode](https://github.com/soldair/node-qrcode) | QR codes for connecting phones | MIT |

Their own dependencies are listed in `server/package-lock.json`; each package's licence is in its folder under `node_modules`.

## Desktop apps

| Component | Use | Licence |
|---|---|---|
| [Electron](https://github.com/electron/electron) | Desktop app shell (includes Chromium) | MIT ([Chromium licences](https://www.chromium.org/chromium-os/licenses/) are shipped as `LICENSES.chromium.html` in the app) |
| [electron-updater](https://github.com/electron-userland/electron-builder) | In-app updates from GitHub releases | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | Builds the installers (not shipped) | MIT |
| [WinSW](https://github.com/winsw/winsw) 2.12.0 | Runs the household server as a Windows service (Windows only, checksum-verified) | MIT |

## Phone and tablet app

| Component | Use | Licence |
|---|---|---|
| [Capacitor](https://github.com/ionic-team/capacitor) (core, Android, iOS, App) | Native app shell for iPhone, iPad and Android | MIT |
| [jsQR](https://github.com/cozmo/jsQR) 1.4.0 | Reading the connection QR code with the camera. Vendored as `mobile/www/vendor/jsQR.js`; the licence is in `jsQR-LICENSE.txt` next to it. | Apache-2.0 |

## Services Hearth can connect to

Hearth only connects to the services you set up yourself, under your own accounts and their terms:
your bank feed (Synci, superFin, SimpleFIN Bridge or another JSON feed), your mailboxes (IMAP,
Microsoft Graph or Exchange), your calendars, your own [Ollama](https://ollama.com) server,
Home Assistant, ntfy, and shop or [PriceRunner](https://www.pricerunner.com) product pages for price
watching. Hearth isn't affiliated with or endorsed by any of them.
