import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForumTopic } from "@/lib/learning-types";
import { filterForumTopics, formatAuthorName, formatRelativeTime, getAvatarPalette, getInitials } from "../../../../../src/app/(workspace)/forum/forum-helpers";

const topics: ForumTopic[] = [
  { id: "one", classId: "class-1", authorId: "me", title: "Lịch học", body: "Thông báo", tags: ["Quan trọng"], isPinned: true, isLocked: false, status: "VISIBLE", createdAt: "2026-10-31T00:00:00Z" },
  { id: "two", classId: "class-2", authorId: "other", title: "Thảo luận", body: "Nội dung nâng cao", tags: ["Kỹ thuật"], isPinned: false, isLocked: false, status: "VISIBLE", createdAt: "2026-10-31T00:00:00Z" },
  { id: "three", classId: "class-1", authorId: "other", title: "Bài tập", body: "Nội dung bổ sung", tags: ["Tài liệu"], isPinned: true, isLocked: false, status: "VISIBLE", createdAt: "2026-10-31T00:00:00Z" },
];

describe("forum display helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("returns stable avatar colors for the same user", () => {
    expect(getAvatarPalette("user-1")).toBe(getAvatarPalette("user-1"));
    expect(getAvatarPalette("")).toBe("bg-sky-500 text-white");
    expect(getAvatarPalette("user-2")).toMatch(/^bg-.* text-white$/);
  });

  it("extracts initials from names and identifiers", () => {
    expect(getInitials("Ada Lovelace")).toBe("AL");
    expect(getInitials("user-123")).toBe("U1");
    expect(getInitials("Học viên")).toBe("HV");
    expect(getInitials("")).toBe("?");
  });

  it("formats current-user, prefixed and raw author IDs", () => {
    expect(formatAuthorName("me", "me", "Giáo viên")).toBe("Giáo viên (Bạn)");
    expect(formatAuthorName("usr-nguyen_van_a", "me", "Giáo viên")).toBe("Nguyen van a");
    expect(formatAuthorName("teacher-42", "me", "Giáo viên")).toBe("teacher-42");
  });

  it("preserves Vietnamese and English relative-time thresholds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    expect(formatRelativeTime("2026-10-31T09:59:30Z", false)).toBe("Vừa xong");
    expect(formatRelativeTime("2026-10-31T09:58:00Z", true)).toBe("2m ago");
    expect(formatRelativeTime("2026-10-31T08:00:00Z", false)).toBe("2 giờ trước");
    expect(formatRelativeTime("2026-10-29T10:00:00Z", true)).toBe("2d ago");
    expect(formatRelativeTime("2025-10-31T10:00:00Z", true)).toContain("2025");
  });

  it("filters by class, pinned, and owned topics without mutating the input", () => {
    expect(filterForumTopics(topics, "class-1", "all", "", "me").map((topic) => topic.id)).toEqual(["one", "three"]);
    expect(filterForumTopics(topics, "", "pinned", "", "me").map((topic) => topic.id)).toEqual(["one", "three"]);
    expect(filterForumTopics(topics, "", "mine", "", "me").map((topic) => topic.id)).toEqual(["one"]);
    expect(topics.map((topic) => topic.id)).toEqual(["one", "two", "three"]);
  });

  it("matches case-insensitive title, body, and tags while trimming the search", () => {
    expect(filterForumTopics(topics, "", "all", "  LỊCH ", "me").map((topic) => topic.id)).toEqual(["one"]);
    expect(filterForumTopics(topics, "", "all", "nâng cao", "me").map((topic) => topic.id)).toEqual(["two"]);
    expect(filterForumTopics(topics, "class-1", "pinned", "TÀI LIỆU", "me").map((topic) => topic.id)).toEqual(["three"]);
    expect(filterForumTopics(topics, "", "all", "không có", "me")).toEqual([]);
  });
});
