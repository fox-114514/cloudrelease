#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="studyshot-relay-linux"
VERSION="0.1.0"
ARCH="amd64"
BUILD_DIR="${ROOT_DIR}/release/deb-build"
DEB_FILE="${ROOT_DIR}/release/${PKG_NAME}_${VERSION}_${ARCH}.deb"

cd "$ROOT_DIR"

# Ensure dependencies are installed and app is built
npm install
npm run build

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/usr/share/${PKG_NAME}"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/usr/share/applications"
mkdir -p "$BUILD_DIR/usr/share/icons/hicolor/scalable/apps"

# Copy application files
cp -r dist package.json package-lock.json node_modules "$BUILD_DIR/usr/share/${PKG_NAME}/"

# Create wrapper script
cat > "$BUILD_DIR/usr/bin/studyshot-relay" <<'EOF'
#!/usr/bin/env bash
exec node /usr/share/studyshot-relay-linux/dist/index.js "$@"
EOF
chmod +x "$BUILD_DIR/usr/bin/studyshot-relay"

# Copy icon
cp assets/icon.svg "$BUILD_DIR/usr/share/icons/hicolor/scalable/apps/${PKG_NAME}.svg"

# Create .desktop entry
cat > "$BUILD_DIR/usr/share/applications/${PKG_NAME}.desktop" <<EOF
[Desktop Entry]
Name=StudyShot Relay
Comment=StudyShot Relay Linux Client
Exec=/usr/bin/studyshot-relay launch
Icon=${PKG_NAME}
Type=Application
Terminal=false
Categories=Network;Utility;
StartupNotify=true
EOF

# Create DEBIAN control
cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Depends: nodejs (>= 18)
Maintainer: StudyShot <relay@studyshot.local>
Description: StudyShot Relay Linux Client
 Web-based Linux client for StudyShot Relay, supporting
 auto upload, auto receive, and server administration.
EOF

# Create DEBIAN postinst to update icon cache
cat > "$BUILD_DIR/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
fi
EOF
chmod +x "$BUILD_DIR/DEBIAN/postinst"

mkdir -p "$(dirname "$DEB_FILE")"

if command -v fakeroot >/dev/null 2>&1; then
    fakeroot dpkg-deb --build "$BUILD_DIR" "$DEB_FILE"
else
    dpkg-deb --build --root-owner-group "$BUILD_DIR" "$DEB_FILE"
fi

echo "Built: $DEB_FILE"
