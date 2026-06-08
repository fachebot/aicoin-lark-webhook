import type { Kline, FvgResult } from "./types.js";

export function detectFvgs(
  klines: Kline[],
  timeframe: string,
  minGap: number = 60,
): FvgResult[] {
  const results: FvgResult[] = [];

  for (let i = 0; i <= klines.length - 3; i++) {
    const c1 = klines[i];
    const c2 = klines[i + 1];
    const c3 = klines[i + 2];

    const gapHigh = Math.min(c1.high, c3.low);
    const gapLow = Math.max(c1.high, c3.low);

    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high;
      if (gapSize >= minGap) {
        results.push({
          timeframe,
          direction: "bullish",
          gapSize: Math.round(gapSize * 100) / 100,
          gapHigh: Math.round(c3.low * 100) / 100,
          gapLow: Math.round(c1.high * 100) / 100,
          candle1OpenTime: c1.openTime,
          candle3CloseTime: c3.closeTime,
        });
      }
    }

    if (c3.high < c1.low) {
      const gapSize = c1.low - c3.high;
      if (gapSize >= minGap) {
        results.push({
          timeframe,
          direction: "bearish",
          gapSize: Math.round(gapSize * 100) / 100,
          gapHigh: Math.round(c1.low * 100) / 100,
          gapLow: Math.round(c3.high * 100) / 100,
          candle1OpenTime: c1.openTime,
          candle3CloseTime: c3.closeTime,
        });
      }
    }
  }

  return results;
}
