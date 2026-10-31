# Troubleshooting & FAQ

[← Documentation](../README.md#documentation)

## Installing

**The add-on doesn't appear in the store after adding the repository.**
Refresh the store page (⋮ → Check for updates). Hearth needs a 64-bit system (`amd64` or `aarch64`).

**Install fails with an image download error.**
The ready-made image for that version may still be building (it takes a few minutes after an update is published) — try again shortly. If it keeps failing, check the [Actions tab](https://github.com/shotgn16/hearth/actions) on GitHub.

**Where are the logs?**
The add-on's **Log** tab. Set **Log level** to `debug` in the configuration for more detail.

## Signing in

**I'm asked for a password inside the HA panel.**
That's the one-time link between your HA login and your Hearth account. Afterwards the panel signs you in automatically.

**My partner sees the setup screen / can't get in.**
Add them under **Settings → People & household → Add user**, give them the temporary password, and they sign in once from the HA sidebar. Or switch on **Let any Home Assistant user in**.

## Bank and import

**"Claiming setup token failed".**
Setup tokens work once. Generate a new one in superFin and paste that — or paste the access URL directly.

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
Set a **vision model** in **Settings → Local AI** (or the add-on options).

## Email receipts

**"Couldn't sign in" when connecting a mailbox.**
Most providers need an **app password** for IMAP, not your normal password — see [Connecting a mailbox](email-receipts.md#connecting-a-mailbox). Outlook.com and Microsoft 365 need OAuth, which isn't supported yet; forward receipts to another mailbox instead.

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
Check **Publish sensors** is on in the add-on options. They appear within 15 minutes of the add-on starting and reappear shortly after an HA restart.

**An HA calendar shows no events.**
Check the entity shows events in HA's own Calendar view, then press **Sync** in **Settings → Calendars**.

## General

**Can I use it on my phone?**
Yes — open Hearth from the sidebar of the Home Assistant app.

**Does it support currencies other than GBP?**
Amounts display in pounds today; other currencies are on the roadmap.

**How do I update?**
When a new version is pushed, Home Assistant shows an **Update** button on the add-on. Your data is kept.
