# Installing Hearth

[← Documentation](../../README.md#documentation)

Hearth runs on your own equipment. Pick the setup that matches how you want to use it, then follow that guide. Every installer includes everything Hearth needs, so you don't need to install anything else first. You can switch setups later without losing your data.

## 1. Choose how you'll use it

| You want… | Choose | Guide |
|---|---|---|
| Hearth on **one computer**, just for you | Desktop app → **Just me, on this computer** | [macOS](macos.md) · [Windows](windows.md) · [Linux](linux.md) |
| Hearth on your computer **and your phone** | Desktop app → **This computer and my phone** | same as above, then [Phones & tablets](phones-and-tablets.md) |
| A **household server** that's always on, for several people and phones | Desktop app → **Our household server**, on a computer that stays on | same as above, then [Phones & tablets](phones-and-tablets.md) |
| A server **with no screen** (a Linux box, mini PC or NAS) | **Hearth Server** download | [Server without a desktop](server-only.md) |
| Hearth in **Docker** | Desktop app → **Install in Docker**, or one command | [Docker](../standalone-docker.md) |
| Hearth in **Home Assistant** (sidebar + HA app) | Desktop app → **Install in Home Assistant**, or the add-on store | [Home Assistant](home-assistant.md) |
| Your phone or tablet to open a Hearth that's already running | The Hearth app | [Phones & tablets](phones-and-tablets.md) |

**Not sure?**
- On your own, start with **Just me**.
- If more than one person will use it, or you want it on phones when your computer is asleep, use **Our household server** on a computer that's always on.
- If you already run Home Assistant, install Hearth in Home Assistant.

## 2. Download

Everything is on the [downloads page](https://github.com/shotgn16/hearth/releases/latest). Open **Assets** at the bottom of the newest release.

| For | File |
|---|---|
| Mac with Apple silicon (M1, M2, M3, M4…) | `Hearth-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Hearth-<version>-mac-x64.dmg` |
| Windows 10 or 11 | `Hearth-<version>-win-x64.exe` |
| Ubuntu, Debian, Linux Mint, Pop!_OS | `Hearth-<version>-linux-amd64.deb` (or `-arm64.deb`) |
| Fedora, openSUSE, RHEL | `Hearth-<version>-linux-x86_64.rpm` (or `-aarch64.rpm`) |
| Any other Linux | `Hearth-<version>-linux-x86_64.AppImage` (or `-arm64.AppImage`) |
| A server without a desktop | `Hearth-Server-<version>-linux-x64.tar.gz` (also for Mac and Windows) |
| Android phone or tablet | `Hearth-<version>-android.apk` |
| iPhone or iPad | `Hearth-<version>-ios-unsigned.ipa` — see [Phones & tablets](phones-and-tablets.md) |

Not sure which Mac you have? Choose  → **About This Mac**. "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.

## 3. What the setup wizard does

The first time you open the desktop app, a short wizard asks how you want to use Hearth. Then it sets everything up and shows each step as it happens.

| Choice | What gets set up | Where your data lives |
|---|---|---|
| **Just me, on this computer** | Hearth runs inside the app, reachable only from this computer. | In the app's own folder ([macOS](macos.md#where-things-are) · [Windows](windows.md#where-things-are) · [Linux](linux.md#where-things-are)) |
| **This computer and my phone** | As above, but phones on your Wi-Fi can connect. Hearth keeps running in the menu bar or system tray when you close the window, and starts when you log in. | Same as above |
| **Our household server** | A background service that starts with the computer, even before anyone logs in. You'll be asked for an administrator password once. The app becomes a window onto that server. | A system folder (shown in the wizard) |
| **Connect to an existing Hearth** | Nothing is installed. The app opens a Hearth that's already running somewhere else. | On that other computer |
| **Install in Docker** | A Docker container that restarts with Docker. Docker must already be installed. | `hearth-docker/data` in your home folder |
| **Install in Home Assistant** | Adds the Hearth add-on to your Home Assistant, installs it, starts it and puts it in the sidebar. You'll need a long-lived access token. | Inside Home Assistant (included in its backups) |

The wizard also looks for [Ollama](../local-ai.md) on the computer and uses it if it finds it. Local AI is optional.

To change your choice later, open the Hearth menu (menu bar on Mac, system tray on Windows and Linux) → **Change setup…**. If you move from **Just me** to a **household server**, the wizard can bring your data with it.

## 4. Then

1. Create your household: your name, email and a password. → [Getting started](../getting-started.md)
2. Connect your phones: **Settings → Phones & devices** shows a QR code. → [Phones & tablets](phones-and-tablets.md)
3. Add the rest of the household under **Settings → People & household**.

## Updating

- **Desktop app:** Hearth checks for updates and offers to restart when one is ready. You can also use **Check for updates…** in the Hearth menu. On Linux, `.deb` and `.rpm` installs update by installing the newer file.
- **Household server or Docker:** after the desktop app updates, it offers to update the server or container too.
- **Home Assistant:** an **Update** button appears on the add-on.
- **Phone app:** install the newer APK (Android) or sideload the newer IPA (iPhone/iPad). The app itself rarely changes, because everything you see comes from your Hearth server.

Your data is always kept.
