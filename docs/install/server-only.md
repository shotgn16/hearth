# Hearth Server (no desktop needed)

[← Installing Hearth](README.md)

For a computer without a screen: a Linux server, mini PC, NAS or Raspberry Pi, or a Mac or Windows machine you'd rather manage from a terminal. The download includes its own Node.js, so there's nothing else to install. Everyone then uses Hearth from their browser or the [phone app](phones-and-tablets.md).

Prefer containers? Use [Docker](../standalone-docker.md) instead.

## Linux

```bash
# 1. Download (use -Linux-arm64 for ARM, e.g. Raspberry Pi 4/5)
cd /tmp
curl -LO https://github.com/shotgn16/hearth/releases/latest/download/Hearth-Server-<version>-Linux-x64.tar.gz

# 2. Unpack into /opt
sudo tar -xzf Hearth-Server-*-Linux-x64.tar.gz -C /opt
sudo mv /opt/Hearth-Server-*-Linux-x64 /opt/hearth-server

# 3. Install the service: starts at boot, runs as its own "hearth" account, data in /var/lib/hearth
sudo /opt/hearth-server/hearth-server service install
```

Replace `<version>` with the version on the [downloads page](https://github.com/shotgn16/hearth/releases/latest), e.g. `1.6.0`.

Then open `http://<server address>:8484` from any computer or phone on your network and create your household. To see the addresses, run `/opt/hearth-server/hearth-server addresses`.

Needs systemd (Ubuntu, Debian, Raspberry Pi OS, Fedora and most others). If `ufw` or `firewalld` is active, port 8484 is opened for you.

| Task | Command |
|---|---|
| Status / restart / stop | `sudo systemctl status hearth` · `sudo systemctl restart hearth` · `sudo systemctl stop hearth` |
| Logs | `journalctl -u hearth -f` |
| Check the setup | `sudo /opt/hearth-server/hearth-server doctor --data /var/lib/hearth` |
| Reset a password | `sudo /opt/hearth-server/hearth-server reset-password --email you@example.com --data /var/lib/hearth` |
| Remove the service (keeps data) | `sudo /opt/hearth-server/hearth-server service uninstall` |

## macOS

```bash
cd ~/Downloads
tar -xzf Hearth-Server-*-macOS-arm64.tar.gz          # Intel Macs: -macOS-x64
sudo mv Hearth-Server-*-macOS-arm64 /usr/local/hearth-server
xattr -dr com.apple.quarantine /usr/local/hearth-server
sudo /usr/local/hearth-server/hearth-server service install --user "$(whoami)"
```

It starts when the Mac starts, even before anyone logs in. Data is in `/Library/Application Support/Hearth` and logs in `/Library/Logs/Hearth`.

## Windows

1. Download `Hearth-Server-<version>-Windows-x64.zip` and extract it to `C:\Program Files\Hearth Server`.
2. Open **Terminal (Admin)** and run:

```powershell
& "C:\Program Files\Hearth Server\hearth-server.cmd" service install
```

It installs a Windows service called **Hearth** that starts with the computer, and opens the firewall for private networks. Data is in `C:\ProgramData\Hearth`.

## Options

`hearth-server service install` accepts:

| Option | Default | |
|---|---|---|
| `--port` | `8484` | The port Hearth listens on |
| `--host` | `0.0.0.0` | `127.0.0.1` keeps it private to this computer (e.g. behind your own reverse proxy) |
| `--data` | `/var/lib/hearth`, `/Library/Application Support/Hearth`, `C:\ProgramData\Hearth` | Where your data lives |
| `--ollama-url` | `http://localhost:11434` | Your [Ollama](../local-ai.md) server for local AI |
| `--import-data <folder>` | | Copy an existing Hearth data folder in first, e.g. from a desktop install |
| `--scope user` | `system` | macOS / Linux: run as you, starting when you log in, instead of at boot |

`hearth-server help` lists every command. Add `--dry-run` to see what a command would do without changing anything.

## Running it without a service

To try it out, or under your own process manager:

```bash
/opt/hearth-server/hearth-server start --port 8484 --data ~/hearth-data
```

## Updating

Download the newer version, then replace the program folder and reinstall the service. Your data folder is separate and is kept.

```bash
sudo /opt/hearth-server/hearth-server service uninstall
sudo rm -rf /opt/hearth-server
# …unpack the new version into /opt/hearth-server as above…
sudo /opt/hearth-server/hearth-server service install
```

## Backups

Back up the data folder (`/var/lib/hearth` on Linux). It holds the database `hearth.db`, receipt files and `hearth.key`, the key that protects saved bank and email logins. Keep the key with the database. See [Privacy, security and backups](../privacy-and-security.md).
