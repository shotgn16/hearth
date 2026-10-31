#!/usr/bin/env bash
# One-off: fills in your GitHub username and pushes this repository so Home Assistant can install from it.
# Usage:  ./publish-to-github.sh <github-username> ["Your Name <you@example.com>"]
# First create an EMPTY public repository called "hearth" at https://github.com/new (no README).
set -euo pipefail
USER_NAME="${1:?Usage: ./publish-to-github.sh <github-username> [\"Your Name <email>\"]}"
MAINTAINER="${2:-$USER_NAME}"

for f in README.md repository.yaml hearth/config.yaml; do
  sed -i.bak "s/YOUR_GITHUB_USER/${USER_NAME}/g; s/YOUR NAME/${MAINTAINER//\//\\/}/g" "$f" && rm -f "$f.bak"
done

[ -d .git ] || git init -q -b main
git add -A
git commit -qm "Set GitHub owner to ${USER_NAME}" || true
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${USER_NAME}/hearth.git"
git push -u origin main

echo
echo "Done. Add it to Home Assistant with:"
echo "https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2F${USER_NAME}%2Fhearth"
