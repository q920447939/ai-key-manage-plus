#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"
DOCKER_ENV_FILE="${ROOT_DIR}/.env.docker.local"
FORCE_OVERWRITE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE_OVERWRITE=1
fi

prompt_nonempty() {
  local prompt="$1"
  local value=""

  while [[ -z "${value// }" ]]; do
    read -r -p "${prompt}: " value
  done

  printf "%s" "$value"
}

prompt_password_twice() {
  local first=""
  local second=""

  while true; do
    printf "请输入登录密码: " >&2
    if [[ -t 0 ]]; then
      IFS= read -r -s first
    else
      IFS= read -r first
    fi
    printf "\n" >&2

    printf "请再次输入登录密码: " >&2
    if [[ -t 0 ]]; then
      IFS= read -r -s second
    else
      IFS= read -r second
    fi
    printf "\n" >&2

    if [[ -z "${first// }" ]]; then
      printf "密码不能为空。\n" >&2
      continue
    fi

    if [[ "$first" != "$second" ]]; then
      printf "两次输入的密码不一致，请重新输入。\n" >&2
      continue
    fi

    printf "%s" "$first"
    return 0
  done
}

generate_secret() {
  if command -v node >/dev/null 2>&1; then
    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi

  printf "无法自动生成 AUTH_SECRET，请手动输入。\n" >&2
  return 1
}

to_base64() {
  printf "%s" "$1" | base64 | tr -d '\n'
}

confirm_overwrite() {
  local file_path="$1"

  if [[ ! -f "$file_path" || "$FORCE_OVERWRITE" -eq 1 ]]; then
    return 0
  fi

  local answer=""
  read -r -p "检测到 $(basename "$file_path") 已存在，是否覆盖？[y/N]: " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

write_env_file() {
  local file_path="$1"
  local database_path="$2"
  local auth_secret="$3"
  local username="$4"
  local password="$5"

  {
    printf "AUTH_SECRET=%s\n" "$auth_secret"
    printf "DEFAULT_USERNAME_B64=%s\n" "$(to_base64 "$username")"
    printf "DEFAULT_PASSWORD_B64=%s\n" "$(to_base64 "$password")"

    if [[ -n "$database_path" ]]; then
      printf "DATABASE_PATH=%s\n" "$database_path"
    fi
  } >"$file_path"

  chmod 600 "$file_path"
}

printf "将为运行环境生成登录凭据配置。\n"
printf "仓库不会再提供默认用户名和密码，必须由部署者自己设置。\n\n"

if ! confirm_overwrite "$LOCAL_ENV_FILE"; then
  printf "已取消，不覆盖 %s\n" "$LOCAL_ENV_FILE"
  exit 1
fi

if ! confirm_overwrite "$DOCKER_ENV_FILE"; then
  printf "已取消，不覆盖 %s\n" "$DOCKER_ENV_FILE"
  exit 1
fi

DEFAULT_USERNAME="$(prompt_nonempty "请输入登录用户名")"
DEFAULT_PASSWORD="$(prompt_password_twice)"

read -r -p "请输入 AUTH_SECRET（直接回车自动生成）: " AUTH_SECRET_INPUT
if [[ -n "${AUTH_SECRET_INPUT// }" ]]; then
  AUTH_SECRET="$AUTH_SECRET_INPUT"
else
  AUTH_SECRET="$(generate_secret)"
  printf "已自动生成 AUTH_SECRET。\n"
fi

write_env_file "$LOCAL_ENV_FILE" "./data/ai-key-vault.db" "$AUTH_SECRET" "$DEFAULT_USERNAME" "$DEFAULT_PASSWORD"
write_env_file "$DOCKER_ENV_FILE" "" "$AUTH_SECRET" "$DEFAULT_USERNAME" "$DEFAULT_PASSWORD"

printf "\n已写入:\n"
printf -- "- %s\n" "$LOCAL_ENV_FILE"
printf -- "- %s\n" "$DOCKER_ENV_FILE"
printf "\n可本地运行:\n"
printf "  npm run dev\n"
printf "\n可 Docker 部署:\n"
printf "  bash scripts/docker-compose-up.sh\n"
