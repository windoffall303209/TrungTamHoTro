"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { apiRequest, downloadApiFile, publicApiUrl } from "@/lib/api-client";
import type { AssignmentSubmission, AttachmentDocumentPreview } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

type PreviewKind = "image" | "pdf" | "office-doc" | "unsupported";

/** Phân loại nhanh định dạng xem trước dựa theo MIME và phần mở rộng tên tệp. */
function detectPreviewKind(mimeType: string, fileName: string): PreviewKind {
  if (mimeType.startsWith("image/") || /\.(?:png|jpe?g|webp|gif)$/i.test(fileName)) return "image";
  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) return "pdf";
  if (
    mimeType === DOCX_MIME ||
    mimeType === DOC_MIME ||
    mimeType === "text/plain" ||
    /\.(?:docx?|txt)$/i.test(fileName)
  ) {
    return "office-doc";
  }
  return "unsupported";
}

/** Tách đoạn văn bản để tô sáng các từ khóa đang tìm mà không dùng innerHTML. */
function HighlightedText({
  text,
  keyword,
  fontSize,
}: {
  text: string;
  keyword: string;
  fontSize: number;
}) {
  const parts = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return [{ text, match: false }];
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    return text.split(regex).filter(Boolean).map((segment) => ({
      text: segment,
      match: segment.toLowerCase() === trimmed.toLowerCase(),
    }));
  }, [text, keyword]);

  return (
    <pre
      className="whitespace-pre-wrap break-words font-sans leading-relaxed text-slate-800 dark:text-slate-100"
      style={{ fontSize: `${fontSize}px` }}
    >
      {parts.map((part, idx) =>
        part.match ? (
          <mark
            key={idx}
            className="rounded bg-amber-300/80 px-0.5 text-slate-950 dark:bg-amber-400/80"
          >
            {part.text}
          </mark>
        ) : (
          <span key={idx}>{part.text}</span>
        ),
      )}
    </pre>
  );
}

interface DocumentRichViewerProps {
  kind: "SUBMISSION_ATTACHMENT" | "MATERIAL";
  submissionId?: string;
  attachment?: AssignmentSubmission["attachments"][number];
  material?: { id: string; name: string; mimeType: string; sizeBytes?: number };
  heightClass?: string;
}

/** Trình xem trước đa định dạng (Ảnh, PDF, DOCX, DOC, TXT) kèm zoom, xoay, tìm từ khóa và toàn màn hình. */
export function DocumentRichViewer(props: DocumentRichViewerProps) {
  const resourceId =
    props.kind === "SUBMISSION_ATTACHMENT"
      ? `${props.submissionId ?? ""}:${props.attachment?.id ?? ""}`
      : props.material?.id ?? "";
  return <DocumentRichViewerContent key={resourceId} {...props} resourceId={resourceId} />;
}

/** Nội dung trình xem trước gắn theo từng tệp để tự làm mới zoom, xoay và tìm kiếm khi chuyển tệp. */
function DocumentRichViewerContent({
  kind,
  submissionId,
  attachment,
  material,
  heightClass = "h-[68dvh]",
  resourceId,
}: DocumentRichViewerProps & { resourceId: string }) {
  const { session, notify } = useApp();
  const fileName = attachment?.originalName ?? material?.name ?? "Tài liệu đính kèm";
  const mimeType = attachment?.mimeType ?? material?.mimeType ?? "application/octet-stream";
  const fileSizeBytes = attachment?.sizeBytes ?? material?.sizeBytes ?? 0;
  const previewType = detectPreviewKind(mimeType, fileName);

  const [blobPreview, setBlobPreview] = useState<{ url: string; mode: "image" | "pdf" } | null>(null);
  const [docPreview, setDocPreview] = useState<AttachmentDocumentPreview | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [docFontSize, setDocFontSize] = useState(15);
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const docHtmlContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!resourceId || previewType === "unsupported") return;
    const controller = new AbortController();
    let createdObjectUrl = "";

    // Tải nội dung tài liệu hoặc dữ liệu nhị phân blob từ API theo loại tệp xem trước.
    async function loadContent() {
      try {
        if (previewType === "office-doc") {
          const contentPath =
            kind === "SUBMISSION_ATTACHMENT" && submissionId && attachment
              ? `/assignment-submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachment.id)}/preview-content`
              : material
                ? `/materials/${encodeURIComponent(material.id)}/preview-content`
                : "";
          if (!contentPath) throw new Error("Thiếu thông tin tệp để xem trước.");
          const result = await apiRequest<AttachmentDocumentPreview>(contentPath, {
            roleCode: session.roleCode,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setDocPreview(result);
          return;
        }

        const streamTarget =
          kind === "SUBMISSION_ATTACHMENT" && submissionId && attachment
            ? `/assignment-submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachment.id)}?action=preview`
            : material
              ? (
                  await apiRequest<{ url: string }>(
                    `/materials/${encodeURIComponent(material.id)}/access?action=PREVIEW`,
                    { roleCode: session.roleCode, signal: controller.signal },
                  )
                ).url
              : "";
        if (!streamTarget) throw new Error("Thiếu đường dẫn xem tệp.");
        const response = await fetch(publicApiUrl(streamTarget), {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: { "x-role-code": session.roleCode },
        });
        if (!response.ok) throw new Error("Không tải được dữ liệu xem trước tệp.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        createdObjectUrl = URL.createObjectURL(blob);
        setBlobPreview({
          url: createdObjectUrl,
          mode: previewType === "image" ? "image" : "pdf",
        });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Không tải được bản xem trước.");
        }
      }
    }

    void loadContent();
    return () => {
      controller.abort();
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [attachment, kind, material, previewType, resourceId, session.roleCode, submissionId]);

  const plainDocumentText = useMemo(() => {
    if (!docPreview) return "";
    if (docPreview.kind === "text") return docPreview.text ?? "";
    if (docPreview.kind === "html" && docPreview.html) {
      return docPreview.html
        .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return "";
  }, [docPreview]);

  const matchCount = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query || !plainDocumentText) return 0;
    const haystack = plainDocumentText.toLowerCase();
    let count = 0;
    let offset = 0;
    while (true) {
      const idx = haystack.indexOf(query, offset);
      if (idx === -1) break;
      count += 1;
      offset = idx + query.length;
    }
    return count;
  }, [plainDocumentText, searchTerm]);

  // Tải xuống tệp bài làm hoặc học liệu gốc qua API stream an toàn.
  const handleDownload = async () => {
    try {
      if (kind === "SUBMISSION_ATTACHMENT" && submissionId && attachment) {
        await downloadApiFile(
          `/assignment-submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachment.id)}`,
          session.roleCode,
        );
      } else if (material) {
        const access = await apiRequest<{ url: string }>(
          `/materials/${encodeURIComponent(material.id)}/access?action=DOWNLOAD`,
          { roleCode: session.roleCode },
        );
        await downloadApiFile(access.url, session.roleCode);
      }
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không thể tải tệp.", "error");
    }
  };

  // Sao chép toàn bộ nội dung văn bản đã trích xuất của tài liệu.
  const handleCopyText = async () => {
    if (!plainDocumentText || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(plainDocumentText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      notify("Đã sao chép văn bản tài liệu.", "success");
    } catch {
      notify("Không sao chép được văn bản.", "error");
    }
  };

  const loading = previewType !== "unsupported" && !error && !blobPreview && !docPreview;
  const effectiveHeight = fullscreen ? "h-[calc(100dvh-10rem)]" : heightClass;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-[95] flex flex-col bg-slate-950/90 p-4 sm:p-6 backdrop-blur-xs"
          : "flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs"
      }
    >
      {/* Thanh công cụ thao tác tài liệu */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/95 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={15} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-[220px] sm:max-w-xs" title={fileName}>
            {fileName}
          </span>
          {fileSizeBytes > 0 && (
            <span className="text-[11px] text-slate-400 shrink-0">
              ({fileSizeBytes >= 1024 * 1024 ? `${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB` : `${(fileSizeBytes / 1024).toFixed(1)} KB`})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {previewType === "image" && (
            <>
              <button
                type="button"
                aria-label="Thu nhỏ ảnh"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                title="Thu nhỏ"
              >
                <ZoomOut size={14} />
              </button>
              <span className="min-w-[3rem] text-center font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                {zoom}%
              </span>
              <button
                type="button"
                aria-label="Phóng to ảnh"
                onClick={() => setZoom((z) => Math.min(250, z + 25))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                title="Phóng to"
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                aria-label="Xoay trái 90 độ"
                onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                title="Xoay trái"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                aria-label="Xoay phải 90 độ"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                title="Xoay phải"
              >
                <RotateCw size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(100);
                  setRotation(0);
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
              >
                Khớp khung
              </button>
            </>
          )}

          {previewType === "office-doc" && docPreview && docPreview.kind !== "unsupported" && (
            <>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  aria-label="Tìm trong tài liệu"
                  placeholder="Tìm trong tài liệu..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-36 sm:w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-2 py-1 text-xs"
                />
              </div>
              {searchTerm.trim() && (
                <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                  {matchCount} kết quả
                </span>
              )}
              <button
                type="button"
                onClick={() => setDocFontSize((size) => Math.max(12, size - 1))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-bold hover:bg-slate-100 cursor-pointer"
                title="Thu nhỏ cỡ chữ"
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setDocFontSize((size) => Math.min(24, size + 1))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-bold hover:bg-slate-100 cursor-pointer"
                title="Tăng cỡ chữ"
              >
                A+
              </button>
              <button
                type="button"
                onClick={() => void handleCopyText()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-semibold hover:bg-slate-100 cursor-pointer"
              >
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                <span>{copied ? "Đã chép" : "Sao chép"}</span>
              </button>
            </>
          )}

          {blobPreview && (
            <button
              type="button"
              onClick={() => window.open(blobPreview.url, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
            >
              <ExternalLink size={13} />
              <span>Mở tab mới</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
          >
            <Download size={13} />
            <span>Tải xuống</span>
          </button>

          {previewType !== "unsupported" && (
            <button
              type="button"
              aria-label={fullscreen ? "Thu nhỏ toàn màn hình" : "Xem toàn màn hình"}
              onClick={() => setFullscreen((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 font-bold text-white hover:bg-sky-700 cursor-pointer"
            >
              {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span className="hidden sm:inline">{fullscreen ? "Thu gọn" : "Toàn màn hình"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Vùng hiển thị nội dung tài liệu */}
      <div className={`flex-1 overflow-auto bg-slate-100/70 dark:bg-slate-950/60 ${effectiveHeight}`}>
        {loading ? (
          <div className="flex h-full items-center justify-center p-8 text-sm font-medium text-slate-500" role="status">
            Đang tải bản xem trước tài liệu...
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" role="alert">
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
            >
              <Download size={14} />
              <span>Tải xuống tệp gốc</span>
            </button>
          </div>
        ) : blobPreview?.mode === "image" ? (
          <div className="flex min-h-full items-center justify-center overflow-auto p-4">
            <img
              src={blobPreview.url}
              alt={fileName}
              onError={() => setError("Không hiển thị được hình ảnh này.")}
              className="max-w-none rounded-lg shadow-md transition-transform duration-150"
              style={{
                transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
                maxHeight: zoom === 100 && rotation % 180 === 0 ? "100%" : undefined,
                maxWidth: zoom === 100 && rotation % 180 === 0 ? "100%" : undefined,
              }}
            />
          </div>
        ) : blobPreview?.mode === "pdf" ? (
          <iframe
            title={fileName}
            src={blobPreview.url}
            className="h-full w-full border-0 bg-white"
          />
        ) : docPreview && docPreview.kind !== "unsupported" ? (
          <div className="mx-auto max-w-4xl space-y-3 p-5 sm:p-8">
            {docPreview.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {docPreview.warnings.map((warning, idx) => (
                  <p key={idx}>{warning}</p>
                ))}
              </div>
            )}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs">
              {docPreview.kind === "html" && docPreview.html && !searchTerm.trim() ? (
                <div
                  ref={docHtmlContainerRef}
                  className="space-y-3 text-slate-800 dark:text-slate-100 leading-relaxed [&_h1]:text-xl [&_h1]:font-extrabold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:dark:bg-slate-800 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-slate-300 [&_td]:dark:border-slate-700 [&_td]:px-3 [&_td]:py-1.5 [&_img]:max-w-full [&_img]:rounded-lg [&_blockquote]:border-l-4 [&_blockquote]:border-sky-400 [&_blockquote]:pl-3 [&_blockquote]:italic"
                  style={{ fontSize: `${docFontSize}px` }}
                  dangerouslySetInnerHTML={{ __html: docPreview.html }}
                />
              ) : (
                <HighlightedText
                  text={plainDocumentText || docPreview.text || "Tài liệu không có nội dung văn bản."}
                  keyword={searchTerm}
                  fontSize={docFontSize}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <FileText size={36} className="text-slate-400" />
            <p className="max-w-md text-sm font-medium text-slate-600 dark:text-slate-300">
              {docPreview?.warnings[0] ?? "Định dạng này không hỗ trợ xem trực tiếp trên trình duyệt."}
            </p>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
            >
              <Download size={14} />
              <span>Tải tệp xuống máy</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
