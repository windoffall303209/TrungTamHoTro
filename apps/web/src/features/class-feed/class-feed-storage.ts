import type { ClassPost } from "./class-feed-types";

const FEED_STORAGE_PREFIX = "class_feed_posts_";

/** Tạo danh sách bài viết khởi tạo mẫu chuẩn bị sẵn cấu trúc phân cấp đa tầng theo đúng hình ảnh mẫu */
export function getInitialSeedPosts(classId: string, className?: string, teacherName = "Wind Fall"): ClassPost[] {
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
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (error) {
    console.error("Lỗi khi đọc bảng tin từ localStorage:", error);
  }

  const seed = getInitialSeedPosts(classId, className, teacherName);
  saveClassFeedPosts(classId, seed);
  return seed;
}

/** Lưu danh sách bài viết vào localStorage */
export function saveClassFeedPosts(classId: string, posts: ClassPost[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${FEED_STORAGE_PREFIX}${classId}`, JSON.stringify(posts));
  } catch (error) {
    console.error("Lỗi khi ghi bảng tin vào localStorage:", error);
  }
}
