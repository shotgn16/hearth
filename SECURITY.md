# Security policy

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/shotgn16/hearth/security/advisories/new)
instead, and include steps to reproduce the problem. You'll get a reply as soon as possible.

For how Hearth stores data, encrypts saved logins and handles sign-in, see
[Privacy, security and backups](docs/privacy-and-security.md).

## Good to know

- Hearth keeps everything on your own equipment and has no telemetry.
- Don't expose Hearth's port directly to the internet. Use the Home Assistant app, a VPN (Tailscale,
  WireGuard) or an HTTPS reverse proxy.
- The installers aren't code-signed yet. Download them only from this repository's
  [releases page](https://github.com/shotgn16/hearth/releases) and check them against `SHA256SUMS.txt`.
