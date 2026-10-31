import { downloadApiFile, publicApiUrl } from "@/lib/api-client";
import type { ChatDirectoryEntry } from "@/lib/learning-types";
import { ImageOff, LoaderCircle, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

export const roleLabels: Record<ChatDirectoryEntry["roleCode"], string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  CENTER_MANAGER: "Quản lý trung tâm",
  INSTRUCTOR: "Giảng viên",
  LEARNER: "Học viên",
};

export interface InlineChatImageProps {
  alt: string;
  mine: boolean;
  onOpen: () => void;
  path: string;
  roleCode: Parameters<typeof downloadApiFile>[1];
}

/** Tải ảnh chat có xác thực và thu hồi object URL khi tin rời khỏi màn hình. */
export function InlineChatImage({
  alt,
  mine,
  onOpen,
  path,
  roleCode,
}: InlineChatImageProps) {
  const [imageUrl, setImageUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    void fetch(publicApiUrl(path), {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "image/*", "x-role-code": roleCode },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("image-preview-failed");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/"))
          throw new Error("invalid-image-preview");
        // Không tạo URL sau khi ảnh hoặc hội thoại đã rời khỏi màn hình.
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError"))
          setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, retryCount, roleCode]);

  return (
    <div
      className={`overflow-hidden rounded-xl ${mine ? "bg-white/10" : "border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40"}`}
    >
      {imageUrl ? (
        <button
          aria-label={`Xem ${alt}`}
          className="block w-72 max-w-full overflow-hidden bg-[var(--canvas)]"
          onClick={onOpen}
          type="button"
        >
          <Image
            alt={alt}
            className="max-h-80 min-h-28 w-full object-contain"
            height={480}
            src={imageUrl}
            unoptimized
            width={640}
          />
        </button>
      ) : failed ? (
        <div className="flex min-h-28 w-72 max-w-full flex-col items-center justify-center gap-2 bg-[var(--canvas)] px-4 text-center text-xs text-[var(--ink-soft)]">
          <ImageOff aria-hidden="true" size={22} />
          <span>Không thể mở bản xem trước.</span>
          <button
            className="font-bold text-[var(--accent-deep)] underline decoration-1 underline-offset-4"
            onClick={() => {
              setFailed(false);
              setRetryCount((current) => current + 1);
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="mr-1 inline" size={13} />
            Thử tải lại
          </button>
        </div>
      ) : (
        <div
          aria-label="Đang tải bản xem trước…"
          className="grid min-h-28 w-72 max-w-full place-items-center bg-[var(--canvas)] text-[var(--ink-soft)]"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="animate-spin" size={20} />
        </div>
      )}
    </div>
  );
}

/** Phục hồi bản nháp của tài khoản trong trình duyệt mà không làm hỏng lần render phía máy chủ. */
export function loadStoredDrafts(userId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(`wind-chat-drafts:${userId}`) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}
