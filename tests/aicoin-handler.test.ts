import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { handleAicoinRequest } from "../src/handlers/aicoin.js";
import { createInMemoryDedupeStore } from "../src/modules/aicoin/dedupe.js";

const baseConfig: AppConfig = {
  aicoinWebhookToken: "secret-token",
  larkAppId: "cli_test",
  larkAppSecret: "secret",
  larkUserIdType: "open_id",
  larkUrgentUserIds: ["ou_user_1", "ou_user_2"],
  larkBaseUrl: "https://open.larksuite.com",
  requestTimeoutMs: 10_000,
  logLevel: "info",
  dedupeWindowMs: 0,
};

const validPayload = {
  source: "AiCoin",
  eventType: "price_alert",
  exchange: "Binance",
  symbol: "BTC/USDT",
  triggerCondition: {
    type: "Up to",
    threshold: "90000",
  },
  currentPrice: "91000",
  remark: "Breakout watch",
  timestamp: "2025-07-04T17:16:31Z",
};

describe("handleAicoinRequest", () => {
  it("returns a health payload for GET", async () => {
    const result = await handleAicoinRequest(
      { method: "GET" },
      { now: () => new Date("2026-06-04T00:00:00Z") },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      service: "aicoin-lark-webhook",
      status: "ok",
      timestamp: "2026-06-04T00:00:00.000Z",
    });
  });

  it("returns the same metadata payload for HEAD", async () => {
    const result = await handleAicoinRequest(
      { method: "HEAD" },
      { now: () => new Date("2026-06-04T00:00:00Z") },
    );

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
    });
    expect(result.body).toEqual({
      service: "aicoin-lark-webhook",
      status: "ok",
      timestamp: "2026-06-04T00:00:00.000Z",
    });
  });

  it("returns 401 when the token does not match", async () => {
    const result = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "wrong-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      { config: baseConfig },
    );

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: "unauthorized",
    });
  });

  it("returns 400 when the payload source is invalid", async () => {
    const result = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: {
          ...validPayload,
          source: "OtherSource",
        },
      },
      { config: baseConfig },
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: "invalid_source",
    });
  });

  it("delivers a valid POST to every configured target", async () => {
    const createLarkClient = vi.fn(() => ({}) as never);
    const notify = vi.fn(async () => [
      { userId: "ou_user_1", status: "delivered" as const, messageId: "om_1" },
      { userId: "ou_user_2", status: "delivered" as const, messageId: "om_2" },
    ]);

    const result = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(validPayload),
      },
      {
        config: baseConfig,
        createLarkClient,
        notifyPriceAlert: notify,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      status: "delivered",
    });
    expect(createLarkClient).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("returns duplicate on the second matching payload inside the dedupe window", async () => {
    const dedupeStore = createInMemoryDedupeStore();
    const notify = vi.fn(async () => [
      { userId: "ou_user_1", status: "delivered" as const, messageId: "om_1" },
    ]);
    const dedupeConfig: AppConfig = {
      ...baseConfig,
      dedupeWindowMs: 60_000,
      larkUrgentUserIds: ["ou_user_1"],
    };

    const firstResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:00Z"),
      },
    );

    const secondResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:30Z"),
      },
    );

    expect(firstResult.status).toBe(200);
    expect(secondResult.status).toBe(200);
    expect(secondResult.body).toMatchObject({
      ok: true,
      status: "duplicate",
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not mark an event as duplicate until delivery succeeds", async () => {
    const dedupeStore = createInMemoryDedupeStore();
    let attempt = 0;
    const notify = vi.fn(async () => {
      attempt += 1;

      if (attempt === 1) {
        return [
          {
            userId: "ou_user_1",
            status: "failed" as const,
            error: "Lark send message failed.",
          },
        ];
      }

      return [
        {
          userId: "ou_user_1",
          status: "delivered" as const,
          messageId: `om_${attempt}`,
        },
      ];
    });
    const dedupeConfig: AppConfig = {
      ...baseConfig,
      dedupeWindowMs: 60_000,
      larkUrgentUserIds: ["ou_user_1"],
    };

    const firstResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:00Z"),
      },
    );

    const secondResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:30Z"),
      },
    );

    const thirdResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:45Z"),
      },
    );

    expect(firstResult.status).toBe(502);
    expect(secondResult.status).toBe(200);
    expect(secondResult.body).toMatchObject({
      ok: true,
      status: "delivered",
    });
    expect(thirdResult.status).toBe(200);
    expect(thirdResult.body).toMatchObject({
      ok: true,
      status: "duplicate",
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("retries only the users that have not been delivered yet", async () => {
    const dedupeStore = createInMemoryDedupeStore();
    const dedupeConfig: AppConfig = {
      ...baseConfig,
      dedupeWindowMs: 60_000,
      larkUrgentUserIds: ["ou_user_1", "ou_user_2"],
    };
    const notify = vi.fn(async (args: { userIds: string[] }) => {
      if (args.userIds.length === 2) {
        return [
          {
            userId: "ou_user_1",
            status: "delivered" as const,
            messageId: "om_1",
          },
          {
            userId: "ou_user_2",
            status: "failed" as const,
            error: "Lark send message failed.",
          },
        ];
      }

      return [
        {
          userId: "ou_user_2",
          status: "delivered" as const,
          messageId: "om_2",
        },
      ];
    });

    const firstResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:00Z"),
      },
    );

    const secondResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:20Z"),
      },
    );

    const thirdResult = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: dedupeConfig,
        createLarkClient: () => ({}) as never,
        dedupeStore,
        notifyPriceAlert: notify,
        now: () => new Date("2026-06-04T00:00:40Z"),
      },
    );

    expect(firstResult.status).toBe(502);
    expect(secondResult.status).toBe(200);
    expect(secondResult.body).toMatchObject({
      ok: true,
      status: "delivered",
      duplicateUserIds: ["ou_user_1"],
    });
    expect(thirdResult.status).toBe(200);
    expect(thirdResult.body).toMatchObject({
      ok: true,
      status: "duplicate",
      duplicateUserIds: ["ou_user_1", "ou_user_2"],
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userIds: ["ou_user_2"],
      }),
    );
  });

  it("returns 502 when any downstream delivery fails", async () => {
    const result = await handleAicoinRequest(
      {
        method: "POST",
        query: { token: "secret-token" },
        headers: { "content-type": "application/json" },
        body: validPayload,
      },
      {
        config: baseConfig,
        createLarkClient: () => ({}) as never,
        notifyPriceAlert: async () => [
          { userId: "ou_user_1", status: "delivered", messageId: "om_1" },
          {
            userId: "ou_user_2",
            status: "failed",
            error: "Lark send message failed.",
          },
        ],
      },
    );

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      ok: false,
      error: "lark_delivery_failed",
    });
  });
});
