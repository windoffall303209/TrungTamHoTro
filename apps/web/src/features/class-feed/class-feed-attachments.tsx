"use client";

import { useEffect, useState } from "react";
import { Download, Eye, FileText, ImageOff, Loader2, Paperclip, RotateCcw } from "lucide-react";
import { downloadApiFile, previewApiFile, publicApiUrl } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import { isSafePreviewImage, safePreviewBlob } from "@/lib/safe-content";
import type { ClassFeedAttachment } from "./class-feed-types";

/** Quy đổi dung lượng tệp sang chuỗi dễ đọc theo B, KB hoặc MB. */
export function formatFeedFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Tạo đường dẫn API đọc tệp đính kèm bảng tin theo lớp, bài viết và mã tệp. */
export function feedAttachmentPath(
  classId: string,
  postId: string,
  attachmentId: string,
  preview = false,
): string {
  const base = `/classes/${encodeURIComponent(classId)}/feed/posts/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return preview ? `${base}?action=preview` : base;
}

/** Tải ảnh đính kèm có xác thực bằng cookie phiên + vai trò và tự thu hồi object URL khi unmount. */
export function FeedAttachmentImage({
  alt,
  path,
  roleCode,
  className = "size-full object-cover",
}: {
  alt: string;
  path: string;
  roleCode?: RoleCode;
  className?: string;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    const headers: Record<string, string> = { accept: "image/*" };
    if (roleCode) headers["x-role-code"] = roleCode;

    void fetch(publicApiUrl(path), {
      cache: "no-store",
      credentials: "include",
      headers,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("feed-image-failed");
        const blob = await response.blob();
        if (!isSafePreviewImage(blob.type)) throw new Error("feed-image-unsafe");
        if (!active) return;
        objectUrl = URL.createObjectURL(safePreviewBlob(blob));
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, retryCount, roleCode]);

  if (imageUrl) {
    return <img src={imageUrl} alt={alt} className={className} />;
  }

  if (failed) {
    return (
      <div className="flex size-full min-h-32 flex-col items-center justify-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 text-center text-xs text-slate-500 dark:text-slate-400">
        <ImageOff size={18} />
        <span>Không tải được ảnh.</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setFailed(false);
            setRetryCount((count) => count + 1);
          }}
          className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          <RotateCcw size={12} />
          <span>Thử tải lại</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Đang tải ảnh..."
      className="grid size-full min-h-32 place-items-center bg-slate-100 dark:bg-slate-800 text-slate-400"
    >
      <Loader2 size={18} className="animate-spin" />
    </div>
  );
}

/** Hiển thị lưới ảnh kiểu bảng tin (1 ảnh rộng, 2+ ảnh chia 2 cột kèm nhãn +N) và bấm mở modal chi tiết. */
export function FeedPostImageGrid({
  classId,
  postId,
  images,
  roleCode,
  onOpenPost,
}: {
  classId: string;
  postId: string;
  images: ClassFeedAttachment[];
  roleCode?: RoleCode;
  onOpenPost: () => void;
}) {
  if (!images.length) return null;

  return (
    <div
      onClick={onOpenPost}
      className={`grid gap-2 cursor-pointer rounded-xl overflow-hidden ${
        images.length === 1 ? "grid-cols-1" : "grid-cols-2"
      }`}
    >
      <div className="h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
        <FeedAttachmentImage
          alt={images[0]!.originalName}
          path={feedAttachmentPath(classId, postId, images[0]!.id, true)}
          roleCode={roleCode}
          className="size-full object-cover hover:scale-102 transition-transform duration-200"
        />
      </div>

      {images.length >= 2 && (
        <div className="relative h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          <FeedAttachmentImage
            alt={images[1]!.originalName}
            path={feedAttachmentPath(classId, postId, images[1]!.id, true)}
            roleCode={roleCode}
            className="size-full object-cover hover:scale-102 transition-transform duration-200"
          />
          {images.length > 2 && (
            <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white text-2xl font-bold">
              +{images.length - 2}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Danh sách tệp tài liệu đính kèm trong bài viết kèm thao tác xem trước và tải xuống có xác thực. */
export function FeedPostFileList({
  classId,
  postId,
  files,
  roleCode,
  dark = false,
  onError,
}: {
  classId: string;
  postId: string;
  files: ClassFeedAttachment[];
  roleCode?: RoleCode;
  dark?: boolean;
  onError: (message: string) => void;
}) {
  if (!files.length) return null;

  /** Mở bản xem trước an toàn cho PDF hoặc định dạng hỗ trợ xem trực tiếp. */
  const handlePreview = async (file: ClassFeedAttachment) => {
    if (!roleCode) return;
    try {
      await previewApiFile(
        feedAttachmentPath(classId, postId, file.id, true),
        roleCode,
        file.originalName,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không thể mở bản xem trước.");
    }
  };

  /** Tải xuống tệp đính kèm với cookie phiên và tên tệp Unicode gốc. */
  const handleDownload = async (file: ClassFeedAttachment) => {
    if (!roleCode) return;
    try {
      await downloadApiFile(
        feedAttachmentPath(classId, postId, file.id, false),
        roleCode,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không thể tải tệp đính kèm.");
    }
  };

  return (
    <div className="space-y-1.5">
      {files.map((file) => (
        <div
          key={file.id}
          className={`flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-xs ${
            dark
              ? "border-slate-700 bg-slate-800/70 text-slate-200"
              : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {file.mimeType === "application/pdf" ? (
              <FileText size={15} className="shrink-0 text-rose-500" />
            ) : (
              <Paperclip size={15} className="shrink-0 text-blue-500" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{file.originalName}</p>
              <p className={dark ? "text-[11px] text-slate-400" : "text-[11px] text-slate-500 dark:text-slate-400"}>
                {formatFeedFileSize(file.sizeBytes)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {file.canPreview && (
              <button
                type="button"
                onClick={() => void handlePreview(file)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                  dark
                    ? "bg-slate-700 text-slate-100 hover:bg-slate-600"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Eye size={13} />
                <span>Xem trước</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDownload(file)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 px-2.5 py-1 font-semibold text-white transition-colors cursor-pointer"
            >
              <Download size={13} />
              <span>Tải xuống</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
