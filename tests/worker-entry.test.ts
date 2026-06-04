import { describe, expect, it, vi } from "vitest";

import { handleWorkerRequest, type WorkerEnv } from "../workers/index.js";

const workerEnv: WorkerEnv = {
  AICOIN_WEBHOOK_TOKEN: "secret-token",
  LARK_APP_ID: "cli_test",
  LARK_APP_SECRET: "secret",
  LARK_USER_ID_TYPE: "open_id",
  LARK_URGENT_USER_IDS: "ou_user_1,ou_user_2",
  LARK_BASE_URL: "https://open.larksuite.com",
  REQUEST_TIMEOUT_MS: "10000",
  LOG_LEVEL: "info",
  DEDUP_WINDOW_MS: "0",
};

describe("handleWorkerRequest", () => {
  it("handles GET /api/health", async () => {
    const handleHealthRequest = vi.fn(() => ({
      status: 200,
      body: {
        service: "aicoin-lark-webhook",
        status: "ok",
        timestamp: "2026-06-05T00:00:00.000Z",
      },
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }));

    const response = await handleWorkerRequest(
      new Request("https://example.com/api/health"),
      workerEnv,
      { handleHealthRequest },
    );

    expect(handleHealthRequest).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "aicoin-lark-webhook",
      status: "ok",
      timestamp: "2026-06-05T00:00:00.000Z",
    });
  });

  it("adapts POST /api/aicoin to the shared handler", async () => {
    const handleAicoinRequest = vi.fn(
      async (_request: unknown, _dependencies: unknown) => ({
        status: 200,
        body: {
          ok: true,
          status: "delivered",
        },
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }),
    );

    const response = await handleWorkerRequest(
      new Request(
        "https://example.com/api/aicoin?token=secret-token&user=one&user=two",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Test": "1",
          },
          body: '{"source":"AiCoin"}',
        },
      ),
      workerEnv,
      { handleAicoinRequest },
    );

    expect(handleAicoinRequest).toHaveBeenCalledTimes(1);
    const [requestArg, dependenciesArg] =
      handleAicoinRequest.mock.calls[0] ?? [];

    expect(requestArg).toEqual({
      method: "POST",
      query: {
        token: "secret-token",
        user: ["one", "two"],
      },
      headers: {
        "content-type": "application/json",
        "x-test": "1",
      },
      body: '{"source":"AiCoin"}',
    });
    expect(dependenciesArg).toEqual({
      configEnv: workerEnv,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "delivered",
    });
  });

  it("strips bodies from HEAD responses", async () => {
    const handleAicoinRequest = vi.fn(
      async (_request: unknown, _dependencies: unknown) => ({
        status: 200,
        body: {
          ok: true,
        },
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-test": "1",
        },
      }),
    );

    const response = await handleWorkerRequest(
      new Request("https://example.com/api/aicoin", {
        method: "HEAD",
      }),
      workerEnv,
      { handleAicoinRequest },
    );

    expect(handleAicoinRequest).toHaveBeenCalledTimes(1);
    const [, dependenciesArg] = handleAicoinRequest.mock.calls[0] ?? [];

    expect(dependenciesArg).toEqual({});
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("1");
    expect(await response.text()).toBe("");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await handleWorkerRequest(
      new Request("https://example.com/unknown"),
      workerEnv,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "not_found",
      message: "Route not found.",
    });
  });
});
