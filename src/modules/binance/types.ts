export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface FvgResult {
  timeframe: string;
  direction: "bullish" | "bearish";
  gapSize: number;
  gapHigh: number;
  gapLow: number;
  candle1OpenTime: number;
  candle3CloseTime: number;
}
