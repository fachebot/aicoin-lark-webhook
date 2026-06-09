import { createHash, type BinaryLike } from "node:crypto";
import type {
  RedisStoreConfig,
} from "./dedupe-redis.js";
import { RedisDeliveryDedupeStore } from "./dedupe-redis.js";

/**
 * 交付去重存储接口。
 * findDuplicateUserIds 返回已送达过的用户列表（在窗口期内），
 * rememberDeliveredUsers 记录本次成功交付的用户。
 *
 * 设计上按 per-user 粒度去重，而非整条消息原子去重：
 * 允许多次重试时只补发失败用户，不重复打扰已收到的用户。
 */
export interface DeliveryDedupeStore {
  /** 查询哪些用户在窗口期内已经收到过相同内容 */
  findDuplicateUserIds(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    nowMs?: number,
  ): Promise<string[]>;

  /** 记录本次已成功交付的用户，供后续请求去重 */
  rememberDeliveredUsers(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    deliveredAtMs?: number,
  ): Promise<void>;

  /** 清理存储（测试用，或实例切换前调用） */
  close(): void;
}

/**
 * 对任意输入计算 SHA-256 十六进制摘要。
 * 用于将请求 body 统一映射为定长去重键，避免原始 body 过长或含不可见字符。
 */
export function sha256(input: BinaryLike): string {
  return createHash("sha256").update(input).digest("hex");
}

let defaultStore: DeliveryDedupeStore | undefined;

/**
 * 获取（或惰性创建）全局单例去重存储。
 * 环境变量 REDIS_URL 不为空 → 返回 Redis 实现；否则返回内存实现。
 * 切换存储类型时会自动关闭旧实例，避免连接泄漏。
 */
export function getDedupeStore(): DeliveryDedupeStore {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl && redisUrl.trim().length > 0) {
    if (!defaultStore || !(defaultStore instanceof RedisDeliveryDedupeStore)) {
      defaultStore?.close();
      defaultStore = new RedisDeliveryDedupeStore({ redisUrl });
    }
    return defaultStore;
  }

  if (!defaultStore || defaultStore instanceof RedisDeliveryDedupeStore) {
    defaultStore?.close();
    defaultStore = new InMemoryDeliveryDedupeStore();
  }
  return defaultStore;
}

/** 创建独立的内存去重实例（测试用） */
export function createInMemoryDedupeStore(): DeliveryDedupeStore {
  return new InMemoryDeliveryDedupeStore();
}

/** 创建独立的 Redis 去重实例（测试用） */
export function createRedisDedupeStore(
  config: RedisStoreConfig,
): DeliveryDedupeStore {
  return new RedisDeliveryDedupeStore(config);
}

/** 重置全局去重实例缓存（测试用） */
export function resetDedupeStoreCache() {
  defaultStore?.close();
  defaultStore = undefined;
}

/** resetDedupeStoreCache 的别名 */
export function resetDedupeCache() {
  resetDedupeStoreCache();
}

/**
 * 内存版去重存储。
 * 基于 Map，key 为 `${dedupeKey}:${userId}`，value 为送达时间戳。
 * 每次查询前会惰性裁剪过期条目，避免内存无限增长。
 * 仅在单进程无状态场景（如 Vercel 单实例）下有效。
 */
class InMemoryDeliveryDedupeStore implements DeliveryDedupeStore {
  private readonly deliveries = new Map<string, number>();

  async findDuplicateUserIds(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    nowMs: number = Date.now(),
  ): Promise<string[]> {
    if (dedupeWindowMs <= 0 || userIds.length === 0) {
      return [];
    }

    const cutoffMs = nowMs - dedupeWindowMs;
    this.pruneExpiredEntries(cutoffMs);

    return userIds.filter((userId) => {
      const deliveredAtMs = this.deliveries.get(
        buildEventUserKey(dedupeKey, userId),
      );
      return deliveredAtMs !== undefined && deliveredAtMs > cutoffMs;
    });
  }

  async rememberDeliveredUsers(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    deliveredAtMs: number = Date.now(),
  ): Promise<void> {
    if (dedupeWindowMs <= 0 || userIds.length === 0) {
      return;
    }

    this.pruneExpiredEntries(deliveredAtMs - dedupeWindowMs);

    for (const userId of userIds) {
      this.deliveries.set(buildEventUserKey(dedupeKey, userId), deliveredAtMs);
    }
  }

  close() {
    this.deliveries.clear();
  }

  /** 清理窗口外的过期记录，防止内存膨胀 */
  private pruneExpiredEntries(cutoffMs: number) {
    for (const [eventUserKey, deliveredAtMs] of this.deliveries.entries()) {
      if (deliveredAtMs <= cutoffMs) {
        this.deliveries.delete(eventUserKey);
      }
    }
  }
}

/** 构造 Map 内部 key：`dedupeKey:userId` */
function buildEventUserKey(dedupeKey: string, userId: string) {
  return `${dedupeKey}:${userId}`;
}
