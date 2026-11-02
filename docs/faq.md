# Troubleshooting & FAQ

[← Documentation](../README.md#documentation)

## Installing

**The add-on doesn't appear in the store after adding the repository.**
Refresh the store page (⋮ → Check for updates). Hearth needs a 64-bit system (`amd64` or `aarch64`).

**Install fails with an image download error.**
The ready-made image for that version may still be building (it takes a few minutes after an update is published) — try again shortly. If it keeps failing, check the [Actions tab](https://github.com/shotgn16/hearth/actions) on GitHub.

**Where are the logs?**
The add-on's **Log** tab. For more detail, set **Settings → App settings & security → Log detail** to **Everything (for troubleshooting)** (admins only). Docker installs: `docker compose logs hearth`.

**The log shows `Hearth add-on running on port 8484` many times.**
Each of those lines is one start of the add-on, so it has been restarted — by you, by a Home Assistant update or reboot, or by the Supervisor watchdog. Hearth logs errors in its background jobs instead of stopping, so if it keeps restarting with nothing in between, look at **Settings → System → Logs → Supervisor** around the same times, and turn on more log detail as above.

**I saw "Error: Already set up" (status 403) in the log.**
Something sent the first-run setup form again after the household had been created — usually **Create household** pressed twice, or an old *Set up Hearth* page left open on another device or tab. Nothing was changed. Reload Hearth and sign in with the account you created; add other people from **Settings → People & household**.

## Signing in

**I'm asked for a password inside the HA panel.**
That's the one-time link between your HA login and your Hearth account. Afterwards the panel signs you in automatically.

**My partner sees the setup screen / can't get in.**
Add them under **Settings → People & household → Add user**, give them the temporary password, and they sign in once from the HA sidebar. Or switch on **Let any Home Assistant user in** under **Settings → App settings & security**. (If they were looking at *Set up Hearth* from before you created the household, they just need to reload.)

**"Too many wrong passwords — wait 15 minutes".**
After 8 wrong passwords for one account (or 20 from one address) in 15 minutes, sign-in pauses for 15 minutes. Restarting the add-on also clears it.

**I've been signed out.**
Sign-ins end after 30 days without opening Hearth, when your password is changed, or when someone presses **Sign out other devices**. Inside the HA panel you're signed straight back in.

**I forgot my Hearth password.**
Another admin can set a new one under **Settings → People & household → Edit**. Inside the HA panel you're still signed in automatically once your HA login is linked, so you can change it yourself there.

## Bank and import

**"Claiming setup token failed" / the token is used or expired.**
Setup tokens work once. Generate a new one in Synci, superFin or SimpleFIN Bridge and paste that — or paste the access URL directly. If the connection was created but the first import failed, you don't need a new token: press **Sync now** on it.

**Bank payments stopped arriving (Synci).**
Synci asks you to re-approve your bank about every 90 days. Renew it in Synci and Hearth carries on at the next sync.

**Some transactions appear twice.**
Usually two overlapping exports from a bank that changes descriptions between exports. Select the duplicates in the grid and delete them.

**A CSV imports with the wrong signs or dates.**
Change *Signs* or *Dates are* in the import preview before importing.

## Categories

**A shop keeps landing in the wrong category.**
Fix one transaction from it with "use this category for every transaction from …" ticked. Every past and future transaction from that merchant follows. For more complex rules, use a [workflow](workflows.md).

**The AI's categories look wrong.**
**Money → Filed by AI** to review them; **Settings → Local AI → Undo AI categories** to clear the ones you haven't accepted. A larger fast model helps.

## Local AI

**"Can't reach Ollama".**
Use the IP address of the Ollama machine, not `localhost`. Ollama must listen on the network (`OLLAMA_HOST=0.0.0.0`). Check that `http://<ip>:11434/api/tags` opens from another device.

**Answers are slow.**
The first request loads the model. Increase *Keep model loaded for*, and use a smaller **fast model** for background jobs.

**It says it "can't look things up".**
Your model doesn't support tool calling. Hearth answers from a data summary instead; for better answers use `qwen2.5:7b-instruct`, `qwen3:8b` or `llama3.1:8b`.

**It makes up numbers.**
Set *Creativity* to *Precise*, use a tool-capable model, and make sure *Let the assistant look things up* is on.

**Receipt scanning button is missing.**
Set a **vision model** in **Settings → Local AI** .

## Email receipts

**"Couldn't sign in" when connecting a mailbox.**
Most providers need an **app password** for IMAP, not your normal password — see [Connecting a mailbox](email-receipts.md#connecting-a-mailbox). Outlook.com and Microsoft 365 don't use passwords — choose *Outlook.com / Microsoft 365* and sign in with Microsoft through your Entra app ([setup](email-receipts.md#outlookcom-hotmail-and-microsoft-365)).

**Microsoft sign-in says the application wasn't found (AADSTS700016) or isn't allowed.**
Check the client ID, and that the account type matches the app: an app registered for *this organizational directory only* needs *A specific tenant ID*; personal Outlook.com accounts need the app to allow *personal Microsoft accounts*. *AADSTS7000218* means **Allow public client flows** is still off.

**Microsoft mailbox shows "Sign in" again.**
The sign-in token has expired or been revoked (e.g. after a password change). Press **Sign in** and enter the new code.

**A receipt was matched to the wrong bill.**
Press **Change**, pick the right one, and approve. Hearth remembers the sender for next time.

**Receipts aren't being found.**
Check the right folders are selected, and that the emails arrived within the look-back period. Turning on Local AI helps with unusual receipt formats.

## Home Assistant

**No notifications on my phone.**
Pick your phone's `mobile_app_…` service in **Settings → Integrations**, or in the workflow's notify action. Check the service works from HA's Developer tools → Actions.

**Tapping a notification doesn't open Hearth.**
The link opens the add-on's panel; make sure **Show in sidebar** is on for the add-on.

**`sensor.hearth_*` entities are missing.**
Check **Publish sensors** is on in **Settings → App settings & security**. They appear within 15 minutes of the add-on starting and reappear shortly after an HA restart.

**An HA calendar shows no events.**
Check the entity shows events in HA's own Calendar view, then press **Sync** in **Settings → Calendars**.

## General

**A bank connection or mailbox stops working after restoring or moving Hearth.**
Saved logins are encrypted with `hearth.key` in Hearth's data folder (or `HEARTH_SECRET_KEY`). If the database was restored without that key, the log says *A stored secret could not be decrypted* — reconnect the bank feeds and mailboxes, or restore the matching key. Transactions and everything else are unaffected.

**Can I use it on my phone?**
Yes — open Hearth from the sidebar of the Home Assistant app. To install it as its own app, see [Using Hearth outside the panel](home-assistant.md#using-hearth-outside-the-panel-optional-network-port).

**Does my phone keep a copy of my finances?**
No. Financial data is never cached on the device; only the app's own code is kept so it starts quickly.

**Does it support currencies other than GBP?**
Amounts display in pounds today; other currencies are on the roadmap.

**How do I update?**
When a new version is pushed, Home Assistant shows an **Update** button on the add-on. Your data is kept, and anything saved before encryption was added (version 1.5.0) is encrypted automatically on the first start.

**How do I restore a backup?**
Restore the Hearth add-on from a Home Assistant backup (Docker: put the `data` folder back). The encrypted `.hearth` download from **Settings → Your data** is a passphrase-locked copy of your data for safekeeping; it doesn't include bank, mailbox or calendar connections, and there's no button to load it back in yet.
