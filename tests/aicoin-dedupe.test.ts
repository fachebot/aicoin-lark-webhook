import { describe, expect, it } from "vitest";

import { createInMemoryDedupeStore } from "../src/modules/aicoin/dedupe.js";

describe("In-memory delivery dedupe store", () => {
  it("marks only delivered users as duplicates", () => {
    const store = createInMemoryDedupeStore();

    store.rememberDeliveredUsers("event-1", ["ou_user_1"], 60_000, 1_000);

    expect(
      store.findDuplicateUserIds(
        "event-1",
        ["ou_user_1", "ou_user_2"],
        60_000,
        30_000,
      ),
    ).toEqual(["ou_user_1"]);
  });

  it("lets keys expire after the dedupe window elapses", () => {
    const store = createInMemoryDedupeStore();

    store.rememberDeliveredUsers("event-1", ["ou_user_1"], 60_000, 1_000);

    expect(
      store.findDuplicateUserIds("event-1", ["ou_user_1"], 60_000, 61_001),
    ).toEqual([]);
  });
});
