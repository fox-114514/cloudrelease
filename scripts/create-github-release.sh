#!/usr/bin/env bash
set -euo pipefail

# Create a GitHub Release and upload the packaged installers.
# Usage:
#   export GITHUB_TOKEN=ghp_xxx
#   ./scripts/create-github-release.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/releases"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Please set GITHUB_TOKEN environment variable."
  echo "Generate one at: https://github.com/settings/tokens (repo scope required)"
  exit 1
fi

VERSION="0.4.0"
TAG="v${VERSION}"
REPO="fox-114514/cloudrelease"

# Ensure gh is available
GH_BIN="${GH_BIN:-gh}"
if ! command -v "$GH_BIN" >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com or set GH_BIN"
  exit 1
fi

export GH_TOKEN="$GITHUB_TOKEN"

cd "$ROOT_DIR"

# Create or update the release
if "$GH_BIN" release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists. Uploading assets..."
else
  echo "Creating release $TAG..."
  "$GH_BIN" release create "$TAG" \
    --repo "$REPO" \
    --title "StudyShot Relay $VERSION" \
    --notes "Installers for Windows, Android, and Linux."
fi

# Upload assets
for file in "$RELEASE_DIR"/*; do
  if [[ -f "$file" ]]; then
    echo "Uploading $(basename "$file")..."
    "$GH_BIN" release upload "$TAG" "$file" --repo "$REPO" --clobber
  fi
done

echo "Release published: https://github.com/$REPO/releases/tag/$TAG"
