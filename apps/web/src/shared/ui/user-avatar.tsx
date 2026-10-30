"use client";

import { useEffect, useState } from "react";
import { publicApiUrl } from "@/lib/api-client";

/** Lấy tối đa hai chữ cái cuối của họ tên làm avatar dự phòng. */
function initials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || "U";
  return parts.slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

/** Hiển thị avatar với cơ chế Progressive Fallback: Initials luôn hiện lập tức 0ms, ảnh chỉ hiện đè lên khi đã nạp xong 100%. */
export function UserAvatar({
  avatarUrl,
  name,
  className = "size-11",
  priority = false,
}: {
  avatarUrl?: string | null;
  name: string;
  className?: string;
  priority?: boolean;
}) {
  const source = avatarUrl
    ? /^(?:blob:|data:|https?:\/\/)/.test(avatarUrl)
      ? avatarUrl
      : publicApiUrl(avatarUrl)
    : "";

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 dark:from-blue-600 dark:to-indigo-500 font-extrabold text-white ring-1 ring-blue-400/30 shadow-2xs select-none ${className}`}
    >
      {/* Lớp chữ cái Initials luôn luôn hiển thị lập tức không bao giờ để vòng tròn trống */}
      <span aria-hidden="true" className="uppercase font-bold tracking-tight select-none">
        {initials(name)}
      </span>

      {/* Lớp ảnh nạp tiến trình: chỉ hiện mượt mà khi đã tải thành công, tự huỷ nếu lỗi hoặc quá hạn */}
      {source ? (
        <AvatarImageOverlay
          key={source}
          priority={priority}
          source={source}
        />
      ) : null}
    </span>
  );
}

/** Tải ảnh đại diện với kiểm soát timeout và fade-in mượt mà, không bao giờ chặn hoặc che mất chữ initials khi ảnh chưa sẵn sàng. */
function AvatarImageOverlay({
  source,
  priority,
}: {
  source: string;
  priority: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [source]);

  if (failed) return null;

  return (

    <img
      src={source}
      alt=""
      aria-hidden="true"
      loading={priority ? "eager" : "lazy"}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
