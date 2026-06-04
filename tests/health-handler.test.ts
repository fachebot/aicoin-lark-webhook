import { describe, expect, it } from "vitest";

import { handleHealthRequest } from "../src/handlers/health";

describe("handleHealthRequest", () => {
  it("returns a health payload with the supplied timestamp", () => {
    const result = handleHealthRequest(new Date("2026-06-04T00:00:00Z"));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      service: "aicoin-lark-webhook",
      status: "ok",
      timestamp: "2026-06-04T00:00:00.000Z",
    });
  });
});
