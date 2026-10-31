import type { ClassPost, PostComment } from "./class-feed-types";

const FEED_STORAGE_PREFIX = "class_feed_posts_";

/** Kiểm tra phần dữ liệu bình luận cần thiết trước khi render dữ liệu đã lưu. */
function isStoredComment(value: unknown): value is PostComment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const comment = value as Record<string, unknown>;
  return typeof comment.id === "string" &&
    typeof comment.authorName === "string" &&
    typeof comment.createdAt === "string" &&
    typeof comment.content === "string" &&
    typeof comment.likes === "number" && Number.isFinite(comment.likes) &&
    (comment.replies === undefined || (Array.isArray(comment.replies) && comment.replies.every(isStoredComment)));
}

/** Chỉ nhận bài viết có cấu trúc hợp lệ để tránh lỗi render khi storage hỏng. */
function isStoredPost(value: unknown): value is ClassPost {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const post = value as Record<string, unknown>;
  return typeof post.id === "string" &&
    typeof post.authorName === "string" &&
    typeof post.authorRole === "string" &&
    typeof post.createdAt === "string" &&
    typeof post.content === "string" &&
    typeof post.likes === "number" && Number.isFinite(post.likes) &&
    Array.isArray(post.comments) && post.comments.every(isStoredComment) &&
    (post.images === undefined || (Array.isArray(post.images) && post.images.every((image: unknown) => typeof image === "string")));
}

/** Tạo danh sách bài viết khởi tạo mẫu chuẩn bị sẵn cấu trúc phân cấp đa tầng theo đúng hình ảnh mẫu */
function getInitialSeedPosts(classId: string, className?: string, teacherName = "Wind Fall"): ClassPost[] {
  return [
    {
      id: `post-default-1-${classId}`,
      authorName: teacherName,
      authorAvatar: teacherName.slice(0, 2).toUpperCase(),
      authorRole: "Giáo viên",
      createdAt: "17:26 15-09",
      content:
        "Thảo luận: REST hay GraphQL? Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.",
      likes: 12,
      isLiked: false,
      comments: [
        {
          id: `cmt-1-${classId}`,
          authorName: "Trương Sỹ Quý",
          authorAvatar: "TQ",
          authorRole: "Học sinh",
          createdAt: "2 giờ trước",
          content:
            "Điểm đọc lên C và nghe lên b2 hoặc đọc lên C và nói lên B1 thì lên được B2 nhé e",
          likes: 5,
          isLiked: false,
          replies: [
            {
              id: `reply-1-1-${classId}`,
              authorName: "Trần Long",
              authorAvatar: "TL",
              authorRole: "Học sinh",
              createdAt: "2 giờ trước",
              replyTo: "Trương Sỹ Quý",
              content: "check trên này chưa chuẩn hay sao còn lên b, ý nói phúc khảo à b",
              likes: 1,
              isLiked: false,
            },
          ],
        },
        {
          id: `cmt-2-${classId}`,
          authorName: "Hà Mạnh",
          authorAvatar: "HM",
          authorRole: "Học sinh",
          createdAt: "2 giờ trước",
          content:
            "Ôn luyện lại thôi bạn, cố lên, mình cũng rơi vào tình trạng gần tương tự bạn mà, mình còn thiếu có 2đ spk để lên B1 nói và đạt tổng B2 ấy",
          likes: 2,
          isLiked: false,
          replies: [],
        },
      ],
    },
    {
      id: `post-default-2-${classId}`,
      authorName: teacherName,
      authorAvatar: teacherName.slice(0, 2).toUpperCase(),
      authorRole: "Giáo viên",
      createdAt: "09:00 14-09",
      content: `Chào mừng toàn thể các bạn học sinh đến với lớp học ${className || "chuyên đề"}! Mọi câu hỏi thắc mắc trong quá trình học và làm bài tập, các em hãy đăng trực tiếp lên bảng tin lớp để thầy cô cùng các bạn hỗ trợ nhé.`,
      likes: 8,
      isLiked: false,
      comments: [],
    },
  ];
}

/** Đọc danh sách bài viết từ localStorage, nếu chưa có thì khởi tạo từ seed và lưu lại */
export function loadClassFeedPosts(classId: string, className?: string, teacherName?: string): ClassPost[] {
  if (typeof window === "undefined") {
    return getInitialSeedPosts(classId, className, teacherName);
  }

  try {
    const raw = localStorage.getItem(`${FEED_STORAGE_PREFIX}${classId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isStoredPost)) {
        return parsed;
      }
      throw new Error("Dữ liệu bảng tin đã lưu không đúng cấu trúc.");
    }
  } catch (error) {
    console.error("Lỗi khi đọc bảng tin từ localStorage:", error);
  }

  const seed = getInitialSeedPosts(classId, className, teacherName);
  saveClassFeedPosts(classId, seed);
  return seed;
}

/** Lưu danh sách bài viết và báo thất bại để tránh xác nhận lưu sai. */
export function saveClassFeedPosts(classId: string, posts: ClassPost[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(`${FEED_STORAGE_PREFIX}${classId}`, JSON.stringify(posts));
    return true;
  } catch (error) {
    console.error("Lỗi khi ghi bảng tin vào localStorage:", error);
    return false;
  }
}
