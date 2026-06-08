import {
  getConfig,
  type AppConfig,
  type AppEnvironment,
} from "../config/env.js";
import {
  getDedupeStore,
  type DeliveryDedupeStore,
} from "../modules/aicoin/dedupe.js";
import { normalizeAicoinPayload } from "../modules/aicoin/normalize.js";
import { LarkClient } from "../modules/lark/client.js";
import {
  hasDeliveryFailures,
  notifyPriceAlert,
  type NotifyPriceAlertArgs,
} from "../modules/notify/service.js";
import { HttpError, isHttpError } from "../shared/errors.js";
import {
  firstValue,
  jsonResult,
  type HandlerRequest,
  type HandlerResult,
} from "../shared/http.js";

interface AicoinHandlerDependencies {
  config?: AppConfig;
  configEnv?: AppEnvironment;
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

  if (method === "GET" || method === "HEAD") {
    return jsonResult(200, buildHealthPayload(now));
  }

  if (method !== "POST") {
    return jsonResult(405, {
      ok: false,
      error: "method_not_allowed",
      message: "Only GET, HEAD, and POST are supported.",
    });
  }

  try {
    const config = dependencies.config ?? getConfig(dependencies.configEnv);
    validateWebhookToken(request, config);

    const requestReceivedAt = now();
    const rawBody = typeof request.body === 'string' ? request.body : (() => { try { return JSON.stringify(request.body); } catch { return String(request.body); } })();
    console.log(`[body] ${rawBody}`);
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

function parseJsonBody(body: unknown): unknown {
  if (body === undefined || body === null) {
    throw new HttpError(400, "invalid_json", "Request body is required.");
  }

  if (isNodeBuffer(body)) {
    return parseJsonString(decodeTextBody(body));
  }
  if (typeof body === "string") {
    return parseJsonString(body);
  }
  if (body instanceof Uint8Array) {
    return parseJsonString(decodeTextBody(body));
  }
  if (body instanceof ArrayBuffer) {
    return parseJsonString(decodeTextBody(new Uint8Array(body)));
  }
  if (ArrayBuffer.isView(body)) {
    return parseJsonString(
      decodeTextBody(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      ),
    );
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

function decodeTextBody(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function buildHealthPayload(now: () => Date) {
  return {
    service: "aicoin-lark-webhook",
    status: "ok",
    timestamp: now().toISOString(),
  };
}

function isNodeBuffer(body: unknown): body is Uint8Array {
  return (
    typeof Buffer !== "undefined" &&
    typeof Buffer.isBuffer === "function" &&
    Buffer.isBuffer(body)
  );
}
