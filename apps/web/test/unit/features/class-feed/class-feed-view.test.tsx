import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassFeedView } from "../../../../src/features/class-feed/class-feed-view";
import type { ClassFeedPost } from "../../../../src/features/class-feed/class-feed-types";

const { apiRequest, downloadApiFile, previewApiFile, notify, session } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
  notify: vi.fn(),
  session: {
    current: {
      roleCode: "LEARNER" as "LEARNER" | "INSTRUCTOR" | "CENTER_MANAGER" | "SYSTEM_ADMIN",
      user: { id: "learner-1", name: "Học viên A", username: "learner_a", avatarUrl: null },
    },
  },
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  downloadApiFile: (...args: unknown[]) => downloadApiFile(...args),
  previewApiFile: (...args: unknown[]) => previewApiFile(...args),
  publicApiUrl: (path: string) => `http://localhost:4000/api/v1${path}`,
}));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: session.current, notify }) }));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }) }));

/** Tạo dữ liệu bài viết bảng tin chuẩn từ máy chủ phục vụ kiểm thử đơn vị. */
function makeFeedPost(overrides: Partial<ClassFeedPost> = {}): ClassFeedPost {
  return {
    id: "feed-post-1",
    classId: "class-a",
    classCode: "TOAN-10A1",
    authorId: "teacher-1",
    authorName: "Teacher A",
    authorAvatarUrl: null,
    authorRole: "INSTRUCTOR",
    content: "Bài tập tuần này đã mở trên hệ thống.",
    attachments: [],
    likes: 2,
    isLiked: false,
    isEdited: false,
    isHidden: false,
    isFollowing: false,
    canEdit: false,
    canDelete: false,
    editHistories: [],
    comments: [
      {
        id: "cmt-1",
        postId: "feed-post-1",
        parentId: null,
        authorId: "learner-2",
        authorName: "Bạn B",
        authorAvatarUrl: null,
        authorRole: "LEARNER",
        replyToUserId: null,
        replyToName: null,
        content: "Thầy ơi hạn nộp là thứ mấy ạ?",
        likes: 1,
        isLiked: false,
        isEdited: false,
        canDelete: false,
        createdAt: "2026-11-26T08:00:00.000Z",
        replies: [],
      },
    ],
    createdAt: "2026-11-26T07:00:00.000Z",
    updatedAt: "2026-11-26T07:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  session.current = {
    roleCode: "LEARNER",
    user: { id: "learner-1", name: "Học viên A", username: "learner_a", avatarUrl: null },
  };
});

describe("ClassFeedView", () => {
  it("đọc bảng tin thật từ PostgreSQL, không chèn bài mẫu hay đọc localStorage", async () => {
    localStorage.setItem("class_feed_posts_class-a", JSON.stringify([{ id: "fake" }]));
    apiRequest.mockResolvedValueOnce([makeFeedPost()]);

    render(<ClassFeedView classItem={{ id: "class-a", code: "TOAN-10A1", name: "Toán 10A1" }} />);

    expect(await screen.findByText("Bài tập tuần này đã mở trên hệ thống.")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/classes/class-a/feed", { roleCode: "LEARNER" });
    expect(screen.queryByText(/REST hay GraphQL/)).not.toBeInTheDocument();
  });

  it("học viên cũng đăng được bài kèm tệp đính kèm qua FormData và chỉ cập nhật sau khi máy chủ lưu", async () => {
    const createdPost = makeFeedPost({
      id: "feed-post-2",
      authorId: "learner-1",
      authorName: "Học viên A",
      authorRole: "LEARNER",
      content: "Em gửi tài liệu ôn tập ạ",
      attachments: [
        {
          id: "att-1",
          originalName: "de-cuong.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          createdAt: "2026-11-26T09:00:00.000Z",
          isImage: false,
          canPreview: true,
        },
      ],
      likes: 0,
      comments: [],
      canEdit: true,
      canDelete: true,
    });
    apiRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(createdPost);

    render(<ClassFeedView classItem={{ id: "class-a", code: "TOAN-10A1", name: "Toán 10A1" }} />);
    expect(await screen.findByText("Chưa có bài đăng nào trong lớp học này")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nội dung bài viết bảng tin"), {
      target: { value: "Em gửi tài liệu ôn tập ạ" },
    });
    const pdfFile = new File(["%PDF-1.4\nhello"], "de-cuong.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Chọn tệp đính kèm"), {
      target: { files: [pdfFile] },
    });
    expect(screen.getByText("de-cuong.pdf")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Đăng bài" }));
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "/classes/class-a/feed/posts",
      expect.objectContaining({ method: "POST", roleCode: "LEARNER", body: expect.any(FormData) }),
    );
    const postedBody = apiRequest.mock.calls[1]?.[1]?.body as FormData;
    expect(postedBody.get("content")).toBe("Em gửi tài liệu ôn tập ạ");
    expect(postedBody.getAll("files")).toHaveLength(1);
    expect(await screen.findByText("Em gửi tài liệu ôn tập ạ")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("Đã đăng bài viết mới lên bảng tin!", "success");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tải xuống" }));
    });
    expect(downloadApiFile).toHaveBeenCalledWith(
      "/classes/class-a/feed/posts/feed-post-2/attachments/att-1",
      "LEARNER",
    );
  });

  it("hỗ trợ thích bài viết, bình luận cấp 1, phản hồi cấp 2 và thích bình luận qua API", async () => {
    apiRequest
      .mockResolvedValueOnce([makeFeedPost()])
      .mockResolvedValueOnce({ id: "feed-post-1", likes: 3, isLiked: true })
      .mockResolvedValueOnce({
        id: "cmt-2",
        postId: "feed-post-1",
        parentId: null,
        authorId: "learner-1",
        authorName: "Học viên A",
        authorAvatarUrl: null,
        authorRole: "LEARNER",
        replyToUserId: null,
        replyToName: null,
        content: "Cảm ơn thầy ạ!",
        likes: 0,
        isLiked: false,
        isEdited: false,
        canDelete: true,
        createdAt: "2026-11-26T09:05:00.000Z",
        replies: [],
      })
      .mockResolvedValueOnce({
        id: "reply-1",
        postId: "feed-post-1",
        parentId: "cmt-1",
        authorId: "learner-1",
        authorName: "Học viên A",
        authorAvatarUrl: null,
        authorRole: "LEARNER",
        replyToUserId: "learner-2",
        replyToName: "Bạn B",
        content: "Hạn nộp tối thứ Sáu bạn nhé",
        likes: 0,
        isLiked: false,
        isEdited: false,
        canDelete: true,
        createdAt: "2026-11-26T09:06:00.000Z",
      })
      .mockResolvedValueOnce({ id: "reply-1", likes: 1, isLiked: true });

    render(<ClassFeedView classItem={{ id: "class-a", code: "TOAN-10A1", name: "Toán 10A1" }} />);
    expect(await screen.findByText("Bài tập tuần này đã mở trên hệ thống.")).toBeInTheDocument();

    // Thích bài viết
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thích" }));
    });
    expect(apiRequest).toHaveBeenCalledWith("/classes/class-a/feed/posts/feed-post-1/like", {
      method: "POST",
      roleCode: "LEARNER",
    });
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());

    // Mở modal chi tiết bài viết và thêm bình luận cấp 1
    fireEvent.click(screen.getByRole("button", { name: "Bình luận" }));
    expect(await screen.findByText("Thầy ơi hạn nộp là thứ mấy ạ?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Viết câu trả lời"), {
      target: { value: "Cảm ơn thầy ạ!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Gửi bình luận"));
    });
    expect(await screen.findByText("Cảm ơn thầy ạ!")).toBeInTheDocument();

    // Trả lời bình luận cấp 1 tạo phản hồi cấp 2 gắn @Bạn B
    fireEvent.click(screen.getAllByRole("button", { name: "Trả lời" })[0]!);
    fireEvent.change(screen.getByLabelText("Viết phản hồi công khai"), {
      target: { value: "Hạn nộp tối thứ Sáu bạn nhé" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Gửi phản hồi"));
    });
    expect(await screen.findByText("Hạn nộp tối thứ Sáu bạn nhé")).toBeInTheDocument();
    expect(screen.getByText("@Bạn B")).toBeInTheDocument();

    // Thích phản hồi cấp 2
    const likeReplyButton = screen
      .getByText("Hạn nộp tối thứ Sáu bạn nhé")
      .closest("div")!
      .querySelector("button")!;
    await act(async () => {
      fireEvent.click(likeReplyButton);
    });
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/classes/class-a/feed/posts/feed-post-1/comments/reply-1/like",
      { method: "POST", roleCode: "LEARNER" },
    );
  });

  it("hỗ trợ sửa bài viết kèm lịch sử chỉnh sửa thật và lưu tùy chọn ẩn/theo dõi xuống DB", async () => {
    session.current = {
      roleCode: "INSTRUCTOR",
      user: { id: "teacher-1", name: "Teacher A", username: "teacher", avatarUrl: null },
    };
    const editablePost = makeFeedPost({ canEdit: true, canDelete: true, comments: [] });
    const editedPost = makeFeedPost({
      canEdit: true,
      canDelete: true,
      content: "Nội dung đã cập nhật lịch thi.",
      isEdited: true,
      comments: [],
      editHistories: [
        {
          id: "hist-1",
          previousContent: "Bài tập tuần này đã mở trên hệ thống.",
          editorName: "Teacher A",
          editedAt: "2026-11-26T09:10:00.000Z",
        },
      ],
    });
    apiRequest
      .mockResolvedValueOnce([editablePost])
      .mockResolvedValueOnce(editedPost)
      .mockResolvedValueOnce({ postId: "feed-post-1", isHidden: false, isFollowing: true });

    render(<ClassFeedView classItem={{ id: "class-a", code: "TOAN-10A1", name: "Toán 10A1" }} />);
    expect(await screen.findByText("Bài tập tuần này đã mở trên hệ thống.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tùy chọn bài viết"));
    fireEvent.click(screen.getByRole("button", { name: "Sửa bài viết" }));
    fireEvent.change(screen.getByLabelText("Chỉnh sửa nội dung bài viết"), {
      target: { value: "Nội dung đã cập nhật lịch thi." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    });
    expect(await screen.findByText("Nội dung đã cập nhật lịch thi.")).toBeInTheDocument();

    // Mở lịch sử chỉnh sửa
    fireEvent.click(screen.getByLabelText("Tùy chọn bài viết"));
    fireEvent.click(screen.getByRole("button", { name: "Lịch sử chỉnh sửa" }));
    expect(await screen.findByText("Bài tập tuần này đã mở trên hệ thống.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Đóng lịch sử chỉnh sửa"));

    // Bật theo dõi bài viết
    fireEvent.click(screen.getByLabelText("Tùy chọn bài viết"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Theo dõi bài viết" }));
    });
    expect(apiRequest).toHaveBeenLastCalledWith("/classes/class-a/feed/posts/feed-post-1/preferences", {
      method: "PATCH",
      roleCode: "INSTRUCTOR",
      body: JSON.stringify({ following: true }),
    });
  });
});
