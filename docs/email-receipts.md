# Email receipts

[← Documentation](../README.md#documentation)

Hearth can watch your email for receipts, invoices and bills, work out which bill, payment and account each one belongs to, and file it — **but only after you approve it**.

## How it works

1. Every 30 minutes (change it with **Check every** in **Settings → Email receipts** — 15 minutes to 12 hours) Hearth checks the mailboxes and folders you've chosen — over IMAP, Microsoft Graph (Outlook.com / Microsoft 365) or Exchange Web Services (on-premises Exchange).
2. It looks at subjects and senders first and only downloads emails that look like receipts, so newsletters and personal mail are skipped.
3. From each receipt it reads the shop or company, total, date, order/invoice number, account or customer number and line items — from the email itself, from **PDF attachments**, and from receipt photos if you've set a vision model. If the rule-based reader isn't sure, your local AI helps.
4. It works out:
   - **which bill or subscription** it is (by name, the usual amount, account numbers and senders you've filed before),
   - **which bank payment** it matches (same amount within a few days),
   - **which account** paid it,
   - **which month's payment** it is for, for bills and subscriptions.
5. It goes into **Email receipts → To approve** with a short explanation of why, and a High / Medium / Low match label. Nothing has changed yet.
6. You **Approve**, **Change** it first, or say it's **Not a receipt**.

## Approving

<img src="images/email-receipts.jpg" alt="Email receipts to approve" width="100%">

Each card shows what Hearth thinks the receipt is for and what will happen when you approve it:

| When approved | What happens |
|---|---|
| **Attach to the payment** | The receipt's details (reference and items) are added to that bank transaction, and the transaction is linked to the bill if it wasn't already. |
| **Mark the bill as paid** | For bills paid in a way Hearth can't see (cash, another card) — that month is ticked off in [Regular payments](regular-payments.md). |
| **Add it as a new spend** | Creates a transaction for it, in the account you choose. |
| **Just keep the receipt** | Stores it without changing anything else. |

When several receipts are a confident match, **Approve those N** approves them in one go — still your decision, just quicker.

Every approval teaches Hearth: the next email from that sender is suggested for the same bill and account.

Changed your mind? **Approved → Undo approval** puts it back in the queue and reverses what it did (a ticked-off payment goes back to automatic, an added spend is removed).

## Changing what it's matched to

<img src="images/email-receipt-change.jpg" alt="Changing a receipt's match" width="100%">

**Change** lets you set:

- the amount and date (if the reader got them wrong),
- the bill or subscription (or "not a regular payment"),
- the bank payment, from the closest matches by amount and date — or "none of these",
- the account it was paid from,
- which payment it was for (for bills and subscriptions),
- what to do when approved.

Then **Approve**.

## Not a receipt

Removes it from the queue. You can also choose to ignore everything from that sender in future. If you dismiss something by mistake, **Not receipts → It is a receipt** brings it back.

## Connecting a mailbox

**Settings → Email receipts → Connect a mailbox**

<img src="images/email-connect.jpg" alt="Connecting a mailbox" width="100%">

Pick your provider, enter your details, press **Test**, choose the folders to check and whose mailbox it is, and **Connect**. Hearth looks back over the period you choose (3 months by default) the first time, then only at new mail.

There are three kinds of mailbox:

- **IMAP** with an app password — Gmail, iCloud, Yahoo, Fastmail, your own server.
- **Outlook.com / Microsoft 365** — sign in with Microsoft through your own Entra app (below).
- **Exchange on-premises (EWS)** — your own Exchange Server.

| Provider | Server | Password |
|---|---|---|
| Gmail | `imap.gmail.com`, 993 | Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords |
| iCloud Mail | `imap.mail.me.com`, 993 | App-specific password from account.apple.com → Sign-In and Security |
| Yahoo Mail | `imap.mail.yahoo.com`, 993 | Account Security → Generate app password |
| Fastmail | `imap.fastmail.com`, 993 | Settings → Privacy & Security → Integrations |
| Your own server | your IMAP host, 993 | your mailbox password (there's an option for self-signed certificates) |

### Outlook.com, Hotmail and Microsoft 365

Microsoft has switched off password sign-in, so Hearth signs in with Microsoft using a free **Entra app registration** that you own (the same approach as LifeHub). Nothing goes through a third-party service: Hearth talks to Microsoft Graph directly and keeps a sign-in token in its own database.

**1. Create the app (once, about 5 minutes).** Any Microsoft account can do this, including a personal Outlook.com one.

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **Applications → App registrations → New registration**.
2. Name it `Hearth`. Under *Supported account types* choose **Accounts in any organizational directory and personal Microsoft accounts**. Leave *Redirect URI* empty. **Register**.
3. **Authentication** → *Advanced settings* → set **Allow public client flows** to **Yes** → **Save**.
4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → tick **Mail.Read**, **Calendars.Read**, **User.Read** and **offline_access** → **Add permissions**. (Work accounts: if your organisation requires it, an admin presses **Grant admin consent**.)
5. From **Overview**, copy the **Application (client) ID**.

**2. Connect it in Hearth.** **Settings → Email receipts → Connect a mailbox** → *Outlook.com / Microsoft 365*:

- **Application (client) ID** — paste it.
- **Account type** — *Personal* for Outlook.com / Hotmail / Live, *Work or school* for Microsoft 365, *Any* if you're not sure, or *A specific tenant ID* if your organisation only allows apps registered in its own tenant (register the app there with *Accounts in this organizational directory only*).
- **Save and sign in with Microsoft.** Hearth shows a short code. Open **microsoft.com/devicelogin** on any device (your phone is fine), enter the code within 15 minutes and sign in. Hearth notices within a few seconds, checks for receipts straight away, and lists your folders so you can pick e.g. a *Receipts* folder.

Hearth only asks for read access. It stays signed in using a refresh token; if that expires (for example after a password change), the mailbox shows **Sign in** — press it and enter a new code. Changing the client ID or account type also asks you to sign in again. One app registration can be used for every mailbox in the household.

The same sign-in can copy your Outlook calendar too — see [Calendars](calendars-and-events.md).

### Exchange on-premises (EWS)

For your own Exchange Server 2013 or newer, choose *Exchange on-premises (EWS)*:

| Field | Example |
|---|---|
| EWS address | `https://mail.yourdomain.com/EWS/Exchange.asmx` |
| Domain (optional) | `CONTOSO` |
| Username | `alex` or `alex@yourdomain.com` |
| Password | your mailbox password |

Hearth signs in with NTLM and falls back to Basic. Tick *Allow a self-signed certificate* under **Advanced** if your server uses one. For Exchange Online (Microsoft 365) use the Microsoft sign-in above — Microsoft has retired EWS there.

**Tips**

- Checking a single **Receipts** folder or label (filled by a mail filter) is faster and more private than the whole inbox.
- A dedicated address like `receipts@yourdomain` that you forward bills to works well for families — connect it once for the whole household.
- Each household member can connect their own mailbox; everything lands in the same review queue.

## Where receipts show up

- **Money**: a transaction with an approved receipt shows it at the top of its detail, with links to any PDFs.
- **Regular payments**: bills ticked off from a receipt say so.
- **Needs attention**: "N email receipts to approve".
- **Ask Hearth**: "Which receipts are waiting?" or "Did the Octopus bill come through?".
- **Work expenses**: receipt items are included in the CSV you download for a claim.

## Privacy

Mail is read directly from your provider (IMAP, Microsoft Graph or your Exchange server) by the add-on and processed on your Home Assistant machine. Only emails that look like receipts are downloaded; their text is kept in Hearth's database and their PDF/image attachments in its data folder, encrypted (both are included in HA backups). Attachments open in a sandbox without your sign-in ever going into a link, and anything that isn't a PDF or picture downloads instead of opening. If AI help is on, receipt text goes only to your own Ollama server. Mailbox passwords and Microsoft sign-in tokens are encrypted before they're saved and are never sent back to the browser — see [Privacy, security and backups](privacy-and-security.md#encryption). Use app passwords where you can; Microsoft access can be revoked at any time from your account's *Apps and services* page (or by deleting the Entra app).

Next: [Unexpected costs and work expenses](unexpected-and-work.md)
