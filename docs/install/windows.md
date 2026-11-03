# Installing Hearth on Windows

[← Installing Hearth](README.md)

Works on Windows 10 and 11 (64-bit). Takes about 5 minutes.

## 1. Download

From the [downloads page](https://github.com/shotgn16/hearth/releases/latest), get `Hearth-<version>-win-x64.exe`.

## 2. Install

1. Open the downloaded file.
2. If Windows shows **Windows protected your PC**, click **More info → Run anyway**. This appears because the installer isn't signed with a paid certificate.
3. Choose whether to install for **just you** (no administrator needed) or **everyone on this computer**, pick a folder if you want, and press **Install**.
4. Leave **Run Hearth** ticked and press **Finish**.

Hearth gets a Start menu entry and a desktop shortcut.

## 3. Choose how to use it

The setup wizard opens. Pick one. [What each choice does](README.md#3-what-the-setup-wizard-does)

- **Just me, on this computer**: press **Set up Hearth**. Done.
- **This computer and my phone**: when **Windows Security** asks whether Hearth can use the network, tick **Private networks** and choose **Allow**. Hearth stays in the system tray (the house icon by the clock; click **^** if you can't see it) when you close the window.
- **Our household server**: Windows asks for permission once (a **User Account Control** prompt). Hearth is installed as a Windows service called **Hearth** that starts with the computer, even before anyone signs in. The firewall is opened for private networks only. To keep it reachable:
  - **Settings → System → Power** (Power & battery): set **When plugged in, put my device to sleep after** to **Never**.
  - Make sure your home Wi-Fi is set to **Private**: **Settings → Network & internet → Wi-Fi → (your network) → Private network**.
- **Install in Docker**: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) first and start it.
- **Install in Home Assistant**: see [Home Assistant](home-assistant.md).

When the wizard finishes, press **Open Hearth** and create your household. → [Getting started](../getting-started.md)

## Using it every day

- Open **Hearth** from the Start menu or the desktop shortcut.
- The **house icon in the system tray** has: Open Hearth, Connect a phone…, Change setup…, Start Hearth when I log in, Check for updates…, Quit.
- With **Just me**, closing the window quits Hearth. With **This computer and my phone**, it keeps running in the tray. A household server keeps running on its own.

## Where things are

| What | Where |
|---|---|
| Your data (Just me / this computer and my phone) | `%APPDATA%\Hearth\data` (paste into File Explorer's address bar) |
| Your data (household server) | `C:\ProgramData\Hearth` (only administrators can open it) |
| App logs | `%APPDATA%\Hearth\logs` (tray → **Open log folder**) |
| Household server logs | `C:\ProgramData\Hearth\logs` |
| Household server program | `C:\Program Files\Hearth Server` |
| The service | **Services** app → **Hearth** (start, stop, restart) |

Back up the data folder. It includes `hearth.key`, which protects your saved bank and email logins.

## Uninstalling

1. If you set up a household server or Docker, first open Hearth → **Change setup…**. Choose **Just me** and agree to remove the service (or stop the container).
2. **Settings → Apps → Installed apps → Hearth → Uninstall.**
3. Your data stays where it was. Delete the folders above if you no longer want it.

<details><summary>Removing a household server by hand</summary>

In **Terminal (Admin)** or **PowerShell (Admin)**:

```powershell
& "C:\Program Files\Hearth Server\hearth-server.cmd" service uninstall --copy-to "C:\Program Files\Hearth Server"
```
</details>

## Problems

| Problem | Fix |
|---|---|
| "Hearth stopped" message | Tray → **Open log folder** and look at `server.log`. Then use **Change setup…** to try again, or another port under **More options**. |
| Phone can't connect | Same Wi-Fi? Network set to **Private**? Search Start for **Allow an app through Windows Firewall** and check Hearth (or **node.exe** for a household server) is ticked for **Private**. |
| Household server not starting | **Services** app → **Hearth** → **Start**, and check `C:\ProgramData\Hearth\logs`. |
| "Port 8484 is used by another program" | Choose another port under **More options** in the wizard. |
| Forgot your Hearth password | Right-click the Hearth shortcut → **Open file location**, open the `resources` folder, click the address bar, type `cmd` and press Enter. Then run: `hearth-server reset-password --email you@example.com --data "%APPDATA%\Hearth\data"` (household server: in an admin terminal, `"C:\Program Files\Hearth Server\hearth-server.cmd" reset-password --email you@example.com --data C:\ProgramData\Hearth`) |

More in [Troubleshooting & FAQ](../faq.md).
