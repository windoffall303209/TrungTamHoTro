"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Folder,
  LayoutDashboard,
  LayoutGrid,
  List,
  Lock,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  Repeat2,
  Settings,
  Share2,
  Trash2,
  Upload,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge } from "@/components/ui";
import { UserPicker } from "@/components/user-picker";
import { UserAvatar } from "@/components/user-avatar";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type {
  ClassClosureReadiness,
  ClassRoster,
  Course,
  EnrollmentImportResult,
  InstructorRole,
  LearningClass,
} from "@/lib/learning-types";
import { roleLabel, type RemoveTarget } from "@/features/class-detail/class-detail.shared";

export type ManagerSubTab =
  | "overview"
  | "feed"
  | "instructors"
  | "learners"
  | "schedule"
  | "assignments"
  | "materials"
  | "lectures";

export interface ManagerClassWorkspaceProps {
  item: LearningClass;
  course: Course | null;
  roster: ClassRoster | null;
  readiness: ClassClosureReadiness | null;
  saving: boolean;
  onBack: () => void;
  instructorForm: { userId: string; role: InstructorRole };
  setInstructorForm: React.Dispatch<React.SetStateAction<{ userId: string; role: InstructorRole }>>;
  learnerId: string;
  setLearnerId: React.Dispatch<React.SetStateAction<string>>;
  bulkLearners: string;
  setBulkLearners: React.Dispatch<React.SetStateAction<string>>;
  importResults: EnrollmentImportResult[];
  removeTarget: RemoveTarget | null;
  setRemoveTarget: React.Dispatch<React.SetStateAction<RemoveTarget | null>>;
  removeReason: string;
  setRemoveReason: React.Dispatch<React.SetStateAction<string>>;
  transferTarget: { id: string; name: string } | null;
  setTransferTarget: React.Dispatch<React.SetStateAction<{ id: string; name: string } | null>>;
  transferReason: string;
  setTransferReason: React.Dispatch<React.SetStateAction<string>>;
  activeEnrollments: ClassRoster["enrollments"];
  instructors: Array<{
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
  }>;
  primaryInstructor?: {
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
  };
  learnerPagination: any;
  historyPagination: any;
  assignInstructor: (event: React.FormEvent) => Promise<void>;
  transferPrimary: (event: React.FormEvent) => Promise<void>;
  enrollLearner: (event: React.FormEvent) => Promise<void>;
  importEnrollments: (event: React.FormEvent) => Promise<void>;
  removeMember: (event: React.FormEvent) => Promise<void>;
  activate: () => Promise<void>;
}

/** Không gian làm việc quản trị chi tiết lớp dành riêng cho Quản lý trung tâm. */
export function ManagerClassWorkspace({
  item,
  course,
  roster,
  readiness,
  saving,
  onBack,
  instructorForm,
  setInstructorForm,
  learnerId,
  setLearnerId,
  bulkLearners,
  setBulkLearners,
  importResults,
  removeTarget,
  setRemoveTarget,
  removeReason,
  setRemoveReason,
  transferTarget,
  setTransferTarget,
  transferReason,
  setTransferReason,
  activeEnrollments,
  instructors,
  primaryInstructor,
  learnerPagination,
  assignInstructor,
  transferPrimary,
  enrollLearner,
  importEnrollments,
  removeMember,
  activate,
}: ManagerClassWorkspaceProps) {
  const { notify } = useApp();
  const [currentClass, setCurrentClass] = useState<LearningClass>(item);
  const [activeTab, setActiveTab] = useState<ManagerSubTab>("overview");
  const [copiedLink, setCopiedLink] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Trạng thái cài đặt lớp học
  const [settingsForm, setSettingsForm] = useState({
    name: item.name,
    capacity: item.capacity ?? 40,
    description: (item as any).description || "",
  });

  // Trạng thái xem lịch học & xác nhận kích hoạt/đóng lớp học
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");
  const [confirmActivateOpen, setConfirmActivateOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [closingClass, setClosingClass] = useState(false);

  // Trạng thái thư mục tài liệu & bài giảng
  const [selectedFolder, setSelectedFolder] = useState<string>("__ALL__");
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");

  // Đồng bộ lại khi prop item thay đổi
  useEffect(() => {
    setCurrentClass(item);
    setSettingsForm({
      name: item.name,
      capacity: item.capacity ?? 40,
      description: (item as any).description || "",
    });
  }, [item]);

  const classGrade = currentClass.grade ?? course?.grade;
  const classSubject = currentClass.subject ?? course?.subject;

  /** Kích hoạt mở Chat Mini Size trực tiếp với một thành viên */
  const handleOpenChatWithMember = (member: { id: string; name: string; role: "LEARNER" | "INSTRUCTOR" }) => {
    window.dispatchEvent(
      new CustomEvent("open-mini-chat", {
        detail: {
          id: member.id,
          name: member.name,
          role: member.role,
        },
      }),
    );
  };

  /** Sao chép liên kết lớp học vào bộ nhớ tạm */
  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  /** Lưu các cài đặt cập nhật của lớp học */
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await apiRequest<LearningClass>(`/manager/classes/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: settingsForm.name.trim(),
          capacity: Number(settingsForm.capacity),
        }),
      });
      setCurrentClass((prev) => ({
        ...prev,
        ...updated,
        name: settingsForm.name.trim(),
        capacity: Number(settingsForm.capacity),
        description: settingsForm.description.trim(),
      } as LearningClass));
      notify("Đã cập nhật cài đặt lớp học thành công.", "success");
      setSettingsModalOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được cài đặt lớp.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const navMenuItems: Array<{
    id: ManagerSubTab;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
    { id: "feed", label: "Bảng tin lớp học", icon: MessageSquare },
    {
      id: "instructors",
      label: "Giảng viên",
      icon: UserCheck,
      count: instructors.length,
    },
    {
      id: "learners",
      label: "Học viên & Ghi danh",
      icon: Users,
      count: activeEnrollments.length,
    },
    { id: "schedule", label: "Lịch học", icon: CalendarDays },
    { id: "assignments", label: "Bài tập", icon: FileText },
    { id: "materials", label: "Tài liệu", icon: Folder },
    { id: "lectures", label: "Bài giảng", icon: Video },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* ========================================================= */}
      {/* THANH TOP BAR TỐI GIẢN (Thay thế toàn bộ hero banner cũ)   */}
      {/* ========================================================= */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={onBack}
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition shadow-2xs cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Danh sách lớp</span>
          </button>
          <span className="text-slate-300 dark:text-slate-700">/</span>
          <span className="px-2.5 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 text-xs font-mono font-bold tracking-wider uppercase">
            {item.code}
          </span>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate max-w-sm">
            {currentClass.name}
          </h1>
          {currentClass.status === "CLOSED" && (
            <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs font-semibold">
              Đã đóng lớp
            </span>
          )}
          {classGrade && (
            <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200/80 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 text-xs font-semibold">
              Khối {classGrade}
            </span>
          )}
          {classSubject && (
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              Môn {classSubject}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Share2 size={13} />
            <span>{copiedLink ? "Đã sao chép!" : "Sao chép link"}</span>
          </button>

          {currentClass.status === "DRAFT" && (
            <Button
              loading={saving}
              onClick={() => setConfirmActivateOpen(true)}
              className="h-8 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 size={14} />
              <span>Kích hoạt lớp</span>
            </Button>
          )}

          {currentClass.status !== "DRAFT" && currentClass.status !== "CLOSED" && (
            <Button
              loading={closingClass}
              onClick={() => setConfirmCloseOpen(true)}
              className="h-8 px-3 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
            >
              <Lock size={14} />
              <span>Đóng lớp</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ========================================================= */}
        {/* CỘT 1: THANH DỌC ĐIỀU HƯỚNG VÀ CÀI ĐẶT LỚP Ở FOOTER (280px) */}
        {/* ========================================================= */}
        <aside className="w-full lg:w-72 shrink-0 space-y-3 lg:sticky lg:top-20">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1">
              Phân hệ quản trị
            </p>
            <nav className="space-y-1">
              {navMenuItems.map(({ id, label, icon: Icon, count }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs font-extrabold"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        size={16}
                        className={isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}
                      />
                      <span className="truncate">{label}</span>
                    </div>
                    {typeof count === "number" && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-semibold ${
                          isActive
                            ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* FOOTER Ở GÓC TRÁI MÀN HÌNH: CÀI ĐẶT LỚP HỌC */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSettingsModalOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/40 shadow-2xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Settings size={16} className="text-slate-500" />
                  <span className="truncate">Cài đặt lớp</span>
                </div>
                <span className="text-[10px] text-slate-400 font-semibold">Tùy chỉnh</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ========================================================= */}
        {/* CỘT 2: KHU VỰC TÁC NGHIỆP CHÍNH (MAIN CONTENT AREA)        */}
        {/* ========================================================= */}
        <main className="flex-1 min-w-0 space-y-5">
          {/* ------------------------------------------------------------- */}
          {/* TAB 1: TỔNG QUAN                                              */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "overview" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                    Tổng quan lớp học
                  </h2>
                  <p className="text-xs text-slate-500">
                    Thông tin định danh và thông số cơ bản của lớp học.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Settings size={14} />
                  <span>Sửa cài đặt</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mã lớp</span>
                  <p className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100">{item.code}</p>
                </div>

                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tên lớp</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{currentClass.name}</p>
                </div>

                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Khối lớp</span>
                  <p className="text-sm font-bold text-purple-600 dark:text-purple-400">
                    {classGrade ? `Khối ${classGrade}` : "Chưa xác định"}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Môn học</span>
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {classSubject ? `Môn ${classSubject}` : (course?.name || "Chưa xác định")}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sức chứa</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {currentClass.capacity ?? 40} học viên
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mô tả</span>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {(currentClass as any).description?.trim() || "Chưa có mô tả cho lớp học này."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 2: BẢNG TIN LỚP HỌC (CLASS FEED)                          */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "feed" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs">
              <div className="pb-3 mb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Bảng tin lớp học
                  </h3>
                  <p className="text-xs text-slate-400">
                    Theo dõi và kiểm duyệt các bài viết, trao đổi giữa giáo viên và học sinh.
                  </p>
                </div>
              </div>
              <ClassFeedView
                classItem={item}
                courseName={course?.name}
                teacherName={primaryInstructor?.displayName || "Giáo viên phụ trách"}
              />
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 3: GIẢNG VIÊN (Mỗi giảng viên là 1 dòng kèm nút nhắn tin)  */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "instructors" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Giảng viên phụ trách
                    </h3>
                    <p className="text-xs text-slate-400">
                      Danh sách giảng viên phụ trách và quản lý chuyên môn của lớp học.
                    </p>
                  </div>
                  <Button onClick={() => setAssignModalOpen(true)} className="text-xs">
                    <UserPlus size={15} />
                    <span>Phân công giảng viên</span>
                  </Button>
                </div>

                {instructors.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Chưa có giảng viên nào được phân công vào lớp này.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {instructors.map((ins) => {
                      const isPrimary = ins.role === "PRIMARY";
                      return (
                        <div
                          key={ins.instructorId}
                          className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-blue-300 dark:hover:border-blue-700 transition-all gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <UserAvatar
                              avatarUrl={ins.avatarUrl}
                              name={ins.displayName || "GV"}
                              className="size-9 rounded-full shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {ins.displayName || "Giảng viên"}
                                </strong>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isPrimary
                                      ? "bg-blue-600 text-white"
                                      : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  Giảng viên{isPrimary ? " chính" : ""}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {ins.email || "giangvien@wind.edu.vn"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Biểu tượng nhắn tin trực tiếp với giảng viên */}
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenChatWithMember({
                                  id: ins.instructorId,
                                  name: ins.displayName || "Giảng viên",
                                  role: "INSTRUCTOR",
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                              title={`Nhắn tin với ${ins.displayName || "Giảng viên"}`}
                            >
                              <MessageCircle size={14} />
                              <span className="hidden sm:inline">Nhắn tin</span>
                            </button>

                            {!isPrimary && (
                              <button
                                type="button"
                                title="Bổ nhiệm làm GV chính"
                                onClick={() =>
                                  setTransferTarget({
                                    id: ins.instructorId,
                                    name: ins.displayName || "Giảng viên",
                                  })
                                }
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              >
                                <Repeat2 size={15} />
                              </button>
                            )}

                            <button
                              type="button"
                              title="Gỡ giảng viên khỏi lớp"
                              onClick={() =>
                                setRemoveTarget({
                                  kind: "instructors",
                                  id: ins.instructorId,
                                  name: ins.displayName || "Giảng viên",
                                })
                              }
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 4: HỌC VIÊN & GHI DANH (Có nút nhắn tin từng học viên)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "learners" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Học viên đã ghi danh ({activeEnrollments.length})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Quản lý danh sách học sinh tham gia lớp học và kiểm soát sĩ số.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setBulkModalOpen(true)}
                      variant="secondary"
                      className="text-xs"
                    >
                      <Upload size={14} />
                      <span>Ghi danh sỉ</span>
                    </Button>
                    <Button onClick={() => setEnrollModalOpen(true)} className="text-xs">
                      <UserPlus size={14} />
                      <span>Thêm học viên</span>
                    </Button>
                  </div>
                </div>

                {/* Bảng danh sách học viên */}
                {activeEnrollments.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                    <Users className="mx-auto text-slate-300 dark:text-slate-700" size={32} />
                    <p>Chưa có học viên nào được ghi danh vào lớp học này.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold uppercase text-slate-500 border-b border-slate-100 dark:border-slate-800">
                        <tr>
                          <th className="px-4 py-2.5">Học viên</th>
                          <th className="px-3.5 py-2.5">Ngày ghi danh</th>
                          <th className="px-3.5 py-2.5">Trạng thái</th>
                          <th className="px-4 py-2.5 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {learnerPagination.pageItems.map((enrollment: ClassRoster["enrollments"][number]) => (
                          <tr
                            key={enrollment.learnerId}
                            className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <div className="size-8 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold grid place-items-center text-xs shrink-0">
                                  {(enrollment.displayName || enrollment.learnerId).slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <strong className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                                    {enrollment.displayName || enrollment.learnerId}
                                  </strong>
                                  <span className="text-[10px] text-slate-400">
                                    Mã: {enrollment.learnerId}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3.5 py-3 text-slate-500">
                              {enrollment.joinedAt ? new Date(enrollment.joinedAt).toLocaleDateString(activeLocale()) : "—"}
                            </td>
                            <td className="px-3.5 py-3">
                              <StatusBadge status={enrollment.status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {/* Biểu tượng nhắn tin với học sinh */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenChatWithMember({
                                      id: enrollment.learnerId,
                                      name: enrollment.displayName || enrollment.learnerId,
                                      role: "LEARNER",
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                                  title={`Nhắn tin với ${enrollment.displayName || enrollment.learnerId}`}
                                >
                                  <MessageCircle size={13} />
                                  <span>Nhắn tin</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRemoveTarget({
                                      kind: "enrollments",
                                      id: enrollment.learnerId,
                                      name: enrollment.displayName || enrollment.learnerId,
                                    })
                                  }
                                  className="text-rose-600 hover:text-rose-700 dark:hover:text-rose-400 font-semibold p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                >
                                  Gỡ học viên
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Phân trang danh sách học viên */}
                {activeEnrollments.length > 0 && (
                  <Pagination
                    className="pt-2"
                    itemLabel="học viên"
                    onPageChange={learnerPagination.setPage}
                    onPageSizeChange={learnerPagination.setPageSize}
                    page={learnerPagination.page}
                    pageSize={learnerPagination.pageSize}
                    totalItems={learnerPagination.totalItems}
                  />
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 5: LỊCH HỌC (Dạng tuần & Dạng tháng chuẩn học sinh)       */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "schedule" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Lịch học của {currentClass.name || item.code}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Theo dõi và quản lý các ca học, thời khóa biểu và điểm danh của lớp này.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Nút chuyển đổi: Dạng tuần (Lưới) & Dạng tháng (Danh sách) */}
                  <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setScheduleView("week")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        scheduleView === "week"
                          ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      }`}
                    >
                      <LayoutGrid size={14} />
                      <span>Dạng tuần (Lưới)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleView("month")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        scheduleView === "month"
                          ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      }`}
                    >
                      <List size={14} />
                      <span>Dạng tháng (Danh sách)</span>
                    </button>
                  </div>

                  <Link
                    href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-2xs"
                  >
                    <CalendarDays size={14} />
                    <span>Đối soát điểm danh</span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => notify("Chức năng thêm buổi học mới đã sẵn sàng.", "info")}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus size={14} />
                    <span>Thêm buổi học</span>
                  </button>
                </div>
              </div>

              {scheduleView === "week" ? (
                /* CHẾ ĐỘ DẠNG TUẦN: HIỂN THỊ DẠNG LƯỚI 7 NGÀY CỦA LỚP */
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2">
                  {[
                    { day: "Thứ 2", date: "26/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 01: Nhập môn & Quy định", isToday: false },
                    { day: "Thứ 3", date: "27/10", hasClass: false, isToday: true },
                    { day: "Thứ 4", date: "28/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 02: Phương trình & Giải thuật", isToday: false },
                    { day: "Thứ 5", date: "29/10", hasClass: false, isToday: false },
                    { day: "Thứ 6", date: "30/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 03: Bài tập chuyên đề 1", isToday: false },
                    { day: "Thứ 7", date: "31/10", hasClass: false, isToday: false },
                    { day: "Chủ nhật", date: "01/11", hasClass: false, isToday: false },
                  ].map((col, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border flex flex-col justify-between min-h-40 ${
                        col.hasClass
                          ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60"
                          : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-1.5 mb-2">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{col.day}</span>
                          <span className="text-[10px] text-slate-400">{col.date}</span>
                        </div>

                        {col.hasClass ? (
                          <div className="space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold block w-fit">
                              Trực tuyến
                            </span>
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                              {col.title}
                            </p>
                            <p className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock size={11} /> {col.time}
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic pt-6 text-center">Nghỉ</p>
                        )}
                      </div>

                      {col.hasClass && (
                        <div className="space-y-1 mt-2">
                          <button
                            type="button"
                            onClick={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
                            className="w-full py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                          >
                            Vào phòng
                          </button>
                          <Link
                            href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                            className="w-full block py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold transition-colors text-center"
                          >
                            Điểm danh
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* CHẾ ĐỘ DẠNG THÁNG: HIỂN THỊ DẠNG DANH SÁCH */
                <div className="space-y-3 pt-2">
                  {[
                    { date: "26/10/2026", time: "19:30 - 21:00", title: "Buổi 01: Nhập môn & Hướng dẫn phương pháp học", status: "Đã diễn ra" },
                    { date: "28/10/2026", time: "19:30 - 21:00", title: "Buổi 02: Phương trình & Giải thuật cơ bản", status: "Hôm nay" },
                    { date: "30/10/2026", time: "19:30 - 21:00", title: "Buổi 03: Chữa bài tập chuyên đề và Kiểm tra 15p", status: "Sắp diễn ra" },
                    { date: "02/11/2026", time: "19:30 - 21:00", title: "Buổi 04: Chuyên đề nâng cao và Vận dụng thực tế", status: "Sắp diễn ra" },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.status === "Hôm nay"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : row.status === "Đã diễn ra"
                              ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          }`}>
                            {row.status}
                          </span>
                          <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                            {row.title}
                          </strong>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-2">
                          <span>Ngày: {row.date}</span>
                          <span>·</span>
                          <span>Thời gian: {row.time}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          <Play size={13} />
                          <span>Vào phòng</span>
                        </button>
                        <Link
                          href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Điểm danh
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 6: BÀI TẬP (Thay thế Học liệu & Bài tập theo yêu cầu)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "assignments" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài tập của lớp ({currentClass.name})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Quản lý danh sách bài tập rèn luyện, bài kiểm tra và tiến độ nộp bài của học viên.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/academic?classId=${encodeURIComponent(item.id)}`}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus size={14} />
                    <span>Tạo bài tập mới</span>
                  </Link>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {[
                  {
                    title: "Bài tập rèn luyện tuần 1: Đại số & Hàm số bậc hai",
                    type: "Tự luận & Trắc nghiệm",
                    dueDate: "23:59 - 30/10/2026",
                    submittedCount: activeEnrollments.length > 0 ? Math.floor(activeEnrollments.length * 0.8) : 18,
                    totalCount: activeEnrollments.length || 24,
                    status: "Đang mở",
                  },
                  {
                    title: "Bài kiểm tra định kỳ 15 phút - Chương 1",
                    type: "Trắc nghiệm tự động",
                    dueDate: "21:00 - 02/11/2026",
                    submittedCount: 0,
                    totalCount: activeEnrollments.length || 24,
                    status: "Sắp diễn ra",
                  },
                  {
                    title: "Phiếu khảo sát và đánh giá năng lực đầu khóa",
                    type: "Phiếu đánh giá",
                    dueDate: "23:59 - 25/10/2026",
                    submittedCount: activeEnrollments.length || 24,
                    totalCount: activeEnrollments.length || 24,
                    status: "Đã kết thúc",
                  },
                ].map((asg, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 transition bg-white dark:bg-slate-900/60 gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          asg.status === "Đang mở"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : asg.status === "Sắp diễn ra"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}>
                          {asg.status}
                        </span>
                        <span className="text-[11px] text-slate-400">{asg.type}</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {asg.title}
                      </h4>
                      <p className="text-xs text-slate-500">
                        Hạn nộp: <strong className="text-slate-700 dark:text-slate-300">{asg.dueDate}</strong> · Đã nộp: <strong className="text-blue-600 dark:text-blue-400">{asg.submittedCount}/{asg.totalCount}</strong> học viên
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/academic?classId=${encodeURIComponent(item.id)}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        Chấm bài
                      </Link>
                      <button
                        type="button"
                        onClick={() => notify(`Xem chi tiết bài tập: ${asg.title}`, "info")}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 text-xs font-semibold cursor-pointer"
                      >
                        Chi tiết
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 7: TÀI LIỆU (Tách riêng theo giao diện giáo viên)          */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "materials" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Tài liệu ({currentClass.name})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục chuyên đề.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => notify("Đang mở trình tải tài liệu học tập...", "info")}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <UploadCloud size={14} />
                    <span>Tải tài liệu</span>
                  </button>
                </div>
              </div>

              {/* Khung Master-Detail */}
              <div className="flex flex-col lg:flex-row min-h-[460px]">
                {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                    <span>Thư mục</span>
                  </div>

                  <div className="space-y-1">
                    {[
                      { id: "__ALL__", name: "Tất cả tài liệu", count: 4 },
                      { id: "chap-1", name: "Chuyên đề 1: Nhập môn", count: 1 },
                      { id: "chap-2", name: "Chuyên đề 2: Lý thuyết", count: 2 },
                      { id: "chap-3", name: "Chuyên đề 3: Bài tập ôn", count: 1 },
                    ].map((f) => {
                      const isSelected = selectedFolder === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSelectedFolder(f.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                            isSelected
                              ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Folder
                              size={15}
                              className={isSelected ? "text-blue-600 fill-blue-500/20" : "text-slate-400"}
                            />
                            <span className="truncate">{f.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 tabular-nums">{f.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* CỘT 2: DANH SÁCH TÀI LIỆU */}
                <div className="flex-1 min-w-0 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Tài liệu trong thư mục ({selectedFolder === "__ALL__" ? "Tất cả" : "Chuyên đề"})
                  </div>
                  <div className="space-y-2">
                    {[
                      { title: "Giáo trình bài giảng lý thuyết tuần 1.pdf", type: "PDF", size: "2.4 MB", date: "24/10/2026", author: "Vũ Đức Minh" },
                      { title: "Slide trình chiếu trực quan chương 1.pptx", type: "SLIDE", size: "8.1 MB", date: "25/10/2026", author: "Vũ Đức Minh" },
                      { title: "Phiếu bài tập rèn luyện kỹ năng số 01.docx", type: "DOC", size: "450 KB", date: "26/10/2026", author: "Vũ Đức Minh" },
                      { title: "Tài liệu tra cứu công thức nhanh.pdf", type: "PDF", size: "1.2 MB", date: "27/10/2026", author: "Vũ Đức Minh" },
                    ].map((mat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition bg-white dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                              {mat.title}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {mat.size} · Tải lên ngày {mat.date} · bởi {mat.author}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => notify(`Đang tải file ${mat.title}...`, "success")}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                          >
                            Tải về
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 8: BÀI GIẢNG (Tách riêng theo giao diện giáo viên)          */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "lectures" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài giảng ({currentClass.name})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Video bài học chuyên đề, slide trình chiếu và audio ghi âm theo chương mục.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => notify("Đang mở trình thêm bài giảng mới...", "info")}
                    className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus size={14} />
                    <span>Thêm bài giảng</span>
                  </button>
                </div>
              </div>

              {/* Khung Master-Detail */}
              <div className="flex flex-col lg:flex-row min-h-[460px]">
                {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                    <span>Chuyên đề</span>
                  </div>

                  <div className="space-y-1">
                    {[
                      { id: "__ALL__", name: "Tất cả chuyên đề", count: 3 },
                      { id: "mod-1", name: "Chương 1: Kiến thức nền tảng", count: 1 },
                      { id: "mod-2", name: "Chương 2: Ứng dụng thực tế", count: 2 },
                    ].map((f) => {
                      const isSelected = selectedLectureFolder === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSelectedLectureFolder(f.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                            isSelected
                              ? "text-purple-600 dark:text-purple-400 font-bold bg-purple-50/80 dark:bg-purple-950/50"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Folder
                              size={15}
                              className={isSelected ? "text-purple-600 fill-purple-500/20" : "text-slate-400"}
                            />
                            <span className="truncate">{f.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 tabular-nums">{f.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* CỘT 2: DANH SÁCH BÀI GIẢNG */}
                <div className="flex-1 min-w-0 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Bài giảng trong chuyên đề ({selectedLectureFolder === "__ALL__" ? "Tất cả" : "Chuyên đề"})
                  </div>
                  <div className="space-y-2">
                    {[
                      { title: "Bài 01: Giới thiệu tổng quan và phương pháp tiếp cận", duration: "45:20", teacher: "Vũ Đức Minh", views: 28 },
                      { title: "Bài 02: Phân tích mô hình dữ liệu và giải thuật cốt lõi", duration: "52:10", teacher: "Vũ Đức Minh", views: 24 },
                      { title: "Bài 03: Hướng dẫn thực hành và giải đáp thắc mắc chuyên sâu", duration: "38:45", teacher: "Vũ Đức Minh", views: 19 },
                    ].map((lec, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-purple-400 transition bg-white dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-9 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 grid place-items-center shrink-0">
                            <Video size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                              {lec.title}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Thời lượng: {lec.duration} · Giảng viên: {lec.teacher} · {lec.views} lượt xem
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => notify(`Đang mở bài giảng: ${lec.title}`, "info")}
                            className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold cursor-pointer"
                          >
                            Xem bài giảng
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ========================================================= */}
      {/* MODAL CÀI ĐẶT LỚP HỌC (Góc trái footer kích hoạt)          */}
      {/* ========================================================= */}
      <Modal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        title="Cài đặt lớp học"
        description="Chỉnh sửa các thông số vận hành và thiết lập của lớp học này."
      >
        <form onSubmit={(e) => void handleSaveSettings(e)} className="space-y-4">
          <Field label="Tên lớp học">
            <input
              className={inputClass}
              required
              minLength={2}
              value={settingsForm.name}
              onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
            />
          </Field>

          <Field label="Sức chứa tối đa (học viên)">
            <input
              type="number"
              min={1}
              max={500}
              className={inputClass}
              required
              value={settingsForm.capacity}
              onChange={(e) => setSettingsForm({ ...settingsForm, capacity: Number(e.target.value) })}
            />
          </Field>

          <Field label="Mô tả lớp học (không bắt buộc)">
            <input
              type="text"
              className={inputClass}
              placeholder="1 dòng mô tả hoặc ghi chú lớp học..."
              value={settingsForm.description}
              onChange={(e) => setSettingsForm({ ...settingsForm, description: e.target.value })}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setSettingsModalOpen(false)} type="button">
              Hủy
            </Button>
            <Button loading={savingSettings} type="submit">
              Lưu cài đặt
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal xác nhận kích hoạt lớp */}
      <Modal
        open={confirmActivateOpen}
        onClose={() => setConfirmActivateOpen(false)}
        title="Xác nhận kích hoạt lớp học"
        description={`Bạn có chắc chắn muốn kích hoạt lớp học "${currentClass.name}"? Sau khi kích hoạt, học viên và giảng viên có thể truy cập đầy đủ các phân hệ học tập.`}
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Lớp học sẽ chuyển sang trạng thái hoạt động chính thức (ACTIVE).
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setConfirmActivateOpen(false)} type="button">
              Hủy
            </Button>
            <Button
              loading={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={async () => {
                try {
                  await activate();
                  setCurrentClass((prev) => ({ ...prev, status: "ACTIVE" }));
                  notify("Đã kích hoạt lớp học thành công.", "success");
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Kích hoạt lớp thất bại.", "error");
                } finally {
                  setConfirmActivateOpen(false);
                }
              }}
            >
              Xác nhận kích hoạt
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal xác nhận đóng lớp */}
      <Modal
        open={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        title="Xác nhận đóng lớp học"
        description={`Bạn có chắc chắn muốn đóng lớp học "${currentClass.name}"?`}
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Sau khi đóng, lớp học sẽ chuyển sang trạng thái lưu trữ (CLOSED). Học viên sẽ không thể nộp bài tập mới hoặc thực hiện các hoạt động tính điểm.
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setConfirmCloseOpen(false)} type="button">
              Hủy
            </Button>
            <Button
              loading={closingClass}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={async () => {
                setClosingClass(true);
                try {
                  await apiRequest(`/manager/classes/${item.id}/close`, {
                    method: "POST",
                    body: JSON.stringify({
                      closeReason: "Kết thúc khóa học",
                      archivePolicy: "READ_ONLY",
                    }),
                  });
                  setCurrentClass((prev) => ({ ...prev, status: "CLOSED" }));
                  notify("Đã đóng lớp học thành công.", "success");
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Đóng lớp thất bại.", "error");
                } finally {
                  setClosingClass(false);
                  setConfirmCloseOpen(false);
                }
              }}
            >
              Xác nhận đóng lớp
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal 1: Phân công giảng viên mới */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Phân công giảng viên"
        description="Gán giảng viên phụ trách vào lớp học."
      >
        <form
          onSubmit={(e) => {
            void assignInstructor(e);
            setAssignModalOpen(false);
          }}
          className="space-y-4"
        >
          <Field label="Chọn giảng viên">
            <UserPicker
              label="Tìm kiếm giảng viên"
              role="INSTRUCTOR"
              value={instructorForm.userId}
              onChange={(userId) => setInstructorForm({ ...instructorForm, userId })}
            />
          </Field>
          <Field label="Vai trò phụ trách">
            <select
              className={inputClass}
              value={instructorForm.role}
              onChange={(e) =>
                setInstructorForm({ ...instructorForm, role: e.target.value as InstructorRole })
              }
            >
              <option value="PRIMARY">Giảng viên chính</option>
              <option value="CO_INSTRUCTOR">Đồng giảng viên</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setAssignModalOpen(false)} type="button">
              Hủy
            </Button>
            <Button loading={saving} disabled={!instructorForm.userId} type="submit">
              Xác nhận phân công
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Ghi danh học viên đơn lẻ */}
      <Modal
        open={enrollModalOpen}
        onClose={() => setEnrollModalOpen(false)}
        title="Thêm học viên vào lớp"
        description="Ghi danh học viên mới từ hệ thống."
      >
        <form
          onSubmit={(e) => {
            void enrollLearner(e);
            setEnrollModalOpen(false);
          }}
          className="space-y-4"
        >
          <Field label="Chọn tài khoản học viên">
            <UserPicker label="Tìm kiếm học viên" role="LEARNER" value={learnerId} onChange={setLearnerId} />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setEnrollModalOpen(false)} type="button">
              Hủy
            </Button>
            <Button loading={saving} disabled={!learnerId} type="submit">
              Ghi danh ngay
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Ghi danh hàng loạt (Bulk Import) */}
      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Ghi danh sỉ học viên"
        description="Nhập danh sách mã tài khoản học viên (phân cách bằng dấu phẩy hoặc xuống dòng)."
      >
        <form
          onSubmit={(e) => {
            void importEnrollments(e);
          }}
          className="space-y-4"
        >
          <Field label="Danh sách mã học viên">
            <textarea
              className={inputClass}
              rows={5}
              placeholder="usr-learner-1, usr-learner-2..."
              value={bulkLearners}
              onChange={(e) => setBulkLearners(e.target.value)}
              required
            />
          </Field>

          {importResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs">
              {importResults.map((res, i) => (
                <div key={i} className="flex justify-between py-0.5">
                  <span className="font-mono">{res.userId}</span>
                  <span className={res.status === "ENROLLED" ? "text-emerald-600 font-bold" : "text-amber-600"}>
                    {res.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setBulkModalOpen(false)} type="button">
              Đóng
            </Button>
            <Button loading={saving} disabled={!bulkLearners.trim()} type="submit">
              Xử lý ghi danh
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Chuyển giao vai trò GV chính */}
      <Modal
        open={Boolean(transferTarget)}
        onClose={() => setTransferTarget(null)}
        title="Chuyển giao vai trò Giảng viên chính"
        description={`Bổ nhiệm ${transferTarget?.name} làm Giảng viên chính mới.`}
      >
        <form
          onSubmit={(e) => {
            void transferPrimary(e);
          }}
          className="space-y-4"
        >
          <Field label="Lý do chuyển giao vai trò">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Nhập lý do thay đổi phân công..."
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setTransferTarget(null)} type="button">
              Hủy
            </Button>
            <Button loading={saving} disabled={!transferReason.trim()} type="submit">
              Xác nhận chuyển giao
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 5: Gỡ thành viên (Giảng viên / Học viên) kèm lý do */}
      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={
          removeTarget?.kind === "instructors"
            ? "Gỡ phân công giảng viên"
            : "Gỡ học viên khỏi lớp"
        }
        description={`Xác nhận gỡ ${removeTarget?.name} khỏi lớp học.`}
      >
        <form
          onSubmit={(e) => {
            void removeMember(e);
          }}
          className="space-y-4"
        >
          <Field label="Lý do gỡ thành viên (bắt buộc)">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Nhập lý do nghiệp vụ..."
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)} type="button">
              Hủy
            </Button>
            <Button
              loading={saving}
              disabled={!removeReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              type="submit"
            >
              Xác nhận gỡ
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
