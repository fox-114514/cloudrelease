#!/usr/bin/env bash
set -euo pipefail

# Generate a test signing keystore for release APK builds.
# In production, replace this with your own securely stored keystore.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STORE_DIR="${PROJECT_DIR}/app/keystore"
STORE_FILE="${STORE_DIR}/studyshot.keystore"
STORE_PASS="studyshot"
KEY_ALIAS="studyshot"
KEY_PASS="studyshot"

mkdir -p "$STORE_DIR"
cd "$STORE_DIR"

if [[ -f "$STORE_FILE" ]]; then
  echo "Keystore already exists: $STORE_FILE"
  exit 0
fi

keytool -genkey \
  -v \
  -keystore "$STORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$STORE_PASS" \
  -keypass "$KEY_PASS" \
  -dname "CN=StudyShot Relay, OU=StudyShot, O=StudyShot, L=Unknown, ST=Unknown, C=CN"

echo "Generated test keystore: $STORE_FILE"
echo "WARNING: This is a test keystore. Do not use it for production releases."
