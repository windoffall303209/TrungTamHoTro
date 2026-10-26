"use client";

import { useState } from "react";
import { publicApiUrl } from "@/lib/api-client";

/** Lấy tối đa hai chữ cái cuối của họ tên làm avatar dự phòng. */
function initials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || "U";
  return parts.slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

/** Hiển thị avatar từ URL tuyệt đối/blob hoặc ghép URL API; fallback sang chữ cái initials an toàn không bị tràn chữ. */
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
      {source ? (
        <AvatarImage key={source} name={name} priority={priority} source={source} />
      ) : (
        <span aria-hidden="true" className="uppercase font-bold tracking-tight">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/** Theo dõi lỗi tải ảnh để thay bằng initials ngay trong cùng khung avatar mà không hiện icon vỡ hay tràn alt text. */
function AvatarImage({
  source,
  name,
}: {
  source: string;
  name: string;
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !source) {
    return (
      <span aria-hidden="true" className="uppercase font-bold tracking-tight">
        {initials(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt=""
      aria-hidden="true"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
