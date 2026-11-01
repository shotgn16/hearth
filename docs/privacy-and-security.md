# Privacy, security and backups

[← Documentation](../README.md#documentation)

## Where your data lives

Everything — accounts, transactions, budgets, notes, calendar copies, email receipts, AI conversations and settings — is stored in a single SQLite database, `hearth.db`, in the add-on's data folder (`/data` inside the container; `./data` for Docker installs). Receipt PDFs and images are kept alongside it in `receipts/`.

## What leaves your network, and when

Hearth has no cloud service, no account with the developers and no telemetry. It only makes the connections you set up:

| Connection | What is sent | When |
|---|---|---|
| Your bank feed (superFin/SimpleFIN) | The access credentials it gave you | Every sync |
| Calendar links (iCal) | Nothing beyond fetching the link | Hourly |
| Your mailboxes (IMAP / Exchange) | Your app password, to read mail | Every 30 minutes (configurable) |
| Microsoft (Outlook.com / 365) | Your Entra app's client ID and sign-in token, to read mail and calendars via Microsoft Graph | Mail every 30 minutes, calendar hourly |
| Your Ollama server | Prompts containing the financial figures needed to answer | When AI features run |
| Home Assistant | Notifications, sensor values, events, service calls | As they happen |
| ntfy (if enabled) | Notification titles and text | As they happen |
| Shop / PriceRunner pages | A request for the product page you added | Every price check |

If your Ollama server, Home Assistant and ntfy are on your own network, financial information never leaves it, apart from what your bank feed itself provides.

## Encryption

| What | How it's protected |
|---|---|
| Bank feed access (SimpleFIN / Synci), mailbox passwords, Microsoft sign-in tokens, Home Assistant and ntfy tokens, calendar logins | Encrypted with AES-256-GCM before they're saved. They're never sent back to the browser — screens show `••••••`. |
| Receipt PDFs and pictures | Stored encrypted; decrypted only when you open one. They open in a sandbox, and anything that isn't a PDF or picture downloads instead of opening. |
| Your password | Stored only as a salted scrypt hash. |
| Sign-ins | Stored only as keyed hashes, so the database never holds a usable sign-in. Unused for 30 days → signed out. Changing your password signs out your other devices; **Settings → App settings & security → Sign out other devices** does it on demand. |
| Downloaded backups | Locked with a passphrase you choose (AES-256-GCM, key stretched with scrypt). Without the passphrase they can't be opened — or recovered. |
| Your phone or browser | Financial data is never cached on the device; only the app's own code is kept for offline start-up. |
| In transit | Through the Home Assistant panel or app, Hearth is reached over Home Assistant's own connection (HTTPS when HA uses it). Bank, Microsoft and mailbox connections use TLS with certificate checks; bank setup tokens must use HTTPS. |

The encryption key is `hearth.key` in Hearth's data folder, readable only by Hearth (or the `HEARTH_SECRET_KEY` environment variable for Docker installs). A copy of `hearth.db` on its own reveals none of the secrets above. Keep the key with the database — **Home Assistant backups include both, so turn on backup encryption in Home Assistant** (Settings → System → Backups). If `hearth.key` is lost, transactions and everything else stay readable, but bank feeds and mailboxes need reconnecting.

Transactions, budgets and notes themselves are not encrypted field-by-field: Hearth needs to search, sort and add them up. They're protected by staying on your own server, by Home Assistant's backup encryption, and by the sign-in rules below.

## Sign-in and access

- The panel in Home Assistant signs you in as your HA user, and Hearth trusts that only when the request really comes through the Supervisor's ingress proxy.
- 8 wrong passwords for one account (or 20 from one address) in 15 minutes pauses sign-in for 15 minutes.
- The browser is locked down: only Hearth's own code can run (a strict Content Security Policy), nothing loads from other sites, and other sites can't embed Hearth.
- Everyone in a household can see the whole household's finances. Admin users can add and remove users and change app settings.
- Don't expose Hearth's network port directly to the internet — use the HA app, a VPN (Tailscale, WireGuard) or an HTTPS reverse proxy.

## Backups

- **Add-on:** included in Home Assistant backups. Hearth flushes its database to disk just before each backup.
- **Docker:** back up the `data` folder.
- **Any install:** **Settings → Your data → Download encrypted backup** exports everything, locked with your passphrase. **Export all transactions (CSV)** gives an unencrypted spreadsheet copy — keep it private.

## Financial advice

Hearth's AI is told it isn't a regulated adviser and to suggest speaking to one (MoneyHelper is free in the UK) for investments, pensions or debt decisions. Treat its suggestions as a starting point.

Next: [Troubleshooting & FAQ](faq.md)
