# Installing Hearth on Linux

[← Installing Hearth](README.md)

For a Linux computer with a desktop (Ubuntu, Debian, Mint, Fedora, openSUSE and others), 64-bit Intel/AMD or ARM. Takes about 5 minutes.
**For a server without a screen**, use [Hearth Server](server-only.md) instead.

## 1. Download and install

Get the right file from the [downloads page](https://github.com/shotgn16/hearth/releases/latest). Choose `amd64` / `x86_64` for most PCs, or `arm64` / `aarch64` for ARM (e.g. Raspberry Pi 4/5 with a desktop).

**Ubuntu, Debian, Linux Mint, Pop!_OS, Zorin** (`.deb`): double-click the file to install it with Software Install, or in a terminal:

```bash
sudo apt install ./Hearth-*-Linux-amd64.deb
```

**Fedora, openSUSE, RHEL, Rocky** (`.rpm`):

```bash
sudo dnf install ./Hearth-*-Linux-x86_64.rpm        # openSUSE: sudo zypper install ./Hearth-…rpm
```

**Any other Linux** (`.AppImage`): make the file executable and open it.

```bash
chmod +x Hearth-*-Linux-x86_64.AppImage
./Hearth-*-Linux-x86_64.AppImage
```

On Ubuntu 22.04 and newer, AppImages need FUSE: `sudo apt install libfuse2t64` (on 22.04 it's `libfuse2`).

We recommend the `.deb` or `.rpm` if you'll run a household server, because the server needs a fixed place to run from.

## 2. Open it

Find **Hearth** in your applications menu (under Office), or run `hearth` in a terminal.

## 3. Choose how to use it

The setup wizard opens. Pick one. [What each choice does](README.md#3-what-the-setup-wizard-does)

- **Just me, on this computer**: press **Set up Hearth**. Done.
- **This computer and my phone**: Hearth stays in the system tray when you close the window, and starts when you log in. If you use a firewall, allow port 8484, e.g. `sudo ufw allow 8484/tcp`. (GNOME needs the *AppIndicator* extension to show tray icons. Ubuntu has it already.)
- **Our household server**: you'll be asked for your password (a polkit prompt). Hearth is installed as a systemd service called `hearth`, running as its own `hearth` account, and starts at boot. If `ufw` or `firewalld` is active, port 8484 is opened for you.
- **Install in Docker**: install [Docker Engine](https://docs.docker.com/engine/install/) and the Compose plugin first, and make sure your user can run `docker` (add yourself to the `docker` group, then log out and in again).
- **Install in Home Assistant**: see [Home Assistant](home-assistant.md).

When the wizard finishes, press **Open Hearth** and create your household. → [Getting started](../getting-started.md)

## Where things are

| What | Where |
|---|---|
| Your data (Just me / this computer and my phone) | `~/.config/Hearth/data` |
| Your data (household server) | `/var/lib/hearth` |
| App logs | `~/.config/Hearth/logs` (tray → **Open log folder**) |
| Household server logs | `journalctl -u hearth` |
| Household server program | `/opt/hearth-server` |
| The app (deb/rpm) | `/opt/Hearth` |

Control the household server with `sudo systemctl status|restart|stop hearth`.

Back up the data folder. It includes `hearth.key`, which protects your saved bank and email logins.

## Uninstalling

1. If you set up a household server or Docker, first open Hearth → **Change setup…**. Choose **Just me** and agree to remove the service (or stop the container).
2. Remove the app: `sudo apt remove hearth-desktop` or `sudo dnf remove hearth-desktop`, or delete the AppImage.
3. Your data stays where it was. Delete the folders above if you no longer want it.

<details><summary>Removing a household server by hand</summary>

```bash
sudo /opt/hearth-server/hearth-server service uninstall --copy-to /opt/hearth-server
```
</details>

## Problems

| Problem | Fix |
|---|---|
| The AppImage doesn't open | Install FUSE (above), or use the `.deb` / `.rpm`. |
| "pkexec is not available" when setting up a server | Install polkit (`sudo apt install pkexec` or `policykit-1`), or use [Hearth Server](server-only.md) with `sudo`. |
| No tray icon | GNOME: install the *AppIndicator and KStatusNotifierItem Support* extension. |
| Phone can't connect | Same network? Firewall: `sudo ufw allow 8484/tcp`. |
| Forgot your Hearth password | `/opt/Hearth/resources/hearth-server reset-password --email you@example.com --data ~/.config/Hearth/data` (household server: `sudo /opt/hearth-server/hearth-server reset-password --email … --data /var/lib/hearth`) |

More in [Troubleshooting & FAQ](../faq.md).
