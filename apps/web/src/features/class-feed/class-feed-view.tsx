"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, Megaphone, RefreshCw, Send } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { ClassAnnouncement, ClassFeedViewProps } from "./class-feed-types";

/** Tạo instance độc lập cho từng lớp để bản nháp và danh sách không rò sang lớp khác. */
export function ClassFeedView(props: ClassFeedViewProps) {
  return <ClassFeedContent key={props.classItem.id} {...props} />;
}

/**
 * Bảng tin lớp dùng dữ liệu thật của máy chủ (class_announcements): giảng viên được phân công đăng thông báo,
 * mọi thành viên lớp cùng thấy và nhận notification; không còn lưu cục bộ trên trình duyệt hay bài viết mẫu.
 */
function ClassFeedContent({ classItem }: ClassFeedViewProps) {
  const { session, notify } = useApp();
  const { locale } = useI18n();
  const roleCode = session?.roleCode;
  const canPost = roleCode === "INSTRUCTOR";
  const [items, setItems] = useState<ClassAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  /** Tải thông báo mới nhất của lớp theo vai trò đang dùng. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await apiRequest<ClassAnnouncement[]>(`/academic/announcements?classId=${encodeURIComponent(classItem.id)}`, { roleCode });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tải được bảng tin lớp.");
    } finally {
      setLoading(false);
    }
  }, [classItem.id, roleCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSubmit = trimmedTitle.length >= 3 && trimmedBody.length >= 5 && !posting;

  /** Đăng thông báo lên máy chủ; chỉ báo thành công khi máy chủ đã lưu và trả bản ghi. */
  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setPosting(true);
    try {
      const created = await apiRequest<ClassAnnouncement>(`/academic/classes/${encodeURIComponent(classItem.id)}/announcements`, {
        method: "POST",
        roleCode,
        body: JSON.stringify({ title: trimmedTitle, body: trimmedBody }),
      });
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setTitle("");
      setBody("");
      notify("Đã đăng thông báo tới cả lớp.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không đăng được thông báo.", "error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      {canPost && (
        <form onSubmit={(event) => void publish(event)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <Megaphone size={16} className="text-blue-600" />
            <span>Đăng thông báo cho lớp {classItem.code}</span>
          </div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            placeholder="Tiêu đề thông báo (ít nhất 3 ký tự)"
            aria-label="Tiêu đề thông báo"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={10_000}
            rows={4}
            placeholder="Nội dung gửi tới toàn bộ học viên và giảng viên của lớp..."
            aria-label="Nội dung thông báo"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">Thành viên lớp sẽ nhận thông báo trong hệ thống.</p>
            <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>Đăng thông báo</span>
            </button>
          </div>
        </form>
      )}

      <section aria-label="Bảng tin lớp" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <Bell size={16} className="text-amber-500" />
            <span>Thông báo của lớp</span>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw size={13} />
            <span>Làm mới bảng tin</span>
          </button>
        </header>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Đang tải bảng tin...</p>
        ) : loadError ? (
          <p role="alert" className="px-5 py-8 text-center text-sm text-rose-600">{loadError}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Lớp chưa có thông báo nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => (
              <li key={item.id} className="px-5 py-4 space-y-1.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{item.body}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {item.authorName} · {new Date(item.publishedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
