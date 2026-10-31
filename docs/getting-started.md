# Getting started

[← Documentation](../README.md#documentation)

This takes about 15 minutes, most of it waiting for your bank history to import.

## 1. Install the add-on

1. In Home Assistant open **Settings → Add-ons → Add-on Store**, then **⋮ → Repositories**, add `https://github.com/shotgn16/hearth` and close the dialog. (Or use the **Add repository** button on the [project page](../README.md).)
2. Scroll to **Hearth**, open it and press **Install**. Home Assistant downloads a ready-made image for your machine (amd64 or aarch64) — there's nothing to compile.

## 2. Start it

Press **Start** and turn on **Show in sidebar**. There's nothing to fill in on the add-on's Configuration tab: every setting lives inside Hearth. The only thing there is an optional network port (see [Home Assistant](home-assistant.md)).

## 3. Create your household

Open **Hearth** from the sidebar. The first screen creates your household and your account; your name is filled in from Home Assistant. Your Hearth account is linked to your HA login, so from now on the panel signs you straight in.

Then, inside Hearth:

| Where | What to set |
|---|---|
| **Settings → Local AI** | **Ollama address** — the machine running Ollama, e.g. `http://192.168.1.50:11434` (not `localhost`, which would mean the add-on itself) — and the chat, fast and vision models. |
| **Settings → App settings** | **Time zone** (paydays, month boundaries, morning summary), **Publish sensors** (`sensor.hearth_*` for dashboards), **Let any Home Assistant user in**, and how much goes in the log. |

You land on a welcome screen with the next steps.

## 4. Get your money in

- **Connect your bank** — [Bank connections](bank-and-import.md#connecting-your-bank-superfin). Hearth pulls all the history your bank allows and then syncs every 4 hours.
- **Import older statements** — [Importing](bank-and-import.md#importing-statements). Drop in CSV/OFX/QIF files; duplicates are skipped.

As transactions arrive, Hearth cleans up merchant names, categorises them, spots subscriptions and bills, and asks the local AI to place anything it doesn't recognise. Anything unclear goes to **Needs attention**.

## 5. Add your people

**Settings → People & household**:

- **Users** are people who sign in (your partner, older children). Give them a temporary password; the first time they open Hearth from the HA sidebar they sign in once and their HA login is linked.
- **People you spend on** are tracked without a login — younger children, parents, pets.

See [Households](household.md).

## 6. Bring in your calendars

**Settings → Calendars → From Home Assistant** lists every calendar you've connected to HA. Tick the ones you want copied. See [Calendars and event costs](calendars-and-events.md).

## 7. Turn on notifications

**Settings → Integrations → Home Assistant** — pick which HA notify services (your phones) should receive Hearth's notifications. Workflows can target specific phones too. See [Workflows](workflows.md).

## 8. Set a couple of budgets

**Plan → Budgets → Suggest some** asks the AI to propose budgets from your last six months; confirm the ones you like. Or press **New budget**.

That's it. From here on the idea is that you mostly look at **Today** and clear **Needs attention** when the badge appears.

Next: [Everyday use](everyday-use.md)
