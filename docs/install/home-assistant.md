# Installing Hearth in Home Assistant

[← Installing Hearth](README.md)

Hearth runs as a Home Assistant add-on. It appears in the sidebar and the Home Assistant app on every phone, signs you in with your Home Assistant login, and is included in Home Assistant backups.

You need **Home Assistant OS** or **Supervised**, the versions with the add-on store (**Settings → Add-ons**). Home Assistant *Container* and *Core* don't have add-ons; use [Docker](../standalone-docker.md) instead and [connect it to Home Assistant](../standalone-docker.md#connecting-to-home-assistant-from-a-standalone-install).

Works on 64-bit machines: Home Assistant Green and Yellow, Raspberry Pi 4/5, mini PCs and virtual machines.

## Option 1: from the Hearth desktop app

1. In Home Assistant, click your name (bottom of the sidebar) → **Security** tab → **Long-lived access tokens → Create token**. Name it "Hearth installer" and copy it. You must be an administrator.
2. In the Hearth desktop app, choose **Install in Home Assistant** (first run, or the Hearth menu → **Change setup…**).
3. Enter your Home Assistant address (e.g. `http://homeassistant.local:8123`) and paste the token. Press **Test connection**, then **Install in Home Assistant**.

The app adds the Hearth repository, installs the add-on, turns on **Show in sidebar** and starts it. The token is used only for this and isn't kept. You can delete it in Home Assistant afterwards.

## Option 2: in Home Assistant itself

1. Click this button, or go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add `https://github.com/shotgn16/hearth`:

   [![Add this repository to your Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fshotgn16%2Fhearth)
2. Find **Hearth** in the store (refresh with **⋮ → Check for updates** if it isn't there yet) and press **Install**.
3. Turn on **Show in sidebar** and press **Start**.

## Then

Open **Hearth** from the sidebar and create your household. → [Getting started](../getting-started.md) and [Home Assistant integration](../home-assistant.md)

**Phones:** the Home Assistant app already shows Hearth in its sidebar, at home and away. To use the separate [Hearth phone app](phones-and-tablets.md) instead, set a port for `8484/tcp` on the add-on's **Configuration → Network** section, restart the add-on, then use **Settings → Phones & devices** in Hearth.
