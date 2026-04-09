#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"
DOCKER_ENV_FILE="${ROOT_DIR}/.env.docker.local"

print_usage() {
  printf "用法:\n"
  printf "  bash scripts/reset-auth.sh --local\n"
  printf "  bash scripts/reset-auth.sh --docker\n"
}

resolve_local_database_path() {
  local env_file="$1"
  local configured_path=""

  if [[ -f "$env_file" ]]; then
    configured_path="$(awk -F= '/^DATABASE_PATH=/{print substr($0, index($0, "=") + 1)}' "$env_file" | tail -n 1)"
  fi

  if [[ -z "$configured_path" ]]; then
    printf "%s/data/ai-key-vault.db" "$ROOT_DIR"
    return 0
  fi

  if [[ "$configured_path" == /* ]]; then
    printf "%s" "$configured_path"
    return 0
  fi

  printf "%s/%s" "$ROOT_DIR" "${configured_path#./}"
}

run_local_reset() {
  if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
    printf "未找到 %s，请先执行 bash scripts/setup-env.sh\n" "$LOCAL_ENV_FILE" >&2
    exit 1
  fi

  local db_path
  db_path="$(resolve_local_database_path "$LOCAL_ENV_FILE")"

  APP_ENV_FILE="$LOCAL_ENV_FILE" APP_DB_PATH="$db_path" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync } = require("node:crypto");
const Database = require("better-sqlite3");

function parseEnvFile(filePath) {
  const values = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalizedLine = line.startsWith("export ") ? line.slice(7) : line;
    const splitIndex = normalizedLine.indexOf("=");
    if (splitIndex <= 0) continue;

    const key = normalizedLine.slice(0, splitIndex).trim();
    let value = normalizedLine.slice(splitIndex + 1);

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function readConfiguredValue(fileEnv, name) {
  const directValue = process.env[name] || fileEnv[name];
  if (typeof directValue === "string" && directValue.trim() !== "") {
    return directValue;
  }

  const encodedValue = process.env[`${name}_B64`] || fileEnv[`${name}_B64`];
  if (typeof encodedValue === "string" && encodedValue.trim() !== "") {
    return Buffer.from(encodedValue, "base64").toString("utf8");
  }

  throw new Error(`缺少环境变量: ${name} 或 ${name}_B64`);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const envFile = process.env.APP_ENV_FILE;
const dbPath = process.env.APP_DB_PATH;
if (!envFile || !dbPath) {
  throw new Error("APP_ENV_FILE 或 APP_DB_PATH 未提供");
}

const fileEnv = parseEnvFile(envFile);
const username = readConfiguredValue(fileEnv, "DEFAULT_USERNAME").trim();
const password = readConfiguredValue(fileEnv, "DEFAULT_PASSWORD");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();
const passwordHash = hashPassword(password);

db.transaction(() => {
  db.prepare("DELETE FROM users").run();
  db.prepare(
    "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(username, passwordHash, now, now);
})();

console.log(`已重置本地登录账号，当前用户名: ${username}`);
console.log(`数据库路径: ${dbPath}`);
NODE
}

run_docker_reset() {
  if [[ ! -f "$DOCKER_ENV_FILE" ]]; then
    printf "未找到 %s，请先执行 bash scripts/setup-env.sh\n" "$DOCKER_ENV_FILE" >&2
    exit 1
  fi

  docker compose --env-file "$DOCKER_ENV_FILE" exec -T ai-key-vault node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync } = require("node:crypto");
const Database = require("better-sqlite3");

function readConfiguredValue(name) {
  const directValue = process.env[name];
  if (typeof directValue === "string" && directValue.trim() !== "") {
    return directValue;
  }

  const encodedValue = process.env[`${name}_B64`];
  if (typeof encodedValue === "string" && encodedValue.trim() !== "") {
    return Buffer.from(encodedValue, "base64").toString("utf8");
  }

  throw new Error(`缺少环境变量: ${name} 或 ${name}_B64`);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const dbPath = process.env.DATABASE_PATH || "/app/data/ai-key-vault.db";
const username = readConfiguredValue("DEFAULT_USERNAME").trim();
const password = readConfiguredValue("DEFAULT_PASSWORD");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();
const passwordHash = hashPassword(password);

db.transaction(() => {
  db.prepare("DELETE FROM users").run();
  db.prepare(
    "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(username, passwordHash, now, now);
})();

console.log(`已重置 Docker 登录账号，当前用户名: ${username}`);
console.log(`数据库路径: ${dbPath}`);
NODE
}

case "${1:-}" in
  --local)
    run_local_reset
    ;;
  --docker)
    run_docker_reset
    ;;
  *)
    print_usage >&2
    exit 1
    ;;
esac
