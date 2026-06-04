import { getConfig, type AppConfig } from "../config/env";
import {
  getDedupeStore,
  type DeliveryDedupeStore,
} from "../modules/aicoin/dedupe";
import { normalizeAicoinPayload } from "../modules/aicoin/normalize";
import { LarkClient } from "../modules/lark/client";
import {
  hasDeliveryFailures,
  notifyPriceAlert,
  type NotifyPriceAlertArgs,
} from "../modules/notify/service";
import { HttpError, isHttpError } from "../shared/errors";
import {
  emptyResult,
  firstValue,
  jsonResult,
  type HandlerRequest,
  type HandlerResult,
} from "../shared/http";

interface AicoinHandlerDependencies {
  config?: AppConfig;
  now?: () => Date;
  createLarkClient?: (config: AppConfig) => LarkClient;
  dedupeStore?: DeliveryDedupeStore;
  notifyPriceAlert?: (
    args: NotifyPriceAlertArgs,
  ) => Promise<Awaited<ReturnType<typeof notifyPriceAlert>>>;
}

export async function handleAicoinRequest(
  request: HandlerRequest,
  dependencies: AicoinHandlerDependencies = {},
): Promise<HandlerResult> {
  const method = (request.method ?? "GET").toUpperCase();
  const now = dependencies.now ?? (() => new Date());

  if (method === "GET") {
    return jsonResult(200, {
      service: "aicoin-lark-webhook",
      status: "ok",
      timestamp: now().toISOString(),
    });
  }

  if (method === "HEAD") {
    return emptyResult(200);
  }

  if (method !== "POST") {
    return jsonResult(405, {
      ok: false,
      error: "method_not_allowed",
      message: "Only GET, HEAD, and POST are supported.",
    });
  }

  try {
    const config = dependencies.config ?? getConfig();
    validateWebhookToken(request, config);
    validateJsonContentType(request);

    const requestReceivedAt = now();
    const payload = parseJsonBody(request.body);
    const event = normalizeAicoinPayload(payload, requestReceivedAt);

    let duplicateUserIds: string[] = [];
    let dedupeStore = dependencies.dedupeStore;

    if (config.dedupeWindowMs > 0) {
      dedupeStore ??= getDedupeStore();

      duplicateUserIds = dedupeStore.findDuplicateUserIds(
        event.dedupeKey,
        config.larkUrgentUserIds,
        config.dedupeWindowMs,
        requestReceivedAt.getTime(),
      );
    }

    if (duplicateUserIds.length === config.larkUrgentUserIds.length) {
      return jsonResult(200, {
        ok: true,
        status: "duplicate",
        dedupeKey: event.dedupeKey,
        duplicateUserIds,
      });
    }

    const duplicateUserIdSet = new Set(duplicateUserIds);
    const pendingUserIds = config.larkUrgentUserIds.filter(
      (userId) => !duplicateUserIdSet.has(userId),
    );

    const clientFactory =
      dependencies.createLarkClient ??
      ((runtimeConfig: AppConfig) =>
        new LarkClient({
          baseUrl: runtimeConfig.larkBaseUrl,
          appId: runtimeConfig.larkAppId,
          appSecret: runtimeConfig.larkAppSecret,
          userIdType: runtimeConfig.larkUserIdType,
          timeoutMs: runtimeConfig.requestTimeoutMs,
        }));

    const deliveryResults = await (
      dependencies.notifyPriceAlert ?? notifyPriceAlert
    )({
      client: clientFactory(config),
      userIds: pendingUserIds,
      event,
    });

    const deliveredUserIds = deliveryResults
      .filter((result) => result.status === "delivered")
      .map((result) => result.userId);

    if (config.dedupeWindowMs > 0 && dedupeStore) {
      dedupeStore.rememberDeliveredUsers(
        event.dedupeKey,
        deliveredUserIds,
        config.dedupeWindowMs,
        requestReceivedAt.getTime(),
      );
    }

    if (hasDeliveryFailures(deliveryResults)) {
      return jsonResult(502, {
        ok: false,
        error: "lark_delivery_failed",
        results: deliveryResults,
        ...(duplicateUserIds.length > 0 ? { duplicateUserIds } : {}),
      });
    }

    return jsonResult(200, {
      ok: true,
      status: "delivered",
      dedupeKey: event.dedupeKey,
      results: deliveryResults,
      ...(duplicateUserIds.length > 0 ? { duplicateUserIds } : {}),
    });
  } catch (error) {
    if (isHttpError(error)) {
      return jsonResult(error.status, {
        ok: false,
        error: error.code,
        message: error.message,
      });
    }

    return jsonResult(500, {
      ok: false,
      error: "internal_error",
      message:
        error instanceof Error ? error.message : "Unexpected internal error.",
    });
  }
}

function validateWebhookToken(request: HandlerRequest, config: AppConfig) {
  const token = firstValue(request.query?.token);
  if (token !== config.aicoinWebhookToken) {
    throw new HttpError(401, "unauthorized", "Invalid webhook token.");
  }
}

function validateJsonContentType(request: HandlerRequest) {
  const contentType = firstValue(request.headers?.["content-type"]);
  if (!contentType) {
    return;
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(
      400,
      "invalid_content_type",
      "Content-Type must be application/json.",
    );
  }
}

function parseJsonBody(body: unknown): unknown {
  if (body === undefined || body === null) {
    throw new HttpError(400, "invalid_json", "Request body is required.");
  }

  if (Buffer.isBuffer(body)) {
    return parseJsonString(body.toString("utf8"));
  }
  if (body instanceof Uint8Array) {
    return parseJsonString(Buffer.from(body).toString("utf8"));
  }
  if (typeof body === "string") {
    return parseJsonString(body);
  }
  if (typeof body === "object") {
    return body;
  }

  throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
}

function parseJsonString(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new HttpError(400, "invalid_json", "Request body must not be empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }
}
