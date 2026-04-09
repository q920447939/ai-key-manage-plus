#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.docker.local"
SETUP_SCRIPT="${ROOT_DIR}/scripts/setup-env.sh"

if [[ "${1:-}" == "--reconfigure" ]]; then
  shift
  bash "$SETUP_SCRIPT" --force
fi

if [[ ! -f "$ENV_FILE" ]]; then
  bash "$SETUP_SCRIPT"
fi

exec docker compose --env-file "$ENV_FILE" up -d --build "$@"
