import { HttpError } from "../shared/errors.js";

export type LarkUserIdType = "open_id" | "union_id" | "user_id";

export interface AppConfig {
  aicoinWebhookToken: string;
  larkAppId: string;
  larkAppSecret: string;
  larkUserIdType: LarkUserIdType;
  larkUrgentUserIds: string[];
  larkBaseUrl: string;
  requestTimeoutMs: number;
  logLevel: string;
  dedupeWindowMs: number;
}

let cachedConfig: AppConfig | undefined;

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig(env);
  }
  return cachedConfig;
}

export function resetConfigCache() {
  cachedConfig = undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const larkUserIdType = normalizeUserIdType(
    readRequiredString(env, "LARK_USER_ID_TYPE"),
  );
  const larkUrgentUserIds = readStringList(env, "LARK_URGENT_USER_IDS");
  const dedupeWindowMs = readNonNegativeInteger(env, "DEDUP_WINDOW_MS", 0);

  if (larkUrgentUserIds.length === 0) {
    throw new HttpError(
      500,
      "config_error",
      "LARK_URGENT_USER_IDS must contain at least one user ID.",
    );
  }

  return {
    aicoinWebhookToken: readRequiredString(env, "AICOIN_WEBHOOK_TOKEN"),
    larkAppId: readRequiredString(env, "LARK_APP_ID"),
    larkAppSecret: readRequiredString(env, "LARK_APP_SECRET"),
    larkUserIdType,
    larkUrgentUserIds,
    larkBaseUrl:
      readOptionalString(env, "LARK_BASE_URL") ?? "https://open.larksuite.com",
    requestTimeoutMs: readNonNegativeInteger(env, "REQUEST_TIMEOUT_MS", 10000),
    logLevel: readOptionalString(env, "LOG_LEVEL") ?? "info",
    dedupeWindowMs,
  };
}

function readRequiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = readOptionalString(env, key);
  if (!value) {
    throw new HttpError(500, "config_error", `${key} is required.`);
  }
  return value;
}

function readOptionalString(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const raw = env[key];
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readStringList(env: NodeJS.ProcessEnv, key: string): string[] {
  const value = readOptionalString(env, key);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readNonNegativeInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const value = readOptionalString(env, key);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(
      500,
      "config_error",
      `${key} must be a non-negative integer.`,
    );
  }
  return parsed;
}

function normalizeUserIdType(value: string): LarkUserIdType {
  switch (value.toLowerCase()) {
    case "open_id":
    case "union_id":
    case "user_id":
      return value.toLowerCase() as LarkUserIdType;
    default:
      throw new HttpError(
        500,
        "config_error",
        "LARK_USER_ID_TYPE must be open_id, union_id, or user_id.",
      );
  }
}
