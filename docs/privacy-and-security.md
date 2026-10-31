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
| Your mailboxes (IMAP) | Your app password, to read mail | Every 30 minutes (configurable) |
| Your Ollama server | Prompts containing the financial figures needed to answer | When AI features run |
| Home Assistant | Notifications, sensor values, events, service calls | As they happen |
| ntfy (if enabled) | Notification titles and text | As they happen |
| Shop / PriceRunner pages | A request for the product page you added | Every price check |

If your Ollama server, Home Assistant and ntfy are on your own network, financial information never leaves it, apart from what your bank feed itself provides.

## Sign-in and access

- Passwords are stored as scrypt hashes. Sessions are random 256-bit tokens that expire after 90 days.
- In the HA panel, Hearth trusts Home Assistant's user identity only when the request comes from the Supervisor's ingress proxy.
- Everyone in a household can see the whole household's finances. Admin users can add and remove users.

## Stored secrets

Bank access URLs, mailbox app passwords, HA tokens (standalone installs only), ntfy tokens and calendar logins are stored in the database unencrypted, so:

- keep backups somewhere private,
- don't expose Hearth's port directly to the internet — use the HA panel, a VPN (e.g. Tailscale or WireGuard), or a properly secured reverse proxy.

## Backups

- **Add-on:** included in Home Assistant backups. Hearth flushes its database to disk just before each backup.
- **Docker:** back up the `data` folder.
- **Any install:** **Settings → Your data → Download JSON backup** exports everything, and **Export all transactions (CSV)** gives a spreadsheet copy.

## Financial advice

Hearth's AI is told it isn't a regulated adviser and to suggest speaking to one (MoneyHelper is free in the UK) for investments, pensions or debt decisions. Treat its suggestions as a starting point.

Next: [Troubleshooting & FAQ](faq.md)
