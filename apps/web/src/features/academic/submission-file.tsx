"use client";

import { useState, type ReactNode } from "react";
import { InlineFilePreview } from "./inline-file-preview";
import { Download, Eye } from "lucide-react";
import { downloadApiFile } from "@/lib/api-client";
import type { AssignmentSubmission } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type Attachment = AssignmentSubmission["attachments"][number];

// Hiển thị tệp đính kèm có kiểm soát quyền truy cập và giải phóng tài nguyên khi đóng bản xem.
export function SubmissionFile({ submissionId, file, showImage = false, children }: {
  submissionId: string; file: Attachment; showImage?: boolean; children?: ReactNode;
}) {
  const { session, notify } = useApp();
  const [open, setOpen] = useState(showImage && file.canPreview && file.mimeType.startsWith("image/"));
  const path = `/assignment-submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(file.id)}`;
  return (
    <div className="w-full min-w-0 space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-32 flex-1 break-all">{file.originalName} ({(file.sizeBytes / 1024).toFixed(1)} KB)</span>
        {file.canPreview && <button type="button" aria-expanded={open} aria-label={`${open ? "Thu gọn" : "Xem trước"} ${file.originalName}`}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1" onClick={() => { setOpen(!open); }}>
          <Eye size={14} />{open ? "Thu gọn" : "Xem"}
        </button>}
        <button type="button" aria-label={`Tải ${file.originalName}`} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1"
          onClick={() => void downloadApiFile(path, session.roleCode).catch((cause: Error) => notify(cause.message, "error"))}>
          <Download size={14} />Tải xuống
        </button>
        {children}
      </div>
      {open && <InlineFilePreview key={path} path={path + "?action=preview"} title={file.originalName} />}
    </div>
  );
}
