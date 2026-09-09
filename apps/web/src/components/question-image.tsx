"use client";

import Image from "next/image";
import { publicApiUrl } from "@/lib/api-client";

interface QuestionImageProps {
  alt?: string;
  className?: string;
  imageUrl?: string;
}

/** Hiển thị ảnh câu hỏi từ blob cục bộ hoặc endpoint API có cookie phiên. */
export function QuestionImage({ alt = "Hình minh họa cho câu hỏi", className = "", imageUrl }: QuestionImageProps) {
  if (!imageUrl) return null;
  const source = imageUrl.startsWith("blob:") ? imageUrl : publicApiUrl(imageUrl);
  return (
    <Image
      alt={alt}
      className={`h-auto max-h-[28rem] w-auto max-w-full rounded-xl border border-[var(--rule)] bg-white object-contain ${className}`}
      height={900}
      src={source}
      unoptimized
      width={1400}
    />
  );
}
