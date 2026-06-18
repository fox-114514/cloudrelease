#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ICON_DIR="${HOME}/.local/share/icons"
APPS_DIR="${HOME}/.local/share/applications"

mkdir -p "$ICON_DIR" "$APPS_DIR"

cp "$SCRIPT_DIR/icon.svg" "$ICON_DIR/studyshot-relay.svg"

DESKTOP_FILE="$APPS_DIR/studyshot-relay.desktop"
sed \
  -e "s|{{EXEC}}|${PROJECT_DIR}/dist/index.js launch|" \
  -e "s|{{ICON}}|${ICON_DIR}/studyshot-relay.svg|" \
  "$SCRIPT_DIR/studyshot-relay.desktop" > "$DESKTOP_FILE"

chmod +x "$DESKTOP_FILE"

update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo "Installed desktop entry: $DESKTOP_FILE"
echo "Icon: $ICON_DIR/studyshot-relay.svg"
echo "You can now launch StudyShot Relay from your applications menu."
