"use client";

import { useEffect, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import { publicApiUrl } from "@/lib/api-client";

/** Hiển thị ảnh đại diện lớp học nếu đã cài đặt, tự động lùi về icon mũ tốt nghiệp mặc định khi chưa có ảnh hoặc tải lỗi. */
export function ClassAvatar({
  avatarUrl,
  name,
  gradient = "from-blue-600 to-indigo-600",
  sizeClass = "size-12",
  iconSize = 22,
  className = "",
}: {
  avatarUrl?: string | null;
  name: string;
  gradient?: string;
  sizeClass?: string;
  iconSize?: number;
  className?: string;
}) {
  const source = avatarUrl
    ? /^(?:blob:|data:|https?:\/\/)/.test(avatarUrl)
      ? avatarUrl
      : publicApiUrl(avatarUrl)
    : "";

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-tr ${gradient} text-white shadow-xs select-none ${sizeClass} ${className}`}
    >
      <GraduationCap aria-hidden="true" size={iconSize} />
      {source ? <ClassAvatarImage key={source} alt={name} source={source} /> : null}
    </span>
  );
}

/** Tải ảnh lớp học phủ lên icon mặc định sau khi nạp xong, tự ẩn nếu ảnh lỗi để không bao giờ để ô trống. */
function ClassAvatarImage({ alt, source }: { alt: string; source: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, [source]);

  if (failed) return null;

  return (
    <img
      ref={imageRef}
      src={source}
      alt={alt}
      loading="lazy"
      className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${
        loaded ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setFailed(true);
      }}
    />
  );
}
