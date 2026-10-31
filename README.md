# Hearth for Home Assistant

Household money, handled. Bank sync, budgets for the whole family or each person, subscriptions spotted automatically, forecasts, calendar costs, price watching — and a local AI (Ollama) that looks things up in your real data. Everything stays on your Home Assistant box.

## Install

[![Add this repository to your Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FYOUR_GITHUB_USER%2Fhearth)

1. Click the button (or in Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and paste `https://github.com/YOUR_GITHUB_USER/hearth`).
2. Find **Hearth** in the store, press **Install**. It builds on your device the first time (a couple of minutes on a Raspberry Pi).
3. On the **Configuration** tab, set your Ollama address and model.
4. Press **Start**, then **Open Web UI** — or use **Hearth** in the sidebar.

Full guide: [hearth/DOCS.md](hearth/DOCS.md) (also shown on the add-on's Documentation tab).

## Not using Home Assistant?

The same app runs as a normal Docker container:

```bash
docker compose up -d --build     # then open http://<server>:8484
```

## Repository layout

```
repository.yaml       tells Home Assistant this is an add-on repository
hearth/               the add-on (and the app's full source)
  config.yaml         add-on manifest: ingress, options, permissions
  Dockerfile          builds on node:22-alpine for amd64 and aarch64
  DOCS.md             user guide shown inside Home Assistant
  translations/       option labels
  server/  public/    the app
docker-compose.yml    standalone install
```

## Releasing an update

Bump `version` in `hearth/config.yaml`, add a line to `hearth/CHANGELOG.md`, commit and push. Home Assistant shows an **Update** button on the add-on.
