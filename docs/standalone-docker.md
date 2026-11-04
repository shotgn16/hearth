# Run it with Docker (without Home Assistant)

[← Documentation](../README.md#documentation)

Hearth's Docker image runs on any Docker host: Linux, a NAS, or Docker Desktop on Mac and Windows. On amd64 and arm64 (e.g. Raspberry Pi 4/5).

**Easiest:** in the Hearth desktop app choose **Install in Docker**. It writes the compose file, starts the container and connects the app to it.

**By hand**, make a folder with this `compose.yaml` and run `docker compose up -d`:

```yaml
services:
  hearth:
    image: ghcr.io/shotgn16/hearth:latest
    container_name: hearth
    restart: unless-stopped
    ports:
      - "8484:8484"
    volumes:
      - ./data:/data
    environment:
      TZ: Europe/London
      OLLAMA_URL: http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Or from a copy of this repository: `docker compose up -d` (add `--build` to build the image from `server/` yourself).

Open `http://<server>:8484` and create your household. Data is stored in `./data`: the database (`hearth.db`), receipt files and the encryption key (`hearth.key`). Phones connect as described in [Phones & tablets](install/phones-and-tablets.md).

**Updating:** `docker compose pull && docker compose up -d`. Your data is kept.

## Settings

Set these under `environment:` in the compose file:

| Variable | Default | |
|---|---|---|
| `TZ` | `Europe/London` | Paydays, month boundaries, morning summary |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama on the Docker host; use an IP for another machine |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Chat model |
| `OLLAMA_FAST_MODEL` | *(chat model)* | Background jobs |
| `OLLAMA_VISION_MODEL` | *(none)* | Receipt scanning |
| `PORT` | `8484` | |
| `HEARTH_SECRET_KEY` | *(none — `hearth.key` is created in `./data`)* | Optional encryption key for saved logins and receipt files: 64 hex characters, or any passphrase. Once set, keep it set — changing it means reconnecting banks and mailboxes |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning` or `error` |
| `DATA_DIR` | `/data` in the container | Where Hearth keeps its files |

These are only starting values. The Ollama address and models can be changed later in **Settings → Local AI**, and the time zone and log detail in **Settings → App settings & security** — once saved there, the app's settings win over the environment.

## Connecting to Home Assistant from a standalone install

**Settings → Integrations → Home Assistant**: enter your HA URL and a long-lived access token (HA → your profile → Security → Long-lived access tokens); the token is stored encrypted. Notifications, calendars, sensors and workflow actions then work as described in [Home Assistant integration](home-assistant.md); sign-in uses Hearth's own email and password (the *Let any Home Assistant user in* and *Publish sensors* switches only appear in the add-on — sensors are published whenever HA is connected).

You can also send notifications to a self-hosted **ntfy** topic from the same screen.

## HTTPS and installing on phones

Don't expose port 8484 directly to the internet. To add Hearth to a phone's home screen as an app, browsers need HTTPS. Either put it behind the reverse proxy you already use, or:

```bash
docker compose --profile https up -d
```

starts Caddy with its own certificate on `https://<server>:8443`. See the comments in `Caddyfile` for trusting that certificate on phones.

## Backups

Back up the whole `data` folder (stop the container first, or copy while it's idle). Keep `hearth.key` with `hearth.db`: without it, transactions are still readable but saved bank, mailbox and calendar logins aren't. See [Privacy, security and backups](privacy-and-security.md).

## Without Docker

Use the [Hearth Server](install/server-only.md) download, which includes its own Node.js. Or, from a copy of this repository with Node.js 22.13 or newer:

```bash
cd server
npm ci
npm start                 # data in server/data
npm run demo              # sample household on port 8485 (alex@demo.local / demo1234)
```

Next: [Privacy, security and backups](privacy-and-security.md)
