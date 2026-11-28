"use client";

import React, { memo, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import { formatGradeLabel, type Course, type LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { ClassAvatar } from "@/shared/ui/class-avatar";

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

export interface InstructorSettingsTabProps {
  item: LearningClass;
  course: Course | null;
  roleCode?: RoleCode;
  onClassUpdated?: (updated: LearningClass) => void;
}

/** Tab Cài đặt lớp học cho phép giảng viên phụ trách tùy chỉnh thông tin, quyền bảng điểm, quyền đăng bài và avatar lớp. */
export const InstructorSettingsTab = memo(function InstructorSettingsTab({
  item,
  course,
  roleCode = "INSTRUCTOR",
  onClassUpdated,
}: InstructorSettingsTabProps) {
  const { notify } = useApp();
  const isClosed = item.status === "CLOSED";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(item.name);
  const [capacity, setCapacity] = useState(item.capacity);
  const [allowPeerGradeViewing, setAllowPeerGradeViewing] = useState(
    Boolean(item.allowPeerGradeViewing),
  );
  const [allowLearnerFeedPosting, setAllowLearnerFeedPosting] = useState(
    item.allowLearnerFeedPosting ?? true,
  );
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    setName(item.name);
    setCapacity(item.capacity);
    setAllowPeerGradeViewing(Boolean(item.allowPeerGradeViewing));
    setAllowLearnerFeedPosting(item.allowLearnerFeedPosting ?? true);
  }, [
    item.id,
    item.name,
    item.capacity,
    item.allowPeerGradeViewing,
    item.allowLearnerFeedPosting,
  ]);

  /** Lưu toàn bộ thay đổi cài đặt lớp học xuống PostgreSQL và đồng bộ tức thì lên workspace. */
  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || isClosed) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      notify("Tên lớp học cần ít nhất 2 ký tự.", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiRequest<LearningClass>(
        `/classes/${encodeURIComponent(item.id)}/settings`,
        {
          method: "PATCH",
          roleCode,
          body: JSON.stringify({
            name: trimmedName,
            capacity: Number(capacity),
            allowPeerGradeViewing,
            allowLearnerFeedPosting,
          }),
        },
      );
      onClassUpdated?.(updated);
      notify("Đã lưu cài đặt lớp học thành công.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được cài đặt lớp học.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Tải ảnh đại diện mới cho lớp học (PNG/JPEG/WebP tối đa 3 MB) thay cho icon mặc định. */
  const handleSelectAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploadingAvatar || isClosed) return;
    if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) {
      notify("Ảnh đại diện lớp học phải có kích thước từ 1 byte đến 3 MB.", "error");
      return;
    }
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const updated = await apiRequest<LearningClass>(
        `/classes/${encodeURIComponent(item.id)}/avatar`,
        {
          method: "POST",
          roleCode,
          body: formData,
        },
      );
      onClassUpdated?.(updated);
      notify("Đã cập nhật ảnh đại diện lớp học.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được ảnh đại diện lớp học.",
        "error",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  /** Gỡ ảnh đại diện lớp học để quay về icon mặc định. */
  const handleRemoveAvatar = async () => {
    if (!item.avatarUrl || uploadingAvatar || isClosed) return;
    setUploadingAvatar(true);
    try {
      const updated = await apiRequest<LearningClass>(
        `/classes/${encodeURIComponent(item.id)}/avatar`,
        {
          method: "DELETE",
          roleCode,
        },
      );
      onClassUpdated?.(updated);
      notify("Đã chuyển lớp học về icon mặc định.", "info");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gỡ được ảnh đại diện lớp học.",
        "error",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
          Cài đặt lớp học ({item.name})
        </h2>
        <p className="text-xs text-slate-500">
          Tùy chỉnh ảnh đại diện, thông tin cơ bản và quyền tương tác của học sinh trong lớp.
        </p>
      </div>

      {isClosed && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Lớp đã lưu trữ và chỉ cho phép đọc.
        </div>
      )}

      {/* Ảnh đại diện lớp học */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-4">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Ảnh đại diện lớp học
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <ClassAvatar
            avatarUrl={item.avatarUrl}
            name={item.name}
            sizeClass="size-16"
            iconSize={28}
          />
          <div className="space-y-2 flex-1 min-w-52">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Chọn ảnh PNG, JPEG hoặc WebP (tối đa 3 MB) để hiển thị thay cho icon mặc định trên danh sách lớp và thanh điều hướng.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                aria-label="Chọn ảnh đại diện lớp học"
                className="hidden"
                onChange={(event) => void handleSelectAvatar(event)}
              />
              <button
                type="button"
                disabled={isClosed || uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
              >
                {uploadingAvatar ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ImagePlus size={14} />
                )}
                <span>Chọn ảnh đại diện</span>
              </button>
              {item.avatarUrl && (
                <button
                  type="button"
                  disabled={isClosed || uploadingAvatar}
                  onClick={() => void handleRemoveAvatar()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Dùng icon mặc định</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Biểu mẫu cài đặt lớp học */}
      <form
        onSubmit={(event) => void handleSave(event)}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-5"
      >
        <div className="space-y-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
            Thông tin lớp học
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <label className="space-y-1.5 block">
              <span className="font-bold text-slate-700 dark:text-slate-200">Tên lớp học</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={200}
                disabled={isClosed}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>

            <label className="space-y-1.5 block">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                Sức chứa tối đa (học viên)
              </span>
              <input
                type="number"
                required
                min={1}
                max={1000}
                disabled={isClosed}
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">MÃ LỚP CHÍNH THỨC</span>
              <strong className="text-slate-700 dark:text-slate-200">{item.code}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">KHÓA HỌC / HỌC PHẦN</span>
              <strong className="text-slate-700 dark:text-slate-200">{course?.name || item.courseId}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">KHỐI HỌC</span>
              <strong className="text-slate-700 dark:text-slate-200">
                {item.grade ? formatGradeLabel(item.grade) : "Chưa đặt"}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">MÔN HỌC</span>
              <strong className="text-slate-700 dark:text-slate-200">
                {item.subject || "Chưa đặt"}
              </strong>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
            Quyền & tương tác của học sinh
          </h3>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
            <input
              type="checkbox"
              disabled={isClosed}
              checked={allowPeerGradeViewing}
              onChange={(event) => setAllowPeerGradeViewing(event.target.checked)}
              className="mt-1 h-4 w-4 accent-blue-600"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                Cho phép học sinh xem bảng điểm
              </span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Hiển thị tab Bảng điểm ở phía học sinh theo chế độ chỉ xem, không có thao tác chấm bài hoặc xem chi tiết bài làm như giáo viên.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
            <input
              type="checkbox"
              disabled={isClosed}
              checked={allowLearnerFeedPosting}
              onChange={(event) => setAllowLearnerFeedPosting(event.target.checked)}
              className="mt-1 h-4 w-4 accent-blue-600"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                Cho phép học sinh đăng bài trên bảng tin
              </span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Khi bật, học sinh được tạo bài viết mới kèm tệp đính kèm trên bảng tin lớp; khi tắt, chỉ giảng viên và quản lý được đăng bài mới.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="submit"
            disabled={isClosed || saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Lưu cài đặt</span>
          </button>
        </div>
      </form>
    </div>
  );
});
