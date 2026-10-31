# Hearth

Full documentation with screenshots: https://github.com/shotgn16/hearth/tree/main/docs

Hearth takes the admin of money out of your head. Transactions arrive from your bank, get cleaned up, categorised and checked against your budgets on their own. You only hear about things that need a decision.

Everything — transactions, budgets, calendar copies, AI conversations — lives in a single database inside this add-on's storage and is included in your Home Assistant backups. The only outside connections are the ones you switch on: your bank feed, product pages for price watching (they only see the product link), and your own Ollama server.

## First run

1. **Configuration tab** — set **Ollama address** (e.g. `http://192.168.1.50:11434`) and **Chat model**. Optional: a smaller **Fast model** for background jobs and a **Vision model** for receipt scanning. Save.
2. **Start** the add-on, then open **Hearth** from the sidebar.
3. Create your household. Your account is linked to your Home Assistant login, so from now on opening the panel signs you straight in.
4. Follow the cards: **Settings → Bank connections**, **Import statements**, **People & household**, **Calendars**.

### Adding your partner or family

**Settings → People & household → Add user** creates their Hearth login. The first time they open Hearth from the HA sidebar they sign in once with that password and their HA login is linked. (Or switch on **Let any Home Assistant user in** in the add-on options to skip that step.)

Budgets and targets can belong to **everyone together**, **one user**, or **a person you spend on** (children, parents, pets). Accounts can be joint or owned by one of you.

## Bank connection (superFin)

**Settings → Bank connections.** Paste the setup token or access URL from superFin. Hearth speaks the SimpleFIN protocol, which most self-hosted bank bridges use: it claims the token once, keeps the access URL in the local database, pulls all the history the bank allows, then syncs every 4 hours (with a 14-day overlap so pending payments settle properly).

If superFin turns out to use a different API, open **"superFin uses a different API?"** on the same screen and map its accounts URL, transactions URL, auth header and field names — no code needed.

For older history, **Import statements** takes CSV, OFX/QFX and QIF from any UK bank; drop several files at once and overlaps are de-duplicated.

## Using it day to day

- **Today** — one sentence answering "am I OK?", an 8-week balance line, what's due, budgets and goals.
- **Needs attention** — the only list you need to look at: unknown shops, possible subscriptions, unclear notes, budgets near their limit, AI suggestions.
- **+ (Jot)** — type `£12 lunch with Sam`, `Ella's dentist £60 next Tue`, `want a new TV under 400`, or tap **Scan a receipt**.
- **Money** — list on phones, spreadsheet-style grid on desktop with bulk edits, saved views and CSV export. Type a question into search (e.g. *coffee over £5 in September*) and press Enter to let the AI build the filter.
- **Plan** — budgets, savings targets and the year planner (categories × months; actuals fill themselves in).
- **Regular payments** — every subscription and bill with its payment date; a monthly checklist ticked off as payments come out (or by you); ongoing, cancelling, paused and ended (with last payment); a 12-month history grid.
- **Email receipts** — connect a mailbox (Settings → Email receipts) and Hearth collects receipts and bills, matches them to the right bill, payment and account, and waits for you to approve.
- **Unexpected & work** — flag unplanned costs to see what to put aside each month; track work expenses from to claim → claimed → paid back and export them for a claim.
- **Insights** — this month, year on year, forecasts, pivot reports and AI monthly reviews.

## Home Assistant integration

All of this works with no tokens or setup because Hearth runs as an add-on:

**Notifications.** In **Settings → Workflows**, any "Send a notification" action can target your HA notify services (e.g. `notify.mobile_app_jacks_iphone`). Tapping the notification on your phone opens Hearth. **Settings → Integrations** lets you pick services that receive *every* Hearth notification (budget alerts, morning summary, new subscriptions…).

**Calendars.** **Settings → Calendars → From Home Assistant** lists your HA calendar entities — Google, Outlook, Microsoft 365/Exchange, CalDAV or local — tick the ones to copy. Hearth keeps a local copy (3 years back, 2 ahead) and lets you put budgets and real costs on events. Calendars that aren't in HA can still be added with an iCal link.

**Sensors.** Updated every 15 minutes:

| Entity | What it is |
|---|---|
| `sensor.hearth_free_to_spend` | Money free until payday after bills already committed (attributes: `payday`, `committed`) |
| `sensor.hearth_spent_this_month` | Spending so far this month |
| `sensor.hearth_balance` | Total across accounts |
| `sensor.hearth_needs_attention` | Items waiting in Needs attention |
| `sensor.hearth_next_payment` | Date of the next regular payment (attributes: `merchant`, `amount`) |

**Workflow actions for HA.**
- *Fire a Home Assistant event* — e.g. `hearth_big_spend`, with `merchant`, `amount`, `category_id` and `date` in the event data. Use it as an **Event** trigger in an automation.
- *Call a Home Assistant service* — e.g. `light.turn_on` with `{"entity_id":"light.hallway","color_name":"orange"}` to flash a light when a budget hits 90%.

Example automation using an event from Hearth:

```yaml
alias: Announce big spends
triggers:
  - trigger: event
    event_type: hearth_big_spend
actions:
  - action: tts.speak
    target: { entity_id: tts.piper }
    data:
      media_player_entity_id: media_player.kitchen
      message: "Heads up: {{ trigger.event.data.merchant }} just took £{{ (trigger.event.data.amount | abs) | round(0) }}"
```

## Local AI (Ollama)

**Settings → Local AI** shows whether Ollama is reachable, which models are installed and loaded, and lets you choose a model for each job, the context window, how long models stay loaded, creativity, and "house rules" the assistant should follow (e.g. *We're saving for a house deposit; keep answers short*).

### Ask Hearth

A chat with your own model that **looks things up** rather than guessing. It can check balances and money free until payday, spending by category or person, search transactions, compare periods, look at budgets, goals, subscriptions, the forecast, upcoming events, what similar past events cost, price watches, and whether a purchase is affordable right now. You see each lookup as a small tick above the answer.

When a next step would help, it **prepares a suggestion card** — create a budget, set up a savings goal, watch a price, put a budget on an event, add a planned cost, move a merchant to a different category, or remind you to cancel a subscription before it renews. Nothing changes until you tap **Confirm**.

Conversations are kept, so you can come back to them. Quick tools on the Ask screen: last month's review, suggested budgets, subscription check, "Should I buy…?", receipt scanning.

**Which model?** Tool calling needs a model that supports it. Good choices on home hardware: `qwen2.5:7b-instruct` (your current one), `qwen3:8b`, `llama3.1:8b`. If your model can't use tools, Hearth notices and answers from a summary of your data instead. A 3B model (e.g. `qwen2.5:3b-instruct`) is a good **Fast model** for background categorising.

### What the AI does in the background (each can be switched off)

- **Files unknown transactions** after each sync using your own past decisions as examples. They show in Needs attention as "The AI filed N transactions"; review, then **Looks right** to teach Hearth those merchants permanently — or undo them all from Settings.
- **Reads unclear quick notes.**
- **Monthly review** on the 1st, with a notification. Also on demand under **Insights → AI reviews**.
- **Monday check-in** (off by default).
- **Receipt scanning** with your vision model (`qwen2.5vl:7b`, `llama3.2-vision`, `minicpm-v`). If the bank has already sent the payment, the receipt's items are added to that transaction instead of creating a duplicate.

Elsewhere: **Estimate with AI** on any calendar event, **Ask AI what to cut** on Regular payments, **Suggest some** on Budgets, and **Describe it** in Workflows ("ping Sam's phone when we spend over £100 at Amazon" becomes a draft workflow you check and save).

## Using it outside Home Assistant

The sidebar panel works in the HA app on every phone. If you'd also like Hearth as its own installed app (its own home-screen icon outside the HA app), set a host port for `8484/tcp` on the add-on's **Network** section and put it behind HTTPS (Nginx Proxy Manager or the NGINX add-on). Sign in with your Hearth email and password there.

## Backups

Hearth's database is in the add-on's storage and included in Home Assistant backups (it's flushed to disk just before each backup). **Settings → Your data** also offers a JSON backup and a CSV export of every transaction.

## Troubleshooting

- **"Can't reach Ollama"** — use the IP address of the machine running Ollama, not `localhost` (that means the add-on itself). On that machine Ollama must listen on the network: set `OLLAMA_HOST=0.0.0.0`.
- **Answers are slow** — the first question loads the model; set *Keep model loaded for* higher. Use a smaller Fast model for background jobs.
- **The assistant invents numbers or ignores tools** — try a larger or tool-capable model, or set Creativity to Precise.
- **Calendar from HA shows nothing** — check the entity has events in HA's own calendar view, then press Sync in Hearth.
