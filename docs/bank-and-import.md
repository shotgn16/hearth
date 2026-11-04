# Connecting your bank and importing history

[← Documentation](../README.md#documentation)

## Connecting your bank

**Settings → Bank connections**

Hearth works with any **SimpleFIN** bank feed — **Synci** (UK banks, below), superFin or SimpleFIN Bridge. Paste the **setup token** (a long string of letters) or **access URL** (`https://user:pass@…`) the feed gives you, give the connection a name, choose who the accounts belong to (shared / joint, or one person), and press **Connect and import**.

What happens:

1. Hearth claims the setup token once and stores the resulting access URL in its local database, encrypted. Setup tokens can only be claimed once, so if you need to reconnect, generate a new one. Tokens must point to an `https://` address.
   If the first import fails after the token has been claimed, the connection is kept and shows the error — press **Sync now** to retry; you don't need a new token.
2. It pulls every account and the transaction history the bank allows, from the **Pull history from** date (1 Jan 2000 by default, i.e. as far back as possible). SimpleFIN only allows 90 days per request, so Hearth steps back 90 days at a time — up to about 2 years — and stops when history runs out. UK open banking usually gives 90 days to 2 years; for anything older, [import a statement](#importing-statements).
3. It then syncs automatically every 4 hours, re-reading the last 14 days each time so pending card payments that later post with a different reference don't end up duplicated. The first import doesn't run workflows or large-payment alerts for your historical payments.

### Synci (UK banks)

In Synci go to **Destinations → SimpleFIN** (or **Actual Budget**, which uses the same protocol), create a connection, choose the accounts, and copy the **setup token**. Paste it into Hearth and press **Connect and import**. Synci asks you to re-approve your bank about every 90 days; when payments stop arriving, renew it in Synci and Hearth carries on.

Per connection you can **Sync now**, **Re-pull history**, switch **Auto** sync off, or **Remove** it (transactions already imported stay).

Change the sync interval under **Settings → Your data → Timing**, or press **Sync everything now** there.

### Which protocol?

Hearth talks the **SimpleFIN** protocol (including v2), which Synci, superFin and SimpleFIN Bridge use: a one-time setup token that becomes an access URL, and an `/accounts` endpoint returning accounts with balances and transactions.

If your feed uses a different API, open **"superFin uses a different API? Map any JSON bank feed"** on the same screen and map it without any code:

| Field | Example |
|---|---|
| Accounts URL | `https://api.example.com/v1/accounts` |
| Transactions URL | `https://api.example.com/v1/accounts/{account_id}/transactions?from={from}` |
| Auth header name / value | `Authorization` / `Bearer abc123` |
| Path to accounts list | `data.accounts` (dot path into the JSON; empty if the response *is* the list) |
| Path to transactions list | `data.transactions` |
| Account id / name / balance fields | `id,name,balance` |
| Tx id / date / amount / description fields | `id,date,amount,description` |
| Spending comes through as positive numbers | tick for most credit card feeds |

## Importing statements

**Settings → Import statements** (or **Money → Import**)

Download statements from your bank's website and drop them in — several at once is fine.

- **Formats:** CSV, OFX/QFX (Microsoft Money), QIF.
- **CSV columns are detected automatically** for Monzo, Starling, Barclays, HSBC, Lloyds, Nationwide, Santander, Amex, Revolut and most others, including banks that split money in and money out into separate columns. If a guess is wrong, change it — the preview updates.
- **Dates** default to UK day-first; switch to month-first for US exports.
- **Signs:** choose "Spending is positive" for credit cards that export purchases as positive numbers.
- **Duplicates are skipped**, so overlapping exports are safe. Transactions are matched by the bank's transaction ID where the file has one, otherwise by account, date, amount and description.
- If your bank exports its own categories, Hearth uses them only for merchants it doesn't already recognise.

Pick the account to import into (or let Hearth create one from the file name) and who made the spending, then **Import**.

## After import

- Merchant names are cleaned up (`CARD PAYMENT TO TESCO STORES 3021 ON 12/10` → `Tesco Stores`).
- Each transaction is categorised: your own past corrections first, then built-in UK patterns, then — if switched on — your local AI. AI choices show up in **Needs attention** for a quick check.
- Regular payments are detected and split into **subscriptions** and **bills**.
- Your [workflows](workflows.md) run on each new transaction.

Next: [Everyday use](everyday-use.md)
