import type { LarkUserIdType } from "../../config/env";
import { LarkAPIError } from "../../shared/errors";

export interface PostNode {
  tag: string;
  text?: string;
  href?: string;
  style?: string[];
}

export interface PostMessageContent {
  zh_cn: {
    title?: string;
    content: PostNode[][];
  };
}

interface TokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface SendMessageResponse {
  code: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

interface UrgentAppResponse {
  code: number;
  msg?: string;
  data?: {
    invalid_user_id_list?: string[];
  };
}

export interface LarkClientOptions {
  baseUrl: string;
  appId: string;
  appSecret: string;
  userIdType: LarkUserIdType;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class LarkClient {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly userIdType: LarkUserIdType;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private tenantAccessToken?: string;
  private tenantAccessTokenExpiresAt = 0;

  constructor(options: LarkClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.userIdType = options.userIdType;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendPostMessage(
    receiveUserId: string,
    content: PostMessageContent,
  ): Promise<string> {
    return this.sendMessage(receiveUserId, "post", content);
  }

  async sendTextMessage(receiveUserId: string, text: string): Promise<string> {
    return this.sendMessage(receiveUserId, "text", { text });
  }

  async sendUrgentApp(messageId: string, receiveUserId: string): Promise<void> {
    if (!messageId.trim()) {
      throw new LarkAPIError("urgent_app", "messageId must not be empty.");
    }

    const token = await this.getTenantAccessToken();
    const response = await this.requestJSON<UrgentAppResponse>(
      "urgent_app",
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/urgent_app`,
      {
        method: "PATCH",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          user_id_list: [receiveUserId],
        }),
      },
      {
        user_id_type: this.userIdType,
      },
    );

    if (response.code !== 0) {
      throw new LarkAPIError(
        "urgent_app",
        response.msg ?? "Lark urgent_app request failed.",
      );
    }

    if ((response.data?.invalid_user_id_list?.length ?? 0) > 0) {
      throw new LarkAPIError(
        "urgent_app",
        `Invalid urgent_app targets: ${response.data?.invalid_user_id_list?.join(", ")}`,
      );
    }
  }

  private async sendMessage(
    receiveUserId: string,
    messageType: string,
    content: unknown,
  ): Promise<string> {
    const token = await this.getTenantAccessToken();
    const response = await this.requestJSON<SendMessageResponse>(
      "send_message",
      "/open-apis/im/v1/messages",
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          receive_id: receiveUserId,
          msg_type: messageType,
          content: JSON.stringify(content),
        }),
      },
      {
        receive_id_type: this.userIdType,
      },
    );

    if (response.code !== 0) {
      throw new LarkAPIError(
        "send_message",
        response.msg ?? "Lark send message request failed.",
      );
    }

    const messageId = response.data?.message_id?.trim();
    if (!messageId) {
      throw new LarkAPIError(
        "send_message",
        "Lark send message response did not include message_id.",
      );
    }
    return messageId;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (
      this.tenantAccessToken &&
      Date.now() < this.tenantAccessTokenExpiresAt - 60_000
    ) {
      return this.tenantAccessToken;
    }

    const response = await this.requestJSON<TokenResponse>(
      "tenant_access_token",
      "/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    if (response.code !== 0) {
      throw new LarkAPIError(
        "tenant_access_token",
        response.msg ?? "Failed to fetch tenant_access_token.",
      );
    }

    const token = response.tenant_access_token?.trim();
    if (!token) {
      throw new LarkAPIError(
        "tenant_access_token",
        "Lark did not return tenant_access_token.",
      );
    }

    const expiresInMs = Math.max((response.expire ?? 3600) * 1000, 60_000);
    this.tenantAccessToken = token;
    this.tenantAccessTokenExpiresAt = Date.now() + expiresInMs;
    return token;
  }

  private buildHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return headers;
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async requestJSON<T>(
    stage: string,
    path: string,
    init: RequestInit,
    query?: Record<string, string>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(path, query), {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LarkAPIError(
        stage,
        error instanceof Error ? error.message : String(error),
      );
    }

    const responseText = await response.text();
    let parsedBody: T;
    try {
      parsedBody = JSON.parse(responseText) as T;
    } catch {
      throw new LarkAPIError(
        stage,
        "Lark returned a non-JSON response.",
        response.status,
        responseText,
      );
    }

    if (!response.ok) {
      throw new LarkAPIError(
        stage,
        `Lark request failed with status ${response.status}.`,
        response.status,
        parsedBody,
      );
    }
    return parsedBody;
  }
}
