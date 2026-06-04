export interface AicoinPriceAlertPayload {
  source: string;
  eventType: string;
  exchange: string;
  symbol: string;
  triggerCondition: {
    type: string;
    threshold: string;
  };
  currentPrice: string;
  remark?: string;
  timestamp: string;
}

export interface PriceAlertEvent {
  source: "AiCoin";
  eventType: "price_alert";
  exchange: string;
  symbol: string;
  triggerTypeRaw: string;
  triggerTypeLabel: string;
  threshold: string;
  currentPrice: string;
  remark?: string;
  timestamp: string;
  receivedAt: string;
  dedupeKey: string;
}
