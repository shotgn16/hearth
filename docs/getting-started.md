# Getting started

[← Documentation](../README.md#documentation)

This takes about 15 minutes, most of it waiting for your bank history to import.

## 1. Install Hearth

Follow [Installing Hearth](install/README.md) for your computer, server, Docker or Home Assistant. The desktop app's setup wizard does everything for you.

**In Home Assistant:** press **Start** on the add-on and turn on **Show in sidebar**. There's nothing to fill in on the add-on's Configuration tab: every setting lives inside Hearth. The only thing there is an optional network port (see [Using Hearth outside the panel](home-assistant.md#using-hearth-outside-the-panel-optional-network-port)).

## 2. Open it

Open the Hearth desktop app, the **Hearth** entry in the Home Assistant sidebar, or `http://<server>:8484` in a browser.

## 3. Create your household

The first screen, **Set up Hearth**, creates your household and your account. Choose an email and a password of 8 or more characters (you'll use them on your phone too) and press **Create household** once. In Home Assistant, your name is filled in for you and your Hearth account is linked to your HA login, so from then on the panel signs you straight in.

Only the very first account is created this way. Everyone else is added from inside Hearth (step 5); if you see *Already set up*, the household already exists — reload and sign in.

Then, inside Hearth:

| Where | What to set |
|---|---|
| **Settings → Local AI** | **Ollama address** — the machine running Ollama, e.g. `http://192.168.1.50:11434` (not `localhost`, which would mean the add-on itself; until you change it Hearth tries `http://homeassistant.local:11434`) — and the chat, fast and vision models. See [Local AI](local-ai.md). |
| **Settings → App settings & security** | **Time zone** (paydays, month boundaries, morning summary), **Publish sensors** (`sensor.hearth_*` for dashboards), **Let any Home Assistant user in**, **Log detail**, and a summary of what's encrypted and where you're signed in. Only admins can change these. |

You land on a welcome screen with the next steps.

## 4. Get your money in

- **Connect your bank** — [Bank connections](bank-and-import.md#connecting-your-bank). Paste a SimpleFIN setup token from Synci (UK banks), superFin or SimpleFIN Bridge. Hearth pulls up to about 2 years of history and then syncs every 4 hours.
- **Import older statements** — [Importing](bank-and-import.md#importing-statements). Drop in CSV/OFX/QIF files; duplicates are skipped.

As transactions arrive, Hearth cleans up merchant names, categorises them, spots subscriptions and bills, and asks the local AI to place anything it doesn't recognise. Anything unclear goes to **Needs attention**.

## 5. Add your people

**Settings → People & household**:

- **Users** are people who sign in (your partner, older children). Give them a temporary password. They sign in on their own phone or computer ([Phones & tablets](install/phones-and-tablets.md)); in Home Assistant, the first time they open Hearth from the sidebar they sign in once and their HA login is linked.
- **People you spend on** are tracked without a login — younger children, parents, pets.

See [Households](household.md).

## 6. Bring in your calendars

**Settings → Calendars**: with Home Assistant, **From Home Assistant** lists every calendar you've connected to HA; tick the ones you want copied. Outlook / Microsoft 365 calendars can also come in through a Microsoft sign-in, and anything else by iCal link. See [Calendars and event costs](calendars-and-events.md).

## 7. Connect your phones

**Settings → Phones & devices** shows a QR code: scan it with the Hearth app. See [Phones & tablets](install/phones-and-tablets.md).

**Notifications** go to the bell in Hearth. With Home Assistant, **Settings → Integrations → Home Assistant** lets you pick which HA notify services (your phones) should receive Hearth's notifications. Workflows can target specific phones too. See [Workflows](workflows.md).

## 8. Set a couple of budgets

**Plan → Budgets → Suggest some** asks the AI to propose budgets from your last six months; confirm the ones you like. Or press **New budget**.

## 9. Keep a backup

Back up Hearth's data folder. Its location for each kind of install is in the [install guides](install/README.md). In Home Assistant, Hearth is included in your backups; turn on backup encryption in Home Assistant (**Settings → System → Backups**), because the backup also holds the key that protects your bank and mailbox logins. See [Privacy, security and backups](privacy-and-security.md).

That's it. From here on the idea is that you mostly look at **Today** and clear **Needs attention** when the badge appears.

Next: [Everyday use](everyday-use.md)
