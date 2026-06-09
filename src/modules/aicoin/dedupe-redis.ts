import { createClient, type RedisClientType } from "redis";
import type { DeliveryDedupeStore } from "./dedupe.js";

/** Redis key 前缀，方便在 Redis CLI 中按命名空间筛选 */
const KEY_PREFIX = "dedupe:";

/**
 * 当 dedupeWindowMs 为 0 或未配置时，
 * 使用 60 秒作为默认去重窗口，避免 Redis 模式下去重意外关闭。
 */
const DEFAULT_DEDUP_WINDOW_MS = 60_000;

export interface RedisStoreConfig {
  redisUrl: string;
}

/**
 * Redis 版去重存储。
 * 利用 Redis SETEX + TTL 实现跨 Vercel 实例的共享去重状态。
 *
 * 与内存版的行为一致，按 per-user 粒度检查：
 *   Redis key:  dedupe:{sha256(body)}:{userId}
 *   Value:      "1"
 *   TTL:        dedupeWindowMs 转为秒
 *
 * Redis 不可达时 fail open —— 返回空列表（放行），只打 warn 日志。
 * 对价格预警来说，多发一条远好于漏收一条。
 */
export class RedisDeliveryDedupeStore implements DeliveryDedupeStore {
  private client: RedisClientType;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(config: RedisStoreConfig) {
    this.client = createClient({ url: config.redisUrl });
    // 捕获 Redis 连接/运行时错误，避免未处理的 error 事件导致进程退出
    this.client.on("error", (err) => {
      console.warn("[dedupe-redis] Redis client error:", err);
    });
  }

  /**
   * 确保 Redis 已连接。
   * 使用 connectPromise 缓存并发连接操作，防止多个去重请求同时触发多次 connect。
   */
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      try {
        await this.client.connect();
        this.connected = true;
      } catch (err) {
        console.warn(
          "[dedupe-redis] Failed to connect to Redis:",
          err instanceof Error ? err.message : String(err),
        );
        this.connected = false;
      }
    })();

    return this.connectPromise;
  }

  /**
   * 对每个 userId 检查对应的 Redis key 是否存在。
   * 若存在且未过期，说明该用户在窗口期内已收到相同内容，标记为重复。
   */
  async findDuplicateUserIds(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    nowMs?: number,
  ): Promise<string[]> {
    const windowMs =
      dedupeWindowMs > 0 ? dedupeWindowMs : DEFAULT_DEDUP_WINDOW_MS;

    if (windowMs <= 0 || userIds.length === 0) {
      return [];
    }

    try {
      await this.ensureConnected();
      if (!this.connected) {
        return [];
      }

      const results: string[] = [];
      for (const userId of userIds) {
        const key = buildRedisKey(dedupeKey, userId);
        const exists = await this.client.exists(key);
        if (exists === 1) {
          results.push(userId);
        }
      }
      return results;
    } catch (err) {
      console.warn(
        "[dedupe-redis] findDuplicateUserIds error:",
        err instanceof Error ? err.message : String(err),
      );
      // fail open: Redis 异常时不阻塞消息投递
      return [];
    }
  }

  /**
   * 对每个 userId 写入 Redis key，TTL 由 dedupeWindowMs 决定。
   * TTL 到期后 Redis 自动删除 key，该用户就可在下一轮中重新收到消息。
   */
  async rememberDeliveredUsers(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    deliveredAtMs?: number,
  ): Promise<void> {
    const windowMs =
      dedupeWindowMs > 0 ? dedupeWindowMs : DEFAULT_DEDUP_WINDOW_MS;
    const ttlSeconds = Math.ceil(windowMs / 1000);

    if (windowMs <= 0 || userIds.length === 0) {
      return;
    }

    try {
      await this.ensureConnected();
      if (!this.connected) {
        return;
      }

      for (const userId of userIds) {
        const key = buildRedisKey(dedupeKey, userId);
        await this.client.setEx(key, ttlSeconds, "1");
      }
    } catch (err) {
      console.warn(
        "[dedupe-redis] rememberDeliveredUsers error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** 断开 Redis 连接（实例切换或测试清理时调用） */
  close() {
    this.client.disconnect();
  }
}

/** 构造 Redis key：`dedupe:{sha256}:{userId}` */
function buildRedisKey(dedupeKey: string, userId: string): string {
  return `${KEY_PREFIX}${dedupeKey}:${userId}`;
}
