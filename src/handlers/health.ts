import { jsonResult } from "../shared/http";

export function handleHealthRequest(now: Date = new Date()) {
  return jsonResult(200, {
    service: "aicoin-lark-webhook",
    status: "ok",
    timestamp: now.toISOString(),
  });
}
