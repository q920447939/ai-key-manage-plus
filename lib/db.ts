import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { getBootstrapPassword, getBootstrapUsername, hashPassword } from "@/lib/auth";

type StoredSourceMeta = {
  kind: "manual" | "cc-switch-provider" | "cc-switch-deeplink";
  ccSwitchApp?: "claude" | "codex" | "gemini" | "opencode" | "openclaw";
};

type StoredProbeResult = {
  status: "success" | "error";
  supportedModels: string[];
  recommendedModel?: string;
  detail?: string;
  testedAt: string;
};

type StoredTestResult = {
  status: "success" | "error";
  message: string;
  detail?: string;
  responseText?: string;
  responseSource?: "stream" | "chat" | "responses";
  testedAt: string;
};

type StoredBenchmarkResult = {
  status: "success" | "error";
  model: string;
  tags: string[];
  speed?: Record<string, unknown>;
  detail?: string;
  testedAt: string;
};

export type StoredKeyConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  sourceMeta?: StoredSourceMeta;
  probe?: StoredProbeResult;
  lastTest?: StoredTestResult;
  benchmarks?: Record<string, StoredBenchmarkResult>;
};

type ConfigRow = {
  id: string;
  sort_order: number;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  created_at: string;
  source_meta: string | null;
  probe: string | null;
  last_test: string | null;
  benchmarks: string | null;
};

type UserRow = {
  username: string;
  password_hash: string;
};

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "ai-key-vault.db");
let dbInstance: Database.Database | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIsoString(value: unknown, fallback = new Date().toISOString()): string {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function toSerializableObject<T>(value: unknown): T | undefined {
  if (!isRecord(value) && !Array.isArray(value)) return undefined;

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return undefined;
  }
}

function normalizeSourceMeta(value: unknown): StoredSourceMeta | undefined {
  if (!isRecord(value)) return undefined;

  const kind = toNonEmptyString(value.kind);
  if (kind !== "manual" && kind !== "cc-switch-provider" && kind !== "cc-switch-deeplink") {
    return undefined;
  }

  const ccSwitchApp = toNonEmptyString(value.ccSwitchApp).toLowerCase();
  const nextMeta: StoredSourceMeta = { kind };
  if (["claude", "codex", "gemini", "opencode", "openclaw"].includes(ccSwitchApp)) {
    nextMeta.ccSwitchApp = ccSwitchApp as StoredSourceMeta["ccSwitchApp"];
  }
  return nextMeta;
}

function normalizeProbe(value: unknown): StoredProbeResult | undefined {
  if (!isRecord(value)) return undefined;

  const status = value.status;
  if (status !== "success" && status !== "error") return undefined;

  return {
    status,
    supportedModels: Array.isArray(value.supportedModels)
      ? uniqueStrings(value.supportedModels.map((item) => String(item)))
      : [],
    recommendedModel: toNonEmptyString(value.recommendedModel) || undefined,
    detail: toNonEmptyString(value.detail) || undefined,
    testedAt: toIsoString(value.testedAt),
  };
}

function normalizeLastTest(value: unknown): StoredTestResult | undefined {
  if (!isRecord(value)) return undefined;

  const status = value.status;
  if (status !== "success" && status !== "error") return undefined;

  const responseSource = toNonEmptyString(value.responseSource);
  return {
    status,
    message: toNonEmptyString(value.message) || (status === "success" ? "测试通过" : "测试失败"),
    detail: toNonEmptyString(value.detail) || undefined,
    responseText: toNonEmptyString(value.responseText) || undefined,
    responseSource:
      responseSource === "stream" || responseSource === "chat" || responseSource === "responses"
        ? responseSource
        : undefined,
    testedAt: toIsoString(value.testedAt),
  };
}

function normalizeBenchmarks(value: unknown): StoredKeyConfig["benchmarks"] | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value);
  if (entries.length === 0) return undefined;

  const nextBenchmarks: Record<string, StoredBenchmarkResult> = {};
  for (const [modelKey, rawResult] of entries) {
    if (!isRecord(rawResult)) continue;

    const status = rawResult.status;
    if (status !== "success" && status !== "error") continue;

    const model = toNonEmptyString(rawResult.model) || modelKey.trim();
    if (!model) continue;

    nextBenchmarks[model] = {
      status,
      model,
      tags: Array.isArray(rawResult.tags) ? uniqueStrings(rawResult.tags.map((item) => String(item))) : [],
      speed: toSerializableObject<Record<string, unknown>>(rawResult.speed),
      detail: toNonEmptyString(rawResult.detail) || undefined,
      testedAt: toIsoString(rawResult.testedAt),
    };
  }

  return Object.keys(nextBenchmarks).length > 0 ? nextBenchmarks : undefined;
}

function normalizeConfig(item: unknown, index: number): StoredKeyConfig | undefined {
  if (!isRecord(item)) return undefined;

  const sourceMeta = normalizeSourceMeta(item.sourceMeta);
  const probe = normalizeProbe(item.probe);
  const lastTest = normalizeLastTest(item.lastTest);
  const benchmarks = normalizeBenchmarks(item.benchmarks);
  const name = toNonEmptyString(item.name) || `配置${index + 1}`;
  const baseUrl = toNonEmptyString(item.baseUrl);
  const apiKey = toNonEmptyString(item.apiKey);
  const model = toNonEmptyString(item.model);
  const hasUsefulValue = Boolean(name || baseUrl || apiKey || model || sourceMeta || probe || lastTest || benchmarks);

  if (!hasUsefulValue) return undefined;

  return {
    id: toNonEmptyString(item.id) || randomUUID(),
    name,
    baseUrl,
    apiKey,
    model,
    createdAt: toIsoString(item.createdAt),
    sourceMeta,
    probe,
    lastTest,
    benchmarks,
  };
}

function parseJsonColumn<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function getDatabasePath(): string {
  return process.env.DATABASE_PATH?.trim() || DEFAULT_DB_PATH;
}

function initializeDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS configs (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_meta TEXT,
      probe TEXT,
      last_test TEXT,
      benchmarks TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_configs_sort_order ON configs(sort_order);
  `);

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const username = getBootstrapUsername();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(username, hashPassword(getBootstrapPassword()), now, now);
  }
}

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  initializeDatabase(dbInstance);
  return dbInstance;
}

export function getUserByUsername(username: string): UserRow | null {
  const normalized = username.trim();
  if (!normalized) return null;

  const row = getDb()
    .prepare("SELECT username, password_hash FROM users WHERE username = ?")
    .get(normalized) as UserRow | undefined;

  return row || null;
}

export function listConfigs(): StoredKeyConfig[] {
  const rows = getDb()
    .prepare(
      `SELECT id, sort_order, name, base_url, api_key, model, created_at, source_meta, probe, last_test, benchmarks
       FROM configs
       ORDER BY sort_order ASC, created_at DESC`
    )
    .all() as ConfigRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    model: row.model,
    createdAt: row.created_at,
    sourceMeta: parseJsonColumn<StoredSourceMeta>(row.source_meta),
    probe: parseJsonColumn<StoredProbeResult>(row.probe),
    lastTest: parseJsonColumn<StoredTestResult>(row.last_test),
    benchmarks: parseJsonColumn<Record<string, StoredBenchmarkResult>>(row.benchmarks),
  }));
}

export function replaceAllConfigs(rawConfigs: unknown): StoredKeyConfig[] {
  const source = Array.isArray(rawConfigs) ? rawConfigs : [];
  const normalized = source
    .map((item, index) => normalizeConfig(item, index))
    .filter((item): item is StoredKeyConfig => Boolean(item));

  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO configs (
      id, sort_order, name, base_url, api_key, model, created_at, source_meta, probe, last_test, benchmarks, updated_at
    ) VALUES (
      @id, @sort_order, @name, @base_url, @api_key, @model, @created_at, @source_meta, @probe, @last_test, @benchmarks, @updated_at
    )
  `);

  const transaction = db.transaction((configs: StoredKeyConfig[]) => {
    db.prepare("DELETE FROM configs").run();
    const now = new Date().toISOString();

    configs.forEach((config, index) => {
      insertStmt.run({
        id: config.id,
        sort_order: index,
        name: config.name,
        base_url: config.baseUrl,
        api_key: config.apiKey,
        model: config.model,
        created_at: config.createdAt,
        source_meta: config.sourceMeta ? JSON.stringify(config.sourceMeta) : null,
        probe: config.probe ? JSON.stringify(config.probe) : null,
        last_test: config.lastTest ? JSON.stringify(config.lastTest) : null,
        benchmarks: config.benchmarks ? JSON.stringify(config.benchmarks) : null,
        updated_at: now,
      });
    });
  });

  transaction(normalized);
  return listConfigs();
}
