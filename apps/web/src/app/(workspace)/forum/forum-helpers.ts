import type { ForumTopic } from "@/lib/learning-types";

const AVATAR_PALETTES = [
  "bg-sky-500 text-white",
  "bg-indigo-500 text-white",
  "bg-cyan-600 text-white",
  "bg-emerald-500 text-white",
  "bg-blue-600 text-white",
  "bg-violet-500 text-white",
  "bg-amber-500 text-white",
];

// Trả về màu nền avatar nhất quán theo mã người dùng.
export function getAvatarPalette(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index] ?? "bg-sky-500 text-white";
}

// Lấy 1-2 chữ cái viết tắt đại diện cho người dùng từ định danh.
export function getInitials(nameOrId: string): string {
  if (!nameOrId) return "?";
  const cleaned = nameOrId.trim();
  const parts = cleaned.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

// Định dạng thời gian tương đối dễ đọc giống mạng xã hội.
export function formatRelativeTime(dateString: string, isEn: boolean): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return isEn ? "Just now" : "Vừa xong";
  if (diffMin < 60) return isEn ? `${diffMin}m ago` : `${diffMin} phút trước`;
  if (diffHours < 24) return isEn ? `${diffHours}h ago` : `${diffHours} giờ trước`;
  if (diffDays < 7) return isEn ? `${diffDays}d ago` : `${diffDays} ngày trước`;
  return date.toLocaleDateString(isEn ? "en-US" : "vi-VN", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// Định dạng tên tác giả hiển thị thân thiện từ mã định danh.
export function formatAuthorName(authorId: string, currentUserId: string, currentUserName: string): string {
  if (authorId === currentUserId) return `${currentUserName} (Bạn)`;
  if (authorId.startsWith("usr-")) {
    const raw = authorId.replace("usr-", "").replace(/[-_]/g, " ");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return authorId;
}

// Lọc chủ đề theo lớp, quyền sở hữu, ghim và nội dung tìm kiếm.
export function filterForumTopics(
  topics: ForumTopic[],
  classFilter: string,
  topicTab: "all" | "pinned" | "mine",
  topicSearch: string,
  currentUserId: string,
): ForumTopic[] {
  return topics.filter((topic) => {
    if (classFilter && topic.classId !== classFilter) return false;
    if (topicTab === "pinned" && !topic.isPinned) return false;
    if (topicTab === "mine" && topic.authorId !== currentUserId) return false;
    if (topicSearch.trim()) {
      const query = topicSearch.trim().toLowerCase();
      const matchTitle = topic.title.toLowerCase().includes(query);
      const matchBody = topic.body.toLowerCase().includes(query);
      const matchTag = topic.tags.some((tag) => tag.toLowerCase().includes(query));
      if (!matchTitle && !matchBody && !matchTag) return false;
    }
    return true;
  });
}
