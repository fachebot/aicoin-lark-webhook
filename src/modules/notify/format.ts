import type { PostMessageContent, PostNode } from "../lark/client";
import type { PriceAlertEvent } from "../aicoin/types";

export function buildPriceAlertPost(
  event: PriceAlertEvent,
): PostMessageContent {
  const content: PostNode[][] = [
    [{ tag: "text", text: `${event.symbol} 价格预警`, style: ["bold"] }],
    [{ tag: "hr" }],
    buildLine("交易对：", event.symbol),
    buildLine("交易所：", event.exchange),
    buildLine("触发条件：", `${event.triggerTypeLabel} ${event.threshold}`),
    buildLine("当前价格：", event.currentPrice),
    buildLine("触发时间：", event.timestamp),
    buildLine("来源：", event.source),
  ];

  if (event.remark) {
    content.splice(5, 0, buildLine("备注：", event.remark));
  }

  return {
    zh_cn: {
      title: "价格预警",
      content,
    },
  };
}

function buildLine(label: string, value: string): PostNode[] {
  return [
    { tag: "text", text: label, style: ["bold"] },
    { tag: "text", text: value },
  ];
}
