import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadClassFeedPosts, saveClassFeedPosts } from "../../../../src/features/class-feed/class-feed-storage";

describe("Class feed persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("initializes only classes that have never stored posts", () => {
    const first = loadClassFeedPosts("class-a", "Class A", "Teacher A");
    expect(first).toHaveLength(2);
    expect(loadClassFeedPosts("class-a")).toEqual(first);
    expect(localStorage.getItem("class_feed_posts_class-b")).toBeNull();
  });

  it("preserves an intentionally empty feed after deleting all posts and reloading", () => {
    loadClassFeedPosts("class-a");
    saveClassFeedPosts("class-a", []);
    expect(loadClassFeedPosts("class-a")).toEqual([]);
    expect(localStorage.getItem("class_feed_posts_class-a")).toBe("[]");
  });

  it("keeps each class's posts independent", () => {
    const originalPosts = loadClassFeedPosts("class-a");
    saveClassFeedPosts("class-b", []);
    expect(loadClassFeedPosts("class-a")).toEqual(originalPosts);
    expect(loadClassFeedPosts("class-b")).toEqual([]);
  });

  it("recovers from malformed stored posts instead of crashing the feed", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem("class_feed_posts_class-a", JSON.stringify([null, { id: "broken" }]));
    const recovered = loadClassFeedPosts("class-a");
    expect(recovered).toHaveLength(2);
    expect(loadClassFeedPosts("class-a")).toEqual(recovered);
    expect(log).toHaveBeenCalledOnce();
  });

  it("recovers from malformed nested comments", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const posts = loadClassFeedPosts("class-a");
    localStorage.setItem("class_feed_posts_class-a", JSON.stringify([{ ...posts[0], comments: [null] }]));
    expect(loadClassFeedPosts("class-a")).toEqual(posts);
  });

  it("reports a failed write instead of claiming the posts were persisted", () => {
    const originalPosts = loadClassFeedPosts("class-a");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(saveClassFeedPosts("class-a", [])).toBe(false);
    expect(localStorage.getItem("class_feed_posts_class-a")).toBe(JSON.stringify(originalPosts));
  });
});
