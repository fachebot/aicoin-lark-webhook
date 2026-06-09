import {
  getConfig,
  type AppConfig,
  type AppEnvironment,
} from "../config/env.js";
import {
  getDedupeStore,
  sha256,
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

/**
 * handleAicoinRequest 的可选依赖注入。
 * 测试时可通过此接口注入 mock 或自定义实现，避免真实的网络调用。
 */
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

/**
 * AiCoin 价格预警的 Webhook 入口。
 *
 * 处理流程：
 *   1. 校验 HTTP 方法和 webhook token
 *   2. 解析请求体，统一序列化为字符串 → SHA-256 作为去重键
 *   3. 若开启了去重（内存模式需要 DEDUP_WINDOW_MS > 0，Redis 模式只要有 REDIS_URL 即自动启用），
 *      查询哪些用户已在窗口期内收到过相同内容
 *   4. 排除已送达用户，仅向剩余用户发送 Lark 加急消息
 *   5. 记录本次成功送达的用户到去重存储
 *
 * 去重键使用 SHA-256(body) 而非结构化字段拼接，
 * 这样不论 AiCoin 推送的是结构化 JSON 还是纯文本内容，都能统一拦截重复请求。
 */
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

    // 统一序列化：不管 body 是 string 还是已解析的对象，先转成字符串再做 hash
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : (() => {
            try {
              return JSON.stringify(request.body);
            } catch {
              return String(request.body);
            }
          })();

    console.log(`[body] ${rawBody}`);

    // 用 SHA-256 将原始 body 映射为定长去重键
    const bodyHash = sha256(rawBody);

    const parsed = parseRequestBody(request.body);
    const event =
      typeof parsed === "string"
        ? createTextAlertEvent(parsed, requestReceivedAt)
        : normalizeAicoinPayload(parsed, requestReceivedAt);

    let duplicateUserIds: string[] = [];
    let dedupeStore = dependencies.dedupeStore;

    // 内存模式下 dedupeWindowMs 必须 > 0 才会启用去重；
    // Redis 模式下只要配置了 REDIS_URL 就自动启用，窗口为 0 时使用默认值 60 秒
    if (config.dedupeWindowMs > 0 || !!process.env.REDIS_URL) {
      dedupeStore ??= getDedupeStore();

      duplicateUserIds = await dedupeStore.findDuplicateUserIds(
        bodyHash,
        config.larkUrgentUserIds,
        config.dedupeWindowMs,
        requestReceivedAt.getTime(),
      );
    }

    // 全部用户都已在窗口期内收到 → 直接返回 duplicate，不再调用 Lark API
    if (duplicateUserIds.length === config.larkUrgentUserIds.length) {
      return jsonResult(200, {
        ok: true,
        status: "duplicate",
        dedupeKey: event.dedupeKey,
        duplicateUserIds,
      });
    }

    // 排除已送达用户，只给余下用户发消息
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

    // 只记录真正成功送达的用户，失败的不记——下次重试时可以继续补发
    const deliveredUserIds = deliveryResults
      .filter((result) => result.status === "delivered")
      .map((result) => result.userId);

    // 记录交付到去重存储，供后续相同内容的请求查询
    if (dedupeStore) {
      await dedupeStore.rememberDeliveredUsers(
        bodyHash,
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

/** 校验请求参数中的 webhook token 是否与配置一致 */
function validateWebhookToken(request: HandlerRequest, config: AppConfig) {
  const token = firstValue(request.query?.token);
  if (token !== config.aicoinWebhookToken) {
    throw new HttpError(401, "unauthorized", "Invalid webhook token.");
  }
}

/**
 * 解析请求体为结构化数据。
 * 若 body 是原始字符串且无法解析为 JSON，直接返回字符串本身，
 * 上游会将其作为纯文本告警处理。
 */
function parseRequestBody(body: unknown): unknown {
  if (body === undefined || body === null) {
    throw new HttpError(400, "invalid_json", "Request body is required.");
  }

  const raw = decodeRawBody(body);

  if (typeof raw === "object") {
    return raw;
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new HttpError(400, "invalid_json", "Request body must not be empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

/**
 * 将各种运行时传入的 body 格式统一为 string 或 object。
 * 兼容 Vercel 运行时可能传递的 Buffer / Uint8Array / ArrayBuffer / 已解析对象等。
 */
function decodeRawBody(body: unknown): string | Record<string, unknown> {
  if (isNodeBuffer(body)) {
    return decodeTextBody(body);
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return decodeTextBody(body);
  }
  if (body instanceof ArrayBuffer) {
    return decodeTextBody(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return decodeTextBody(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  if (typeof body === "object") {
    return body as Record<string, unknown>;
  }
  throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
}

/** 将字节数组解码为 UTF-8 字符串 */
function decodeTextBody(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** 当 AiCoin 推送纯文本而非结构化 JSON 时，包装为 PriceAlertEvent */
function createTextAlertEvent(
  text: string,
  receivedAt: Date,
): import("../modules/aicoin/types.js").PriceAlertEvent {
  return {
    source: "AiCoin",
    eventType: "price_alert",
    exchange: "",
    symbol: "",
    triggerTypeRaw: "text",
    triggerTypeLabel: "",
    threshold: "",
    currentPrice: "",
    remark: text,
    timestamp: receivedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    dedupeKey: "text:" + text,
  };
}

/** 构造健康检查响应（GET / HEAD） */
function buildHealthPayload(now: () => Date) {
  return {
    service: "aicoin-lark-webhook",
    status: "ok",
    timestamp: now().toISOString(),
  };
}

/** 检测 body 是否为 Node.js Buffer（Vercel 运行时常见格式） */
function isNodeBuffer(body: unknown): body is Uint8Array {
  return (
    typeof Buffer !== "undefined" &&
    typeof Buffer.isBuffer === "function" &&
    Buffer.isBuffer(body)
  );
}
