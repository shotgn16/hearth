<p align="center"><img src="hearth/logo.png" alt="Hearth" width="300"></p>

<p align="center"><b>Household money, handled.</b><br>
A self-hosted finance manager for individuals and families that runs as a Home Assistant add-on, with a local AI that knows your numbers.</p>

<p align="center">
<a href="https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fshotgn16%2Fhearth"><img src="https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg" alt="Add this repository to your Home Assistant"></a>
</p>

<p align="center"><img src="docs/images/today-desktop.jpg" alt="Hearth's Today screen" width="860"></p>

Hearth takes the admin of money out of your head. Transactions arrive from your bank, get cleaned up, categorised and checked against your budgets on their own. You only hear about the few things that genuinely need a decision.

Everything stays on your Home Assistant machine — transactions, budgets, calendar copies and AI conversations live in one local database that's included in your HA backups. Bank, mailbox and calendar logins and receipt files are encrypted on disk.

## What it does

| | |
|---|---|
| **Today** — one sentence answers "am I OK?" ("£2,913 free until payday on Fri 27 Nov"), with an 8-week balance forecast, what's due, budgets and goals. | **Needs attention** — the only list you have to look at. Every answer teaches Hearth, so it shrinks over time. |
| **Jot it down** — type `Ella's dentist £60 next Tue` or snap a receipt. Hearth works out the amount, date, category and person and files it. | **Ask Hearth** — chat with your own Ollama model. It looks up real figures and prepares budgets, goals and price watches you confirm with a tap. |
| **Spreadsheet power** — editable transaction grid, bulk edits, saved views, a year planner where actuals fill themselves in, pivot reports, CSV export. | **Forecasts** — next 8 weeks, 2 years and 5 years, built from your regular payments, seasonality, plans and event budgets. |
| **The whole household** — separate logins; budgets and targets that are shared, one person's own, or for the kids. | **Regular payments tracker** — subscriptions and bills found automatically; set payment dates, see what's come out this month, ongoing / cancelling / ended with last payments, a 12-month history grid. |
| **Calendars** — your HA calendars, Outlook / Microsoft 365 via sign-in, or iCal links with budgets and real costs on events. | **Home Assistant** — notifications to your phones, sensors for dashboards, events and service calls from workflows. |
| **Unexpected costs & work expenses** — flag unplanned costs and see what to put aside; track work expenses from to claim → claimed → paid back. | **Price watch** — PriceRunner or any shop; tells you when it's a good time to buy. |
| **Email receipts** — Hearth watches your mailbox (Gmail, iCloud, Outlook / Microsoft 365, Exchange or any IMAP), reads receipts and PDF bills, matches each to the right bill, payment and account, and waits for your approval. | **Bank sync** — any SimpleFIN feed (Synci for UK banks, superFin, SimpleFIN Bridge) or any JSON feed, plus CSV/OFX/QIF import for years of history. |
| **Workflows** — automatic rules for categories, tags, flags, notifications and Home Assistant. | **Secure by default** — secrets and receipt files encrypted at rest, passphrase-locked backups, hashed sign-ins, a strict browser lock-down. |

<p align="center">
<img src="docs/images/today-phone.jpg" alt="Today on a phone" width="250">
<img src="docs/images/ask-phone.jpg" alt="Ask Hearth on a phone" width="250">
<img src="docs/images/subs-phone.jpg" alt="Regular payments on a phone" width="250">
</p>

## Install

1. Click **Add repository** above, or in Home Assistant go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add `https://github.com/shotgn16/hearth`.
2. Find **Hearth** in the store and press **Install**. Home Assistant downloads a ready-made image — nothing is built on your machine.
3. **Start** it (turn on **Show in sidebar**), then open **Hearth** from the sidebar and create your household. There's nothing to fill in on the add-on's Configuration tab.
4. Inside Hearth, set your **Ollama address** and models under **Settings → Local AI**, and your time zone under **Settings → App settings & security**.

Then follow [Getting started](docs/getting-started.md).

Works on `amd64` and `aarch64` (Raspberry Pi 4/5, most mini PCs, HA Green/Yellow). Not using Home Assistant? See [Run it with Docker](docs/standalone-docker.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Connecting your bank and importing history](docs/bank-and-import.md)
- [Everyday use: Today, Needs attention, Jot, Money, Plan, Insights](docs/everyday-use.md)
- [Regular payments: the subscription and bill tracker](docs/regular-payments.md)
- [Email receipts](docs/email-receipts.md)
- [Unexpected costs and work expenses](docs/unexpected-and-work.md)
- [Households: people, shared and individual budgets](docs/household.md)
- [Local AI (Ollama)](docs/local-ai.md)
- [Home Assistant integration](docs/home-assistant.md)
- [Workflows and notifications](docs/workflows.md)
- [Calendars and event costs](docs/calendars-and-events.md)
- [Price watch](docs/price-watch.md)
- [Run it with Docker (without Home Assistant)](docs/standalone-docker.md)
- [Privacy, security and backups](docs/privacy-and-security.md)
- [Troubleshooting & FAQ](docs/faq.md)
- [Development](docs/development.md)

## Privacy in one paragraph

Hearth has no cloud, no account with us and no telemetry. It only connects to the things you set up: your bank feed, your calendars, your mailboxes (for receipts), your Ollama server, Home Assistant, ntfy if you switch it on, and shop pages for price watching (which receive only the product link). Read more in [Privacy, security and backups](docs/privacy-and-security.md).

## Licence

MIT — see [LICENSE](LICENSE).
