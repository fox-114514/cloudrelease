#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env.production"

DOMAIN="${STUDYSHOT_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
DEPLOY_MODE="${DEPLOY_MODE:-https}"
PUBLIC_IP="${PUBLIC_IP:-}"
HTTP_PORT="${HTTP_PORT:-3000}"
OWNER_LOGIN="${INITIAL_OWNER_LOGIN:-owner}"
OWNER_PASSWORD="${INITIAL_OWNER_PASSWORD:-}"
POSTGRES_USER="${POSTGRES_USER:-studyshot}"
POSTGRES_DB="${POSTGRES_DB:-studyshot}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
JWT_SECRET="${JWT_SECRET:-}"
MAX_IMAGE_SIZE_MB="${MAX_IMAGE_SIZE_MB:-30}"
DEFAULT_RETENTION_DAYS="${DEFAULT_RETENTION_DAYS:-30}"
FORCE_ENV=0
SKIP_HEALTH=0

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-backend.sh --domain studyshot.example.com --email admin@example.com
  scripts/deploy-backend.sh --ip-http 1.2.3.4

Options:
  --domain <domain>             Public domain for HTTPS/WSS, e.g. studyshot.example.com
  --email <email>               ACME email for Caddy certificate registration
  --ip-http <public-ip>         Deploy HTTP-only backend at http://<public-ip>:3000
  --http-port <port>            Public HTTP port for --ip-http, default: 3000
  --owner-login <login>         Initial owner login, default: owner
  --owner-password <password>   Initial owner password. If omitted, a random password is generated.
  --postgres-password <value>   PostgreSQL password. If omitted, a random hex password is generated.
  --jwt-secret <value>          JWT secret. If omitted, a random hex secret is generated.
  --max-image-size-mb <value>   Backend max image size, default: 30
  --retention-days <value>      Default image retention days, default: 30
  --force-env                   Rewrite backend/.env.production
  --skip-health                 Do not wait for /api/v1/healthz after deployment
  -h, --help                    Show this help

If backend/.env.production already exists, the script keeps it and deploys directly
unless --force-env is provided.

Warning: --ip-http is not encrypted. Use it only for temporary tests or behind
Tailscale / ZeroTier / WireGuard / another trusted private network.
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

random_hex() {
  openssl rand -hex "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      ACME_EMAIL="${2:-}"
      shift 2
      ;;
    --ip-http)
      DEPLOY_MODE="ip-http"
      PUBLIC_IP="${2:-}"
      shift 2
      ;;
    --http-port)
      HTTP_PORT="${2:-}"
      shift 2
      ;;
    --owner-login)
      OWNER_LOGIN="${2:-}"
      shift 2
      ;;
    --owner-password)
      OWNER_PASSWORD="${2:-}"
      shift 2
      ;;
    --postgres-password)
      POSTGRES_PASSWORD="${2:-}"
      shift 2
      ;;
    --jwt-secret)
      JWT_SECRET="${2:-}"
      shift 2
      ;;
    --max-image-size-mb)
      MAX_IMAGE_SIZE_MB="${2:-}"
      shift 2
      ;;
    --retention-days)
      DEFAULT_RETENTION_DAYS="${2:-}"
      shift 2
      ;;
    --force-env)
      FORCE_ENV=1
      shift
      ;;
    --skip-health)
      SKIP_HEALTH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

need_cmd docker
need_cmd openssl

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "Docker Compose is required"
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  fail "backend directory not found: $BACKEND_DIR"
fi

GENERATED_OWNER_PASSWORD=""

if [[ ! -f "$ENV_FILE" || "$FORCE_ENV" -eq 1 ]]; then
  if [[ "$DEPLOY_MODE" == "ip-http" ]]; then
    [[ -n "$PUBLIC_IP" ]] || fail "--ip-http requires a public IP"
  else
    DEPLOY_MODE="https"
    [[ -n "$DOMAIN" ]] || fail "--domain is required when generating .env.production"
    [[ -n "$ACME_EMAIL" ]] || fail "--email is required when generating .env.production"
  fi

  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD="$(random_hex 24)"
  fi
  if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET="$(random_hex 48)"
  fi
  if [[ -z "$OWNER_PASSWORD" ]]; then
    OWNER_PASSWORD="$(random_hex 12)"
    GENERATED_OWNER_PASSWORD="$OWNER_PASSWORD"
  fi

  [[ "${#OWNER_PASSWORD}" -ge 8 ]] || fail "owner password must be at least 8 characters"

  if [[ "$DEPLOY_MODE" == "ip-http" ]]; then
    PUBLIC_BASE_URL="http://${PUBLIC_IP}:${HTTP_PORT}"
  else
    PUBLIC_BASE_URL="https://${DOMAIN}"
  fi

  cat >"$ENV_FILE" <<ENV
DEPLOY_MODE=${DEPLOY_MODE}
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}

POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}

JWT_SECRET=${JWT_SECRET}
INITIAL_OWNER_LOGIN=${OWNER_LOGIN}
INITIAL_OWNER_PASSWORD=${OWNER_PASSWORD}

STORAGE_DIR=/var/lib/studyshot/storage
MAX_IMAGE_SIZE_MB=${MAX_IMAGE_SIZE_MB}
DEFAULT_RETENTION_DAYS=${DEFAULT_RETENTION_DAYS}
CORS_ALLOWED_ORIGINS=

# Self-hosted update channels; fill the path/version fields for each published package.
ANDROID_UPDATE_APK_PATH=
ANDROID_UPDATE_VERSION_CODE=
ANDROID_UPDATE_VERSION_NAME=
ANDROID_UPDATE_RELEASE_NOTES=
WINDOWS_UPDATE_PACKAGE_PATH=
WINDOWS_UPDATE_VERSION_NAME=
WINDOWS_UPDATE_RELEASE_NOTES=
LINUX_DESKTOP_UPDATE_PACKAGE_PATH=
LINUX_DESKTOP_UPDATE_VERSION_NAME=
LINUX_DESKTOP_UPDATE_RELEASE_NOTES=
LINUX_CLI_UPDATE_PACKAGE_PATH=
LINUX_CLI_UPDATE_VERSION_NAME=
LINUX_CLI_UPDATE_RELEASE_NOTES=

STUDYSHOT_DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
PUBLIC_IP=${PUBLIC_IP}
HTTP_PORT=${HTTP_PORT}
ENV
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
else
  echo "Using existing $ENV_FILE"
fi

env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- || true
}

DEPLOY_MODE_FROM_ENV="$(env_value DEPLOY_MODE)"
if [[ -z "$DEPLOY_MODE_FROM_ENV" ]]; then
  DEPLOY_MODE_FROM_ENV="https"
fi

if [[ "$DEPLOY_MODE_FROM_ENV" == "ip-http" ]]; then
  COMPOSE_FILE="docker-compose.ip-http.yml"
  HEALTH_URL="$(env_value PUBLIC_BASE_URL)/api/v1/healthz"
else
  COMPOSE_FILE="docker-compose.prod.yml"
  HEALTH_DOMAIN="${DOMAIN:-$(env_value STUDYSHOT_DOMAIN)}"
  HEALTH_URL="https://${HEALTH_DOMAIN}/api/v1/healthz"
fi

cd "$BACKEND_DIR"
"${COMPOSE[@]}" --env-file .env.production -f "$COMPOSE_FILE" up -d --build

if [[ "$SKIP_HEALTH" -eq 0 ]]; then
  if command -v curl >/dev/null 2>&1; then
    HEALTH_OK=0
    set +e
    for _ in $(seq 1 30); do
      curl -fsS "$HEALTH_URL" >/dev/null 2>&1
      if [[ $? -eq 0 ]]; then
        HEALTH_OK=1
        break
      fi
      sleep 3
    done
    set -e
    if [[ "$HEALTH_OK" -ne 1 ]]; then
      fail "Health check failed: $HEALTH_URL"
    fi
    echo "Health check passed"
  else
    echo "curl not found; skipped health check"
  fi
fi

echo "Deployment finished"
if [[ -n "$GENERATED_OWNER_PASSWORD" ]]; then
  echo "Generated owner login: $OWNER_LOGIN"
  echo "Generated owner password: $GENERATED_OWNER_PASSWORD"
  echo "Save this password now. It will not be shown again by the app."
fi
