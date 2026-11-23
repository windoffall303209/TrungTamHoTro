import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumPost, ForumTopic } from "@/lib/learning-types";
import ForumPage from "../../../../../src/app/(workspace)/forum/page";

const { apiMock, notifyMock, searchParams } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  notifyMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { roleCode: "INSTRUCTOR", user: { id: "user-1", name: "Teacher" } },
    notify: notifyMock,
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value, locale: "vi-VN" }),
}));
vi.mock("@/features/materials/material-search", () => ({ useMaterialSearch: () => ({ items: [] }) }));

const topics: ForumTopic[] = ["a", "b"].map((id) => ({
  id, classId: "class-1", title: `Topic ${id.toUpperCase()}`, body: `Body ${id}`,
  authorId: "user-1", tags: [], isPinned: false, isLocked: false,
  status: "VISIBLE", createdAt: "2026-10-30T00:00:00.000Z",
}));

// Tạo phản hồi bình luận đủ dữ liệu để kiểm tra chủ đề đang hiển thị.
function makePost(topicId: string): ForumPost {
  return {
    id: `post-${topicId}`, topicId, authorId: "user-2", body: `Comment ${topicId.toUpperCase()}`,
    status: "VISIBLE", attachmentIds: [], mentionedUserIds: [], createdAt: "2026-10-30T00:00:00.000Z",
  };
}

describe("ForumPage topic request lifecycle", () => {
  let resolveA!: (value: ForumPost[]) => void;
  let rejectA!: (reason: Error) => void;
  let resolveB!: (value: ForumPost[]) => void;

  beforeEach(() => {
    window.localStorage.removeItem("wind_edu_forum_likes");
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/forum/topics/page?")) {
        return Promise.resolve({ items: topics, total: topics.length, page: 1, pageSize: 10, totalPages: 1 });
      }
      if (path === "/classes") return Promise.resolve([]);
      if (path.startsWith("/forum/topics/a/posts/page?")) return new Promise<ForumPost[]>((resolve, reject) => {
        resolveA = resolve;
        rejectA = reject;
      });
      if (path.startsWith("/forum/topics/b/posts/page?")) return new Promise<ForumPost[]>((resolve) => { resolveB = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ignores a late response from a previous topic", async () => {
    render(<ForumPage />);
    fireEvent.click(await screen.findByText("Topic A"));
    fireEvent.click(screen.getByRole("button", { name: "Quay lại danh sách bài viết" }));
    fireEvent.click(screen.getByText("Topic B"));

    await act(async () => { resolveB([makePost("b")]); });
    expect(screen.getByText("Comment B")).toBeInTheDocument();

    await act(async () => { resolveA([makePost("a")]); });
    expect(screen.getByText("Comment B")).toBeInTheDocument();
    expect(screen.queryByText("Comment A")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores a late response after returning to the feed", async () => {
    render(<ForumPage />);
    fireEvent.click(await screen.findByText("Topic A"));
    fireEvent.click(screen.getByRole("button", { name: "Quay lại danh sách bài viết" }));

    await act(async () => { resolveA([makePost("a")]); });
    expect(screen.queryByText("Comment A")).not.toBeInTheDocument();
    expect(screen.getByText("Topic A")).toBeInTheDocument();
    await waitFor(() => expect(notifyMock).not.toHaveBeenCalled());
  });

  it("does not show an error from a topic that is no longer selected", async () => {
    render(<ForumPage />);
    fireEvent.click(await screen.findByText("Topic A"));
    fireEvent.click(screen.getByRole("button", { name: "Quay lại danh sách bài viết" }));
    fireEvent.click(screen.getByText("Topic B"));

    await act(async () => { resolveB([makePost("b")]); });
    await act(async () => { rejectA(new Error("Old topic request failed")); });

    expect(screen.getByText("Comment B")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("không hiển thị số lượt thích bịa từ tiêu đề hay dữ liệu trình duyệt", async () => {
    window.localStorage.setItem("wind_edu_forum_likes", '["a"]');
    render(<ForumPage />);
    fireEvent.click(await screen.findByText("Topic A"));
    await act(async () => { resolveA([makePost("a")]); });
    expect(screen.queryByText(/Thích \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Đã thích/)).not.toBeInTheDocument();
  });

  it("chuyển trang danh sách chủ đề và phân trang bình luận gốc từ API", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve([]);
      if (path.startsWith("/forum/topics/page?")) {
        const page = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
        const slice = page === 2 ? [{ ...topics[1]!, title: "Topic Page 2" }] : [{ ...topics[0]!, title: "Topic Page 1" }];
        return Promise.resolve({ items: slice, total: 12, page, pageSize: 10, totalPages: 2 });
      }
      if (path.startsWith("/forum/topics/a/posts/page?")) {
        const page = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
        return Promise.resolve({
          items: [{ ...makePost("a"), id: `post-page-${page}`, body: `Comment Page ${page}` }],
          total: 20,
          totalPosts: 20,
          page,
          pageSize: 15,
          totalPages: 2,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<ForumPage />);
    await screen.findByText("Topic Page 1");
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("Topic Page 2");
    fireEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    fireEvent.click(await screen.findByText("Topic Page 1"));
    await screen.findByText("Comment Page 1");
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("Comment Page 2");
  });
});
