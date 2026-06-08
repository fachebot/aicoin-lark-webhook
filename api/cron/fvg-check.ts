import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig, type AppConfig } from "../../src/config/env.js";
import { LarkClient } from "../../src/modules/lark/client.js";
import { fetchKlines } from "../../src/modules/binance/client.js";
import { detectFvgs } from "../../src/modules/binance/fvg.js";
import type { FvgResult } from "../../src/modules/binance/types.js";

const NOTIFIED_FVGS = new Set<string>();

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  const checkStartedAt = Date.now();
  const notified: FvgResult[] = [];

  try {
    const config = getConfig();

    for (const timeframe of ["5m", "15m"]) {
      const klines = await fetchKlines("BTCUSDT", timeframe, 5);
      const fvgs = detectFvgs(klines, timeframe, 60);

      for (const fvg of fvgs) {
        const key = `${fvg.timeframe}|${fvg.candle1OpenTime}|${fvg.direction}`;
        if (NOTIFIED_FVGS.has(key)) continue;
        NOTIFIED_FVGS.add(key);

        await notifyFvg(config, fvg);
        notified.push(fvg);
      }
    }

    res.status(200).json({
      ok: true,
      checkStartedAt,
      notifiedCount: notified.length,
      notified: notified.map((f) => ({
        timeframe: f.timeframe,
        direction: f.direction,
        gapSize: f.gapSize,
      })),
    });
  } catch (error) {
    console.error("[fvg-check]", error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyFvg(config: AppConfig, fvg: FvgResult): Promise<void> {
  const label = fvg.direction === "bullish" ? "\uD83D\uDFE2 看涨" : "\uD83D\uDD34 看跌";

  const text = [
    label + " BTC/USDT " + fvg.timeframe + " FVG",
    "",
    "\u7F3A\u53E3\u5927\u5C0F: " + fvg.gapSize + " USDT",
    "\u4EF7\u4F4D\u533A\u95F4: " + fvg.gapLow + " - " + fvg.gapHigh,
    "\u53D1\u73B0\u65F6\u95F4: " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
  ].join("\n");

  const client = new LarkClient({
    baseUrl: config.larkBaseUrl,
    appId: config.larkAppId,
    appSecret: config.larkAppSecret,
    userIdType: config.larkUserIdType,
    timeoutMs: config.requestTimeoutMs,
  });

  for (const userId of config.larkUrgentUserIds) {
    try {
      const messageId = await client.sendTextMessage(userId, text);
      await client.sendUrgentApp(messageId, userId);
    } catch (err) {
      console.error("[fvg-check] notify failed for", userId, err);
    }
  }
}
