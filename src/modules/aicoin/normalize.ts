import { HttpError } from "../../shared/errors";

import type { AicoinPriceAlertPayload, PriceAlertEvent } from "./types";

export function normalizeAicoinPayload(
  payload: unknown,
  receivedAt: Date = new Date(),
): PriceAlertEvent {
  const root = asRecord(payload, "payload");
  const source = asNonEmptyString(root.source, "source");
  const eventType = asNonEmptyString(root.eventType, "eventType");

  if (source !== "AiCoin") {
    throw new HttpError(400, "invalid_source", "source must be AiCoin.");
  }
  if (eventType !== "price_alert") {
    throw new HttpError(
      400,
      "invalid_event_type",
      "eventType must be price_alert.",
    );
  }

  const triggerCondition = asRecord(root.triggerCondition, "triggerCondition");
  const triggerTypeRaw = asNonEmptyString(
    triggerCondition.type,
    "triggerCondition.type",
  );
  const threshold = asNonEmptyString(
    triggerCondition.threshold,
    "triggerCondition.threshold",
  );
  const exchange = asNonEmptyString(root.exchange, "exchange");
  const symbol = asNonEmptyString(root.symbol, "symbol");
  const currentPrice = asNonEmptyString(root.currentPrice, "currentPrice");
  const timestamp = asNonEmptyString(root.timestamp, "timestamp");
  const remark = asOptionalString(root.remark, "remark");

  const normalized: PriceAlertEvent = {
    source: "AiCoin",
    eventType: "price_alert",
    exchange,
    symbol,
    triggerTypeRaw,
    triggerTypeLabel: humanizeTriggerType(triggerTypeRaw),
    threshold,
    currentPrice,
    remark,
    timestamp,
    receivedAt: receivedAt.toISOString(),
    dedupeKey: buildDedupeKey({
      source,
      eventType,
      exchange,
      symbol,
      triggerCondition: {
        type: triggerTypeRaw,
        threshold,
      },
      currentPrice,
      remark,
      timestamp,
    }),
  };

  return normalized;
}

export function humanizeTriggerType(triggerType: string): string {
  switch (triggerType.trim().toLowerCase()) {
    case "up to":
      return "涨破";
    case "down to":
      return "跌破";
    default:
      return triggerType.trim();
  }
}

export function buildDedupeKey(payload: AicoinPriceAlertPayload): string {
  const parts = [
    payload.source,
    payload.eventType,
    payload.exchange,
    payload.symbol,
    payload.triggerCondition.type,
    payload.triggerCondition.threshold,
    payload.currentPrice,
    payload.timestamp,
    payload.remark ?? "",
  ];
  return parts.join("|");
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(
      400,
      "invalid_payload",
      `${fieldName} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "invalid_payload",
      `${fieldName} must be a string.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    throw new HttpError(
      400,
      "invalid_payload",
      `${fieldName} must not be empty.`,
    );
  }
  return trimmed;
}

function asOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "invalid_payload",
      `${fieldName} must be a string when provided.`,
    );
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
