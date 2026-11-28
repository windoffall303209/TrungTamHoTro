"use client";

import { memo, useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import type { DirectoryUser } from "@/lib/learning-types";
import { UserAvatar } from "@/shared/ui/user-avatar";

export interface InstructorMembersTabProps {
  instructorName: string;
  instructorEmail: string | null | undefined;
  learners: DirectoryUser[];
}

/** Tab Thành viên của giảng viên, tự cô lập ô tìm kiếm học viên để gõ phím không re-render toàn bộ workspace. */
export const InstructorMembersTab = memo(function InstructorMembersTab({
  instructorName,
  instructorEmail,
  learners,
}: InstructorMembersTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLearners = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return learners;
    return learners.filter(
      (learner) =>
        learner.displayName.toLowerCase().includes(query) ||
        (learner.email ?? "").toLowerCase().includes(query),
    );
  }, [learners, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Thành viên lớp học ({learners.length} học sinh)
          </h2>
          <p className="text-xs text-slate-500">Danh sách học sinh và giáo viên phụ trách trong lớp</p>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Tìm học sinh theo tên/email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-extrabold text-[10px]">
            <tr>
              <th className="px-4 py-3">Họ và tên</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Nhắn tin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {/* Giáo viên */}
            <tr className="bg-blue-50/40 dark:bg-blue-950/20">
              <td className="px-4 py-3 font-bold flex items-center gap-2">
                <UserAvatar name={instructorName} className="size-6 text-[10px]" />
                <span>{instructorName}</span>
              </td>
              <td className="px-4 py-3 text-slate-500">{instructorEmail}</td>
              <td className="px-4 py-3">
                <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold text-[10px]">
                  Giảng viên chính
                </span>
              </td>
              <td className="px-4 py-3 text-emerald-600 font-bold">Phụ trách</td>
              <td className="px-4 py-3 text-right text-slate-400">—</td>
            </tr>

            {/* Học sinh */}
            {filteredLearners.map((learner) => (
              <tr key={learner.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-medium flex items-center gap-2">
                  <UserAvatar name={learner.displayName} className="size-6 text-[10px]" />
                  <span>{learner.displayName}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">{learner.email}</td>
                <td className="px-4 py-3 text-slate-500">Học sinh</td>
                <td className="px-4 py-3 text-emerald-600 font-bold">Đang học</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("open-mini-chat", {
                          detail: {
                            id: learner.id,
                            name: learner.displayName,
                            role: "LEARNER",
                          },
                        }),
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                    title={`Nhắn tin với ${learner.displayName}`}
                  >
                    <MessageCircle size={14} />
                    <span>Nhắn tin</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
