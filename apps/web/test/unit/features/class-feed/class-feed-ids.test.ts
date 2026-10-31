import { describe, expect, it, vi } from "vitest";
import { createClassFeedId } from "../../../../src/features/class-feed/class-feed-ids";

describe("Class feed identifiers", () => {
  it("generates distinct IDs for rapid posts, comments and replies", () => {
    const timestamp = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const ids = Array.from({ length: 1000 }, (_, index) =>
        createClassFeedId(index % 3 === 0 ? "post" : index % 3 === 1 ? "cmt" : "reply"),
      );
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toMatch(/^post-/);
      expect(ids[1]).toMatch(/^cmt-/);
      expect(ids[2]).toMatch(/^reply-/);
    } finally {
      timestamp.mockRestore();
    }
  });
});
