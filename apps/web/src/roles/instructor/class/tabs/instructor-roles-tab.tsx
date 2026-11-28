"use client";

import { memo } from "react";
import { MessageCircle } from "lucide-react";
import { UserAvatar } from "@/shared/ui/user-avatar";

export interface InstructorRoleEntry {
  instructorId: string;
  role?: string;
  displayName?: string;
  email?: string | null;
  avatarUrl?: string;
}

export interface InstructorRolesTabProps {
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string | null | undefined;
  instructors: InstructorRoleEntry[];
}

/** Tab Vai trò & Phân quyền giảng dạy hiển thị giảng viên chính và đồng giảng viên được phân công. */
export const InstructorRolesTab = memo(function InstructorRolesTab({
  currentUserId,
  currentUserName,
  currentUserEmail,
  instructors,
}: InstructorRolesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Vai trò & Phân quyền giảng dạy
          </h2>
          <p className="text-xs text-slate-500">
            Danh sách giảng viên được phân công. Việc thêm, gỡ hoặc đổi giảng viên chính do quản lý trung tâm thực hiện.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Giảng viên chính */}
        <div className="rounded-2xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <UserAvatar name={currentUserName} className="size-10" />
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-xs font-bold">{currentUserName}</strong>
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  Giảng viên chính (Primary)
                </span>
              </div>
              <p className="text-[11px] text-slate-500">{currentUserEmail}</p>
            </div>
          </div>
          <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Toàn quyền</span>
        </div>

        {/* Các đồng giáo viên hiện có */}
        {instructors
          .filter((ins) => ins.instructorId !== currentUserId)
          .map((ins) => (
            <div
              key={ins.instructorId}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center justify-between shadow-xs"
            >
              <div className="flex items-center gap-3">
                <UserAvatar name={ins.displayName || "Đồng giáo viên"} className="size-10" />
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-xs font-bold">{ins.displayName || "Đồng giáo viên"}</strong>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                      {ins.role === "ASSISTANT" ? "Trợ giảng" : "Đồng giáo viên"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">{ins.email || "Chưa có email"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("open-mini-chat", {
                        detail: {
                          id: ins.instructorId,
                          name: ins.displayName || "Đồng giáo viên",
                          role: "INSTRUCTOR",
                        },
                      }),
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                  title={`Nhắn tin với ${ins.displayName || "Đồng giáo viên"}`}
                >
                  <MessageCircle size={14} />
                  <span>Nhắn tin</span>
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
});
