import { describe, expect, it, vi } from "vitest";

import {
  LarkClient,
  type PostMessageContent,
} from "../src/modules/lark/client.js";

const samplePost: PostMessageContent = {
  zh_cn: {
    title: "价格预警",
    content: [[{ tag: "text", text: "BTC/USDT 价格预警" }]],
  },
};

describe("LarkClient", () => {
  it("reuses the cached tenant access token across multiple messages", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant_token",
          expire: 7200,
        });
      }

      if (url.pathname === "/open-apis/im/v1/messages") {
        return jsonResponse({
          code: 0,
          msg: "ok",
          data: {
            message_id: "om_123",
          },
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const client = new LarkClient({
      baseUrl: "https://open.larksuite.com",
      appId: "cli_test",
      appSecret: "secret",
      userIdType: "open_id",
      timeoutMs: 10_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.sendPostMessage("ou_user_1", samplePost);
    await client.sendPostMessage("ou_user_1", samplePost);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "tenant_access_token/internal",
    );
  });

  it("passes the configured user_id_type to urgent_app", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant_token",
          expire: 7200,
        });
      }

      if (url.pathname === "/open-apis/im/v1/messages/om_456/urgent_app") {
        expect(url.searchParams.get("user_id_type")).toBe("union_id");
        return jsonResponse({
          code: 0,
          msg: "ok",
          data: {
            invalid_user_id_list: [],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const client = new LarkClient({
      baseUrl: "https://open.larksuite.com",
      appId: "cli_test",
      appSecret: "secret",
      userIdType: "union_id",
      timeoutMs: 10_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.sendUrgentApp("om_456", "ou_user_1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when Lark returns invalid urgent_app targets", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant_token",
          expire: 7200,
        });
      }

      if (url.pathname === "/open-apis/im/v1/messages/om_789/urgent_app") {
        return jsonResponse({
          code: 0,
          msg: "ok",
          data: {
            invalid_user_id_list: ["ou_bad"],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const client = new LarkClient({
      baseUrl: "https://open.larksuite.com",
      appId: "cli_test",
      appSecret: "secret",
      userIdType: "open_id",
      timeoutMs: 10_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(client.sendUrgentApp("om_789", "ou_user_1")).rejects.toThrow(
      "Invalid urgent_app targets",
    );
  });
});

function jsonResponse(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
