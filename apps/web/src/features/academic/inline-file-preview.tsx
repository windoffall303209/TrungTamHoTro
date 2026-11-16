"use client";
import { useEffect, useState } from "react";
import { apiRequest, publicApiUrl } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

// Hiển thị nội dung tệp bảo mật trong trang và hủy yêu cầu đọc đang chờ khi đóng trình xem.
export function InlineFilePreview({ path = "", materialId, title }: { path?: string; materialId?: string; title: string }) {
  const { session: { roleCode } } = useApp();
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" | "video" | "audio" } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {

    const controller = new AbortController();
    let url = "";
    // Chỉ hiển thị ảnh qua thẻ img, video/audio qua trình phát và PDF qua iframe.
    async function load() {
      try {
        const target = materialId ? (await apiRequest<{ url: string }>(`/materials/${encodeURIComponent(materialId)}/access?action=PREVIEW`, { roleCode, signal: controller.signal })).url : path;
        const response = await fetch(publicApiUrl(target), {
          credentials: "include", cache: "no-store", signal: controller.signal,
          headers: { "x-role-code": roleCode },
        });
        if (!response.ok) throw new Error("Không tải được bản xem trước.");
        const blob = await response.blob();
        const kind = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : blob.type === "application/pdf" ? "pdf" : null;
        if (!kind) throw new Error("Định dạng này chỉ hỗ trợ tải xuống.");
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, kind });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Không tải được bản xem trước.");
      }
    }
    void load();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [materialId, path, roleCode]);
  if (error) return <p role="alert" className="p-3 text-sm">{error}</p>;
  if (!preview) return <p role="status" className="p-3 text-sm">Đang tải bản xem trước…</p>;
  if (preview.kind === "image") return <img src={preview.url} alt={title} onError={() => setError("Không hiển thị được ảnh.")} className="mx-auto max-h-[52dvh] max-w-full rounded-lg object-contain" />;
  if (preview.kind === "video") return <video src={preview.url} controls playsInline aria-label={title} className="mx-auto max-h-[65dvh] w-full bg-black" />;
  if (preview.kind === "audio") return <audio src={preview.url} controls aria-label={title} className="w-full" />;
  return <iframe title={title} src={preview.url} className="h-[55dvh] w-full rounded-lg border" />;
}
