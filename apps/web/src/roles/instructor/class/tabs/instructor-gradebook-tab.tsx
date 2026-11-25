"use client";

import { memo, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { ClassGradebookTable } from "@/features/academic/class-gradebook-table";
import type { GradebookAssessmentColumn, GradebookRow } from "@/lib/learning-types";
import { exportGradebookCsv } from "../instructor-class-workspace.helpers";

export interface InstructorGradebookTabProps {
  className: string;
  gradebook: GradebookRow[];
  assessments?: GradebookAssessmentColumn[];
}

/** Tab Bảng điểm tổng hợp, cô lập ô tìm kiếm học sinh cục bộ để tránh re-render toàn workspace khi gõ. */
export const InstructorGradebookTab = memo(function InstructorGradebookTab({
  className,
  gradebook,
  assessments,
}: InstructorGradebookTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return gradebook;
    return gradebook.filter((row) =>
      `${row.learnerName} ${row.learnerEmail ?? ""}`.toLowerCase().includes(query),
    );
  }, [gradebook, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Bảng điểm tổng hợp ({className})
          </h2>
          <p className="text-xs text-slate-500">
            Điểm thi, điểm bài tập và trạng thái chấm bài được tổng hợp từ hệ thống.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo tên hoặc email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => exportGradebookCsv(gradebook, className, assessments)}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Download size={14} />
            <span>Xuất CSV</span>
          </button>
        </div>
      </div>
      <ClassGradebookTable
        rows={filteredRows}
        assessments={assessments}
        emptyMessage={searchQuery ? "Không tìm thấy học sinh phù hợp." : "Chưa có dữ liệu bảng điểm."}
      />
    </div>
  );
});
