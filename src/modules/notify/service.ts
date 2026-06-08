import type { PriceAlertEvent } from "../aicoin/types.js";
import { buildPriceAlertPost } from "./format.js";
import type { LarkClient } from "../lark/client.js";

export interface DeliveryResult {
  userId: string;
  status: "delivered" | "failed";
  messageId?: string;
  error?: string;
}

export interface NotifyPriceAlertArgs {
  client: LarkClient;
  userIds: string[];
  event: PriceAlertEvent;
}

export async function notifyPriceAlert(
  args: NotifyPriceAlertArgs,
): Promise<DeliveryResult[]> {
  const isTextAlert = args.event.triggerTypeRaw === "text";
  const results: DeliveryResult[] = [];

  for (const userId of args.userIds) {
    try {
      let messageId: string;
      if (isTextAlert) {
        messageId = await args.client.sendTextMessage(userId, args.event.remark ?? args.event.symbol);
      } else {
        const post = buildPriceAlertPost(args.event);
        messageId = await args.client.sendPostMessage(userId, post);
      }
      await args.client.sendUrgentApp(messageId, userId);
      results.push({
        userId,
        status: "delivered",
        messageId,
      });
    } catch (error) {
      results.push({
        userId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function hasDeliveryFailures(results: DeliveryResult[]): boolean {
  return results.some((result) => result.status === "failed");
}
