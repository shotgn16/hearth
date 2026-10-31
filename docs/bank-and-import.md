# Connecting your bank and importing history

[← Documentation](../README.md#documentation)

## Connecting your bank (superFin)

**Settings → Bank connections**

Paste the **setup token** (a long string of letters) or **access URL** (`https://user:pass@…`) that superFin gives you, choose who the accounts belong to (joint, or one person), and press **Connect and import**.

What happens:

1. Hearth claims the setup token once and stores the resulting access URL in its local database. Setup tokens can only be claimed once, so if you need to reconnect, generate a new one.
2. It pulls every account and all the transaction history the bank allows (from the **Pull history from** date — leave it at 2000-01-01 for "everything").
3. It then syncs automatically every 4 hours, re-reading the last 14 days each time so pending card payments that later post with a different reference don't end up duplicated.

Per connection you can **Sync now**, **Re-pull history**, switch **Auto** sync off, or **Remove** it (transactions already imported stay).

Change the sync interval under **Settings → Your data**.

### Which protocol?

Hearth talks the **SimpleFIN** protocol, which superFin-style bridges use: a one-time setup token that becomes an access URL, and an `/accounts` endpoint returning accounts with balances and transactions.

If your feed uses a different API, open **"superFin uses a different API?"** on the same screen and map it without any code:

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
