export type LectureLinkPlatform = "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"]);

// Đọc mã YouTube cũ từ metadata để vẫn phân loại được các bài giảng đã lưu trước đây.
function getLegacyYoutubeId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
    const id = url.hostname.toLowerCase() === "youtu.be" ? url.pathname.split("/")[1] : url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/")[2];
    return id && /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
  } catch { return null; }
}

// Chỉ chấp nhận liên kết HTTPS của ba nền tảng được hỗ trợ, loại bỏ tên miền giả mạo.
export function detectLectureLinkPlatform(value: string): LectureLinkPlatform {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || value.length > 2048) return "INVALID";
    const host = url.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host)) return getLectureYoutubeId(value) || getLegacyYoutubeId(value) ? "YOUTUBE" : "INVALID";
    if (FACEBOOK_HOSTS.has(host) && url.pathname !== "/") return "FACEBOOK";
    if (host === "drive.google.com" && url.pathname !== "/") return "DRIVE";
  } catch { /* URL chưa hợp lệ khi đang nhập. */ }
  return "INVALID";
}

// Lấy ID video từ các đường dẫn YouTube chuẩn và kiểm tra trước khi tạo iframe.
export function getLectureYoutubeId(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
    const id = url.hostname.toLowerCase() === "youtu.be" ? url.pathname.split("/")[1] :
      url.pathname === "/watch" ? url.searchParams.get("v") :
        /^\/(?:embed|shorts|live|v)\//.test(url.pathname) ? url.pathname.split("/")[2] : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

// Đọc URL từ metadata mới hoặc thẻ YouTube cũ để các bài giảng cũ vẫn hiển thị.
export function getLectureSourceUrl(tags: readonly string[]): string | undefined {
  const url = tags.find((tag) => tag.startsWith("lecture-url:"))?.slice("lecture-url:".length);
  if (url && detectLectureLinkPlatform(url) !== "INVALID") return url;
  const youtubeId = tags.find((tag) => tag.startsWith("youtube:"))?.slice("youtube:".length);
  return youtubeId && /^[A-Za-z0-9_-]{6,64}$/.test(youtubeId) ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined;
}

// Chuyển liên kết bài giảng thành URL nhúng an toàn cho các nền tảng hỗ trợ xem trong trang.
export function getLectureEmbedUrl(value?: string): string | null {
  if (!value) return null;
  const platform = detectLectureLinkPlatform(value);
  if (platform === "YOUTUBE") {
    const videoId = getLectureYoutubeId(value);
    return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1` : null;
  }
  if (platform === "DRIVE") {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/^\/file\/d\/([^/]+)/u);
      return match?.[1] ? `https://drive.google.com/file/d/${encodeURIComponent(match[1])}/preview` : null;
    } catch { return null; }
  }
  if (platform === "FACEBOOK") return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(value)}&show_text=false`;
  return null;
}
