export interface DeliveryDedupeStore {
  findDuplicateUserIds(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    nowMs?: number,
  ): string[];
  rememberDeliveredUsers(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    deliveredAtMs?: number,
  ): void;
  close(): void;
}

let defaultStore: InMemoryDeliveryDedupeStore | undefined;

export function getDedupeStore(): DeliveryDedupeStore {
  if (!defaultStore) {
    defaultStore = new InMemoryDeliveryDedupeStore();
  }

  return defaultStore;
}

export function createInMemoryDedupeStore(): DeliveryDedupeStore {
  return new InMemoryDeliveryDedupeStore();
}

export function resetDedupeStoreCache() {
  defaultStore?.close();
  defaultStore = undefined;
}

export function resetDedupeCache() {
  resetDedupeStoreCache();
}

class InMemoryDeliveryDedupeStore implements DeliveryDedupeStore {
  private readonly deliveries = new Map<string, number>();

  findDuplicateUserIds(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    nowMs: number = Date.now(),
  ): string[] {
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

  rememberDeliveredUsers(
    dedupeKey: string,
    userIds: string[],
    dedupeWindowMs: number,
    deliveredAtMs: number = Date.now(),
  ): void {
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

  private pruneExpiredEntries(cutoffMs: number) {
    for (const [eventUserKey, deliveredAtMs] of this.deliveries.entries()) {
      if (deliveredAtMs <= cutoffMs) {
        this.deliveries.delete(eventUserKey);
      }
    }
  }
}

function buildEventUserKey(dedupeKey: string, userId: string) {
  return `${dedupeKey}:${userId}`;
}
