# Installing Hearth on a Mac

[← Installing Hearth](README.md)

Works on macOS 12 (Monterey) or newer, on Apple silicon and Intel Macs. Takes about 5 minutes.

## 1. Download

From the [downloads page](https://github.com/shotgn16/hearth/releases/latest), get:
- **Apple silicon** (M1, M2, M3, M4…): `Hearth-<version>-macOS-AppleSilicon.dmg`
- **Intel**: `Hearth-<version>-macOS-Intel.dmg`

To check which you have, choose  → **About This Mac**.

## 2. Install

1. Open the downloaded `.dmg`.
2. Drag **Hearth** onto the **Applications** folder.
3. Eject the disk image (the ⏏ button next to "Install Hearth" in Finder).

## 3. Open it for the first time

Open **Hearth** from Applications or Launchpad.

If macOS says *"Hearth" can't be opened because Apple cannot check it for malicious software*, or *Apple could not verify "Hearth"*, that's because the download isn't registered with Apple (that costs a yearly fee). To open it:

1. Click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security** and scroll down to **Security**.
3. Next to *"Hearth" was blocked…*, click **Open Anyway**, then confirm with your password or Touch ID.

You only need to do this once.

<details><summary>If it says the app is "damaged"</summary>

This happens on some macOS versions with apps that aren't registered with Apple. Open **Terminal** (Applications → Utilities), paste this and press Return:

```bash
xattr -dr com.apple.quarantine /Applications/Hearth.app
```

Then open Hearth again.
</details>

## 4. Choose how to use it

The setup wizard opens. Pick one. [What each choice does](README.md#3-what-the-setup-wizard-does)

- **Just me, on this computer**: press **Set up Hearth**. Done.
- **This computer and my phone**: the first time, macOS asks whether Hearth can find devices on your local network or accept incoming connections. Choose **Allow** so your phone can connect. Hearth stays in the menu bar (the house icon at the top of the screen) when you close the window.
- **Our household server**: macOS asks for your password once to install the background service. It starts when the Mac starts. To keep it reachable:
  - **System Settings → Energy** (or **Battery → Options** on a laptop): turn on **Prevent automatic sleeping when the display is off**, and on a laptop keep it plugged in.
  - If the Mac asks whether **node** may accept incoming network connections, choose **Allow**.
- **Install in Docker**: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) first and start it.
- **Install in Home Assistant**: see [Home Assistant](home-assistant.md).

When the wizard finishes, press **Open Hearth** and create your household. → [Getting started](../getting-started.md)

## Using it every day

- Open Hearth from Applications, Launchpad or Spotlight (⌘ Space, type "Hearth").
- The **house icon in the menu bar** has: Open Hearth, Connect a phone…, Change setup…, Start Hearth when I log in, Check for updates…, Quit.
- Closing the window doesn't quit Hearth on a Mac. Use **Quit Hearth** (⌘ Q). With **Just me**, quitting stops Hearth. With a household server, the server keeps running on its own.

## Where things are

| What | Where |
|---|---|
| Your data (Just me / this computer and my phone) | `~/Library/Application Support/Hearth/data` |
| Your data (household server) | `/Library/Application Support/Hearth` |
| App logs | `~/Library/Application Support/Hearth/logs` (menu bar → **Open log folder**) |
| Household server logs | `/Library/Logs/Hearth/hearth.log` |
| Household server program | `/usr/local/hearth-server` |

Back up the data folder. It includes `hearth.key`, which protects your saved bank and email logins. Time Machine backs up both data folders automatically.

## Uninstalling

1. If you set up a household server or Docker, first open Hearth → **Change setup…**. Choose **Just me** and agree to remove the service (or stop the container).
2. Quit Hearth and drag **Hearth** from Applications to the Bin.
3. Your data stays where it was. Delete the folders above if you no longer want it.

<details><summary>Removing a household server by hand</summary>

```bash
sudo /usr/local/hearth-server/hearth-server service uninstall --copy-to /usr/local/hearth-server
```
</details>

## Problems

| Problem | Fix |
|---|---|
| "Hearth stopped" message | Menu bar → **Open log folder** and look at `server.log`. Then use **Change setup…** to try again, or another port under **More options**. |
| Phone can't connect | Both devices on the same Wi-Fi? **System Settings → Network → Firewall → Options**: make sure Hearth (and `node`, for a household server) is allowed. |
| "Port 8484 is used by another program" | Choose another port under **More options** in the wizard. |
| Forgot your Hearth password | In Terminal: `/Applications/Hearth.app/Contents/Resources/hearth-server reset-password --email you@example.com --data ~/Library/Application\ Support/Hearth/data` |

More in [Troubleshooting & FAQ](../faq.md).
