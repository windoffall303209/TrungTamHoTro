"use client";

import { memo } from "react";
import type { Course, LearningClass } from "@/lib/learning-types";

export interface InstructorSettingsTabProps {
  item: LearningClass;
  course: Course | null;
}

/** Tab Cài đặt lớp học hiển thị thông tin cấu hình lớp do quản lý trung tâm kiểm soát. */
export const InstructorSettingsTab = memo(function InstructorSettingsTab({
  item,
  course,
}: InstructorSettingsTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
          Cài đặt lớp học ({item.name})
        </h2>
        <p className="text-xs text-slate-500">
          Thông tin lớp do quản lý trung tâm quản lý
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs space-y-5">
        <div className="space-y-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
            Thông tin lớp học
          </h3>
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">TÊN LỚP</span>
              <strong className="text-slate-700 dark:text-slate-200">{item.name}</strong>
            </div>
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
              <strong className="text-slate-700 dark:text-slate-200">{item.grade ? `Khối ${item.grade}` : "Chưa đặt"}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">MÔN HỌC</span>
              <strong className="text-slate-700 dark:text-slate-200">{item.subject || "Chưa đặt"}</strong>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Tên, mô tả và quy định của lớp do quản lý trung tâm cập nhật. Số lượt làm bài, hạn nộp và việc cho nộp muộn được cấu hình trong từng đề thi hoặc bài tập.
          </p>
        </div>
      </div>
    </div>
  );
});
