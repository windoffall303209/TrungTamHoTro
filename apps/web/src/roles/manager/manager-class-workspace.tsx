"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Eye,
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
  Search,
  Settings,
  Share2,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge } from "@/shared/ui/ui";
import type { usePagination } from "@/shared/ui/ui";
import { UserPicker } from "@/shared/ui/user-picker";
import { UserAvatar } from "@/shared/ui/user-avatar";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { ClassScheduleMonthList } from "@/features/class-detail/class-schedule-month-list";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useApp } from "@/providers/app-provider";
import type {
  ClassClosureReadiness,
  ClassRoster,
  Course,
  EnrollmentImportResult,
  InstructorRole,
  LearningClass,
} from "@/lib/learning-types";
import { type RemoveTarget } from "@/features/class-detail/class-detail.shared";
import { buildManagerFolderView } from "./manager-folder-view";
import { ManagerFolderSidebar } from "./manager-folder-sidebar";

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
    email?: string | null;
    avatarUrl?: string;
  }>;
  primaryInstructor?: {
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string | null;
    avatarUrl?: string;
  };
  learnerPagination: ReturnType<typeof usePagination<ClassRoster["enrollments"][number]>>;
  assignInstructor: (event: React.FormEvent) => Promise<void>;
  transferPrimary: (event: React.FormEvent) => Promise<void>;
  enrollLearner: (event: React.FormEvent) => Promise<void>;
  importEnrollments: (event: React.FormEvent) => Promise<void>;
  removeMember: (event: React.FormEvent) => Promise<void>;
  activate: () => Promise<void>;
}

// Dùng chung ô tìm kiếm của ba danh sách bài tập, tài liệu và bài giảng.
function ManagerFolderSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
      />
      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

/** Không gian làm việc quản trị chi tiết lớp dành riêng cho Quản lý trung tâm. */
export function ManagerClassWorkspace({
  item,
  course,
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
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequest = useRef(0);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Trạng thái cài đặt lớp học
  const [settingsForm, setSettingsForm] = useState({
    name: item.name,
    capacity: item.capacity ?? 40,
    description: "description" in item && typeof item.description === "string" ? item.description : "",
    allowPeerGradeViewing: item.allowPeerGradeViewing ?? false,
  });

  // Trạng thái xem lịch học & xác nhận kích hoạt/đóng lớp học
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");
  const [confirmActivateOpen, setConfirmActivateOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [closingClass, setClosingClass] = useState(false);
  const [closeReadiness, setCloseReadiness] = useState<ClassClosureReadiness | null>(readiness);
  const [closeReadinessLoading, setCloseReadinessLoading] = useState(false);
  const [closeReadinessError, setCloseReadinessError] = useState("");
  const closeReadinessRequestRef = useRef(0);

  // Trạng thái tab Bài tập (chuẩn giao diện học sinh)
  const [selectedAssignmentFolder, setSelectedAssignmentFolder] = useState<string>("__ALL__");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("asg-1");

  // Trạng thái tab Bài giảng (chuẩn giao diện học sinh)
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");
  const [lectureSearch, setLectureSearch] = useState("");
  const [selectedLectureId, setSelectedLectureId] = useState<string>("lec-1");

  // Trạng thái tab Tài liệu (chuẩn giao diện học sinh)
  const [selectedMaterialFolder, setSelectedMaterialFolder] = useState<string>("__ALL__");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("mat-1");

  // Đồng bộ lại khi prop item thay đổi
  useEffect(() => {
    setCurrentClass(item);
    setSettingsForm({
      name: item.name,
      capacity: item.capacity ?? 40,
      description: "description" in item && typeof item.description === "string" ? item.description : "",
      allowPeerGradeViewing: item.allowPeerGradeViewing ?? false,
    });
  }, [item]);

  useEffect(() => () => {
    copyRequest.current += 1;
    closeReadinessRequestRef.current += 1;
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);

  // Cập nhật điều kiện đóng lớp từ máy chủ mỗi khi mở hộp thoại xác nhận.
  const refreshCloseReadiness = async () => {
    const requestId = ++closeReadinessRequestRef.current;
    setCloseReadinessLoading(true);
    setCloseReadinessError("");
    try {
      const latest = await apiRequest<ClassClosureReadiness>(
        `/manager/classes/${item.id}/closure-readiness`,
      );
      if (requestId === closeReadinessRequestRef.current) setCloseReadiness(latest);
    } catch (error) {
      if (requestId === closeReadinessRequestRef.current) {
        setCloseReadiness(null);
        setCloseReadinessError(error instanceof Error ? error.message : "Không kiểm tra được điều kiện đóng lớp.");
      }
    } finally {
      if (requestId === closeReadinessRequestRef.current) setCloseReadinessLoading(false);
    }
  };

  // Mở xác nhận và bỏ dữ liệu cũ trong lúc điều kiện đóng lớp được làm mới.
  const openCloseConfirmation = () => {
    setCloseReadiness(readiness);
    setConfirmCloseOpen(true);
    void refreshCloseReadiness();
  };

  // Hủy yêu cầu kiểm tra đang chạy khi người dùng đóng hộp thoại.
  const dismissCloseConfirmation = () => {
    if (closingClass) return;
    closeReadinessRequestRef.current += 1;
    setCloseReadinessLoading(false);
    setConfirmCloseOpen(false);
  };

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
  const handleCopyLink = async () => {
    const request = ++copyRequest.current;
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = null;
    setCopiedLink(false);
    try {
      await copyTextToClipboard(window.location.href);
      if (request !== copyRequest.current) return;
      setCopiedLink(true);
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null;
        setCopiedLink(false);
      }, 2000);
    } catch {
      if (request === copyRequest.current) notify("Không thể sao chép liên kết lớp học.", "error");
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
          allowPeerGradeViewing: settingsForm.allowPeerGradeViewing,
        }),
      });
      setCurrentClass((prev) => ({
        ...prev,
        ...updated,
        name: settingsForm.name.trim(),
        capacity: Number(settingsForm.capacity),
        description: settingsForm.description.trim(),
        allowPeerGradeViewing: settingsForm.allowPeerGradeViewing,
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
              onClick={openCloseConfirmation}
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
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  Tổng quan lớp học
                </h2>
                <p className="text-xs text-slate-500">
                  Thông tin định danh và thông số cơ bản của lớp học.
                </p>
              </div>

              {/* Danh sách thông tin 1 cột, nhãn và giá trị liền cạnh nhau */}
              <div className="space-y-1 text-xs divide-y divide-slate-100 dark:divide-slate-800/80">
                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Mã lớp:
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    {item.code}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Tên lớp:
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {currentClass.name}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Khối lớp:
                  </span>
                  <span className="font-bold text-purple-600 dark:text-purple-400">
                    {classGrade ? `Khối ${classGrade}` : "Chưa xác định"}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Môn học:
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {classSubject ? `Môn ${classSubject}` : (course?.name || "Chưa xác định")}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Sức chứa:
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {currentClass.capacity ?? 40} học viên
                  </span>
                </div>

                <div className="flex items-baseline gap-3 py-2">
                  <span className="w-28 sm:w-32 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                    Mô tả:
                  </span>
                  <span className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {("description" in currentClass && typeof currentClass.description === "string" ? currentClass.description.trim() : "") || "Chưa có mô tả cho lớp học này."}
                  </span>
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

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* 1. Đổi: Bổ nhiệm làm GV chính */}
                            {!isPrimary ? (
                              <button
                                type="button"
                                title="Bổ nhiệm làm GV chính"
                                onClick={() =>
                                  setTransferTarget({
                                    id: ins.instructorId,
                                    name: ins.displayName || "Giảng viên",
                                  })
                                }
                                className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              >
                                <Repeat2 size={16} />
                              </button>
                            ) : (
                              <div className="w-8" />
                            )}

                            {/* 2. Chat: Nhắn tin trực tiếp */}
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenChatWithMember({
                                  id: ins.instructorId,
                                  name: ins.displayName || "Giảng viên",
                                  role: "INSTRUCTOR",
                                })
                              }
                              className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              title={`Nhắn tin với ${ins.displayName || "Giảng viên"}`}
                            >
                              <MessageCircle size={16} />
                            </button>

                            {/* 3. Xóa: Gỡ giảng viên khỏi lớp */}
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
                              className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 size={16} />
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
                    Theo dõi và quản lý các ca học, thời khóa biểu của lớp này.
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

                  <button
                    type="button"
                    onClick={() => notify("Chức năng thêm buổi học mới đã sẵn sàng.", "info")}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
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
                            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                          >
                            Vào phòng
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* CHẾ ĐỘ DẠNG THÁNG: HIỂN THỊ DẠNG DANH SÁCH */
                <ClassScheduleMonthList
                  rows={[
                    { date: "26/10/2026", time: "19:30 - 21:00", title: "Buổi 01: Nhập môn & Hướng dẫn phương pháp học", status: "Đã diễn ra" },
                    { date: "28/10/2026", time: "19:30 - 21:00", title: "Buổi 02: Phương trình & Giải thuật cơ bản", status: "Hôm nay" },
                    { date: "30/10/2026", time: "19:30 - 21:00", title: "Buổi 03: Chữa bài tập chuyên đề và Kiểm tra 15p", status: "Sắp diễn ra" },
                    { date: "02/11/2026", time: "19:30 - 21:00", title: "Buổi 04: Chuyên đề nâng cao và Vận dụng thực tế", status: "Sắp diễn ra" },
                  ]}
                  onJoin={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
                />
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 6: BÀI TẬP (MASTER-DETAIL 3 CỘT CHUẨN HỌC SINH - CHỈ XEM) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "assignments" && (() => {
            const rawAssignments = [
              {
                id: "asg-1",
                title: "Bài tập rèn luyện tuần 1: Đại số & Hàm số bậc hai",
                folder: "Chương 1: Hàm số & Đồ thị",
                type: "Trắc nghiệm & Tự luận",
                duration: "45 phút",
                questionsCount: 25,
                dueDate: "23:59 - 30/10/2026",
                submittedCount: activeEnrollments.length > 0 ? Math.floor(activeEnrollments.length * 0.8) : 18,
                totalCount: activeEnrollments.length || 24,
                avgScore: 8.2,
                status: "Đang mở",
                maxScore: 10,
                attemptsLimit: 1,
                method: "Lấy điểm cao nhất",
                createdAt: "24/10/2026",
              },
              {
                id: "asg-2",
                title: "Bài kiểm tra định kỳ 15 phút - Chương 1",
                folder: "Chương 1: Hàm số & Đồ thị",
                type: "Trắc nghiệm tự động",
                duration: "15 phút",
                questionsCount: 15,
                dueDate: "21:00 - 02/11/2026",
                submittedCount: 0,
                totalCount: activeEnrollments.length || 24,
                avgScore: null,
                status: "Sắp diễn ra",
                maxScore: 10,
                attemptsLimit: 1,
                method: "Lần làm đầu tiên",
                createdAt: "26/10/2026",
              },
              {
                id: "asg-3",
                title: "Phiếu khảo sát và đánh giá năng lực đầu khóa",
                folder: "Khảo sát đầu năm",
                type: "Phiếu đánh giá",
                duration: "30 phút",
                questionsCount: 20,
                dueDate: "23:59 - 25/10/2026",
                submittedCount: activeEnrollments.length || 24,
                totalCount: activeEnrollments.length || 24,
                avgScore: 7.5,
                status: "Đã kết thúc",
                maxScore: 10,
                attemptsLimit: 1,
                method: "Đánh giá chung",
                createdAt: "20/10/2026",
              },
              {
                id: "asg-4",
                title: "Bài tập nâng cao: Bất phương trình chứa căn thức",
                folder: "Chương 2: Bất phương trình",
                type: "Tự luận rèn luyện",
                duration: "60 phút",
                questionsCount: 10,
                dueDate: "23:59 - 05/11/2026",
                submittedCount: activeEnrollments.length > 0 ? Math.floor(activeEnrollments.length * 0.25) : 6,
                totalCount: activeEnrollments.length || 24,
                avgScore: 8.8,
                status: "Đang mở",
                maxScore: 10,
                attemptsLimit: 2,
                method: "Lấy điểm cao nhất",
                createdAt: "27/10/2026",
              },
            ];

            const { folders, counts, filtered, active: activeAsg } = buildManagerFolderView(
              rawAssignments, selectedAssignmentFolder, assignmentSearch, selectedAssignmentId,
            );

            return (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
                {/* Header danh mục bài tập */}
                <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Bài tập ({currentClass.name})
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Danh sách bài tập và đề kiểm tra phân bổ theo cấu trúc thư mục (Chế độ xem dành cho Quản trị viên).
                    </p>
                  </div>
                </div>

                {/* Khung 3 cột Master-Detail */}
                <div className="flex flex-col lg:flex-row min-h-[540px]">
                  {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                  <ManagerFolderSidebar
                    title="Thư mục"
                    allLabel="Tất cả bài tập"
                    totalCount={rawAssignments.length}
                    folders={folders}
                    counts={counts}
                    selectedFolder={selectedAssignmentFolder}
                    onSelectFolder={setSelectedAssignmentFolder}
                    tone="blue"
                  />


                  {/* CỘT 2: DANH SÁCH BÀI TẬP (FLEX-1) */}
                  <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                    <ManagerFolderSearch value={assignmentSearch} onChange={setAssignmentSearch} placeholder="Tìm kiếm bài tập..." />

                    <div className="space-y-2">
                      {filtered.length === 0 ? (
                        <div className="py-12 text-center space-y-2">
                          <Folder size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                          <p className="text-xs text-slate-400">Không có bài tập nào trong thư mục này</p>
                        </div>
                      ) : (
                        filtered.map((assign) => {
                          const isSelected = activeAsg?.id === assign.id;
                          const completionRate = Math.round((assign.submittedCount / assign.totalCount) * 100);
                          return (
                            <div
                              key={assign.id}
                              onClick={() => setSelectedAssignmentId(assign.id)}
                              className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-sky-50/85 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500 shadow-2xs"
                                  : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                                <div className="size-8 rounded-lg bg-blue-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                                  W
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                    {assign.title}
                                  </strong>
                                  <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{ width: `${completionRate}%` }}
                                    />
                                  </div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {assign.type} · Đã nộp {assign.submittedCount}/{assign.totalCount} ({completionRate}%)
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  assign.status === "Đang mở"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                    : assign.status === "Sắp diễn ra"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                }`}>
                                  {assign.status}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* CỘT 3: CHI TIẾT BÀI TẬP DÀNH CHO QUẢN TRỊ (~320px) */}
                  <div className="w-full lg:w-80 shrink-0 p-4 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                    {activeAsg ? (
                      <div className="space-y-4">
                        {/* Huy hiệu trạng thái */}
                        <div className="rounded-xl py-2 px-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/50 flex items-center justify-between">
                          <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Trạng thái:</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            activeAsg.status === "Đang mở"
                              ? "bg-emerald-600 text-white"
                              : activeAsg.status === "Sắp diễn ra"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-600 text-white"
                          }`}>
                            {activeAsg.status}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {activeAsg.title}
                          </h4>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">
                            Thư mục: {activeAsg.folder}
                          </span>
                        </div>

                        {/* Bảng thông số chi tiết */}
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Thời lượng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeAsg.duration}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Số lượng câu hỏi</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeAsg.questionsCount} câu
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Hạn nộp</span>
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              {activeAsg.dueDate}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Tiến độ nộp bài</span>
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {activeAsg.submittedCount}/{activeAsg.totalCount} học viên
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Điểm trung bình lớp</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {activeAsg.avgScore ? `${activeAsg.avgScore}/10` : "Chưa có"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Ngày tạo</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeAsg.createdAt}
                            </span>
                          </div>
                        </div>

                        {/* Nút hành động xem đề bài dành cho quản trị */}
                        <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => notify(`Đang mở xem trước đề bài: ${activeAsg.title}`, "info")}
                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                          >
                            <Eye size={14} />
                            <span>Xem trước đề bài</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-slate-400">
                        Chọn một bài tập để xem chi tiết
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ------------------------------------------------------------- */}
          {/* TAB 7: TÀI LIỆU (MASTER-DETAIL 3 CỘT CHUẨN HỌC SINH - CHỈ XEM) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "materials" && (() => {
            const rawMaterials = [
              {
                id: "mat-1",
                title: "Giáo trình bài giảng lý thuyết tuần 1.pdf",
                folder: "Chương 1: Giáo trình & Đề cương",
                fileType: "pdf",
                size: "2.4 MB",
                pageCount: 28,
                downloadsCount: 42,
                uploadedAt: "24/10/2026",
                author: primaryInstructor?.displayName || "Giảng viên phụ trách",
              },
              {
                id: "mat-2",
                title: "Slide trình chiếu trực quan chương 1.pptx",
                folder: "Chương 1: Giáo trình & Đề cương",
                fileType: "pptx",
                size: "8.1 MB",
                pageCount: 35,
                downloadsCount: 38,
                uploadedAt: "25/10/2026",
                author: primaryInstructor?.displayName || "Giảng viên phụ trách",
              },
              {
                id: "mat-3",
                title: "Phiếu bài tập rèn luyện kỹ năng số 01.docx",
                folder: "Chương 2: Bài tập bổ trợ",
                fileType: "doc",
                size: "450 KB",
                pageCount: 6,
                downloadsCount: 29,
                uploadedAt: "26/10/2026",
                author: primaryInstructor?.displayName || "Giảng viên phụ trách",
              },
              {
                id: "mat-4",
                title: "Bảng tổng hợp công thức giải nhanh Toán học.pdf",
                folder: "Tài liệu công thức nhanh",
                fileType: "pdf",
                size: "1.2 MB",
                pageCount: 12,
                downloadsCount: 55,
                uploadedAt: "27/10/2026",
                author: primaryInstructor?.displayName || "Giảng viên phụ trách",
              },
            ];

            const { folders, counts, filtered, active: activeMat } = buildManagerFolderView(
              rawMaterials, selectedMaterialFolder, materialSearch, selectedMaterialId,
            );

            return (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
                {/* Header danh mục tài liệu */}
                <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Tài liệu ({currentClass.name})
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục (Chế độ xem dành cho Quản trị viên).
                    </p>
                  </div>
                </div>

                {/* Khung 3 cột Master-Detail */}
                <div className="flex flex-col lg:flex-row min-h-[540px]">
                  {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                  <ManagerFolderSidebar
                    title="Thư mục"
                    allLabel="Tất cả tài liệu"
                    totalCount={rawMaterials.length}
                    folders={folders}
                    counts={counts}
                    selectedFolder={selectedMaterialFolder}
                    onSelectFolder={setSelectedMaterialFolder}
                    tone="blue"
                  />


                  {/* CỘT 2: DANH SÁCH TÀI LIỆU (FLEX-1) */}
                  <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                    <ManagerFolderSearch value={materialSearch} onChange={setMaterialSearch} placeholder="Tìm kiếm tài liệu..." />

                    <div className="space-y-2">
                      {filtered.length === 0 ? (
                        <div className="py-12 text-center space-y-2">
                          <Folder size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                          <p className="text-xs text-slate-400">Không có tài liệu nào trong thư mục này</p>
                        </div>
                      ) : (
                        filtered.map((mat) => {
                          const isSelected = activeMat?.id === mat.id;
                          return (
                            <div
                              key={mat.id}
                              onClick={() => setSelectedMaterialId(mat.id)}
                              className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-500 shadow-2xs"
                                  : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                                <div className={`size-8 rounded-lg text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs ${
                                  mat.fileType === "pdf"
                                    ? "bg-rose-600"
                                    : mat.fileType === "xlsx"
                                    ? "bg-emerald-600"
                                    : mat.fileType === "pptx"
                                    ? "bg-amber-600"
                                    : "bg-blue-600"
                                }`}>
                                  {mat.fileType}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                    {mat.title}
                                  </strong>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {mat.size} · {mat.pageCount} trang · Tải lên {mat.uploadedAt}
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                  {mat.downloadsCount} lượt tải
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* CỘT 3: CHI TIẾT TÀI LIỆU DÀNH CHO QUẢN TRỊ (~320px) */}
                  <div className="w-full lg:w-80 shrink-0 p-4 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                    {activeMat ? (
                      <div className="space-y-4">
                        {/* Banner đen bo góc */}
                        <div className="rounded-xl bg-slate-800 text-white py-2.5 px-4 flex items-center justify-center gap-2 shadow-sm">
                          <FileText size={16} className="text-emerald-400" />
                          <span className="text-sm font-bold">
                            {activeMat.fileType.toUpperCase()} · {activeMat.size}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {activeMat.title}
                          </h4>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">
                            Thư mục: {activeMat.folder}
                          </span>
                        </div>

                        {/* Bảng thông số chi tiết */}
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Định dạng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100 uppercase">
                              {activeMat.fileType}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Dung lượng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeMat.size}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Số trang</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeMat.pageCount} trang
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Lượt tải</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeMat.downloadsCount} lượt
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Người tải lên</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[140px]">
                              {activeMat.author}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Ngày tải lên</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeMat.uploadedAt}
                            </span>
                          </div>
                        </div>

                        {/* Nút thao tác: Xem trước và Tải xuống */}
                        <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => notify(`Đang mở xem trước tài liệu: ${activeMat.title}`, "info")}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <Eye size={13} />
                            <span>Xem trước</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => notify(`Đang tải file: ${activeMat.title}`, "success")}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            <Download size={13} />
                            <span>Tải xuống</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-slate-400">
                        Chọn một tài liệu để xem chi tiết
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ------------------------------------------------------------- */}
          {/* TAB 8: BÀI GIẢNG (MASTER-DETAIL 3 CỘT CHUẨN HỌC SINH - CHỈ XEM) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "lectures" && (() => {
            const rawLectures = [
              {
                id: "lec-1",
                title: "Bài 01: Giới thiệu tổng quan và phương pháp tiếp cận",
                folder: "Chương 1: Kiến thức nền tảng",
                fileType: "mp4",
                duration: "45:20",
                teacher: primaryInstructor?.displayName || "Giảng viên phụ trách",
                views: 28,
                uploadedAt: "24/10/2026",
                progressPercent: 85,
                description: "Bài học cung cấp nền tảng kiến thức cơ bản về phương pháp giải toán, làm quen với hệ thống học tập trực tuyến và lộ trình học tập toàn khóa.",
              },
              {
                id: "lec-2",
                title: "Bài 02: Phân tích mô hình dữ liệu và giải thuật cốt lõi",
                folder: "Chương 1: Kiến thức nền tảng",
                fileType: "mp4",
                duration: "52:10",
                teacher: primaryInstructor?.displayName || "Giảng viên phụ trách",
                views: 24,
                uploadedAt: "26/10/2026",
                progressPercent: 70,
                description: "Đi sâu vào phân tích các dạng bài tập trọng tâm, phương pháp tư duy suy luận logic và các bài toán mẫu kinh điển của chuyên đề.",
              },
              {
                id: "lec-3",
                title: "Bài 03: Hướng dẫn thực hành và giải đáp thắc mắc chuyên sâu",
                folder: "Chương 2: Ứng dụng thực tế",
                fileType: "mp4",
                duration: "38:45",
                teacher: primaryInstructor?.displayName || "Giảng viên phụ trách",
                views: 19,
                uploadedAt: "28/10/2026",
                progressPercent: 45,
                description: "Giải quyết các lỗi sai học viên thường gặp phải khi làm bài thi, sửa trực tiếp các bài tập khó và câu hỏi mở rộng.",
              },
            ];

            const { folders, counts, filtered, active: activeLec } = buildManagerFolderView(
              rawLectures, selectedLectureFolder, lectureSearch, selectedLectureId,
            );

            return (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
                {/* Header danh mục bài giảng */}
                <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Bài giảng ({currentClass.name})
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Video bài học chuyên đề, slide trình chiếu và audio ghi âm theo chương mục (Chế độ xem dành cho Quản trị viên).
                    </p>
                  </div>
                </div>

                {/* Khung 3 cột Master-Detail */}
                <div className="flex flex-col lg:flex-row min-h-[540px]">
                  {/* CỘT 1: CÂY CHUYÊN ĐỀ (~220px) */}
                  <ManagerFolderSidebar
                    title="Chuyên đề"
                    allLabel="Tất cả bài giảng"
                    totalCount={rawLectures.length}
                    folders={folders}
                    counts={counts}
                    selectedFolder={selectedLectureFolder}
                    onSelectFolder={setSelectedLectureFolder}
                    tone="purple"
                  />


                  {/* CỘT 2: DANH SÁCH BÀI GIẢNG (FLEX-1) */}
                  <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                    <ManagerFolderSearch value={lectureSearch} onChange={setLectureSearch} placeholder="Tìm kiếm bài giảng..." />

                    <div className="space-y-2">
                      {filtered.length === 0 ? (
                        <div className="py-12 text-center space-y-2">
                          <Video size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                          <p className="text-xs text-slate-400">Không có bài giảng nào trong thư mục này</p>
                        </div>
                      ) : (
                        filtered.map((lec) => {
                          const isSelected = activeLec?.id === lec.id;
                          return (
                            <div
                              key={lec.id}
                              onClick={() => setSelectedLectureId(lec.id)}
                              className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-purple-50/70 dark:bg-purple-950/30 border-purple-400 dark:border-purple-500 shadow-2xs"
                                  : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-800"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                                <div className="size-8 rounded-lg bg-purple-600 text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs">
                                  {lec.fileType}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                    {lec.title}
                                  </strong>
                                  <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-purple-500 rounded-full"
                                      style={{ width: `${lec.progressPercent}%` }}
                                    />
                                  </div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {lec.duration} · GV: {lec.teacher}
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">
                                  {lec.progressPercent}% đã xem
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* CỘT 3: CHI TIẾT BÀI GIẢNG DÀNH CHO QUẢN TRỊ (~320px) */}
                  <div className="w-full lg:w-80 shrink-0 p-5 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                    {activeLec ? (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 block">
                            Bài giảng chuyên đề
                          </span>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {activeLec.title}
                          </h4>
                        </div>

                        {/* Mô tả tóm tắt */}
                        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-1 shadow-2xs">
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                            Tóm tắt nội dung
                          </span>
                          <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
                            {activeLec.description}
                          </p>
                        </div>

                        {/* Bảng thông số */}
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Giảng viên</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[140px]">
                              {activeLec.teacher}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Thời lượng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeLec.duration}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Tổng lượt xem lớp</span>
                            <span className="font-semibold text-purple-600 dark:text-purple-400">
                              {activeLec.views} lượt xem
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Ngày đăng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeLec.uploadedAt}
                            </span>
                          </div>
                        </div>

                        {/* Nút Xem bài giảng */}
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => notify(`Đang mở xem bài giảng: ${activeLec.title}`, "info")}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            <Play size={14} />
                            <span>Xem bài giảng</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-slate-400">
                        Chọn một bài giảng để xem thông tin
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
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

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-sky-600"
              checked={settingsForm.allowPeerGradeViewing}
              onChange={(event) => setSettingsForm((current) => ({ ...current, allowPeerGradeViewing: event.target.checked }))}
            />
            <span className="space-y-1">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Cho phép học sinh xem điểm của nhau</span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">Học sinh trong lớp có thể xem bảng điểm chung. Chỉ giáo viên được cập nhật điểm.</span>
            </span>
          </label>

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
        onClose={dismissCloseConfirmation}
        title="Xác nhận đóng lớp học"
        description={`Bạn có chắc chắn muốn đóng lớp học "${currentClass.name}"?`}
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Sau khi đóng, lớp học sẽ chuyển sang trạng thái lưu trữ (CLOSED). Học viên sẽ không thể nộp bài tập mới hoặc thực hiện các hoạt động tính điểm.
          </p>
          {closeReadinessLoading ? (
            <p role="status" className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Đang kiểm tra bài thi, bài tập, buổi học và điểm danh còn mở...
            </p>
          ) : closeReadiness?.eligible ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              Lớp đã đủ điều kiện đóng và lưu trữ.
            </p>
          ) : closeReadiness && closeReadiness.blockers.length > 0 ? (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Cần xử lý trước khi đóng lớp:</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-300">
                {closeReadiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
              <a href={`/class-lifecycle?classId=${encodeURIComponent(item.id)}`} className="mt-3 inline-block text-xs font-semibold text-amber-900 underline underline-offset-2 dark:text-amber-200">
                Xem chi tiết và xử lý điều kiện đóng lớp
              </a>
            </div>
          ) : null}
          {closeReadinessError && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              Không kiểm tra được điều kiện: {closeReadinessError}. Hệ thống vẫn sẽ kiểm tra lại khi xác nhận.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={dismissCloseConfirmation} type="button" disabled={closingClass}>
              Hủy
            </Button>
            <Button
              disabled={closeReadinessLoading || (closeReadiness !== null && !closeReadiness.eligible)}
              loading={closingClass}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={async () => {
                setClosingClass(true);
                try {
                  await apiRequest(`/manager/classes/${item.id}/close`, {
                    method: "POST",
                    body: JSON.stringify({
                      closeReason: "Kết thúc khóa học",
                      archivePolicy: "STANDARD_RETENTION",
                    }),
                  });
                  setCurrentClass((prev) => ({ ...prev, status: "CLOSED" }));
                  notify("Đã đóng lớp học thành công.", "success");
                  closeReadinessRequestRef.current += 1;
                  setCloseReadinessLoading(false);
                  setConfirmCloseOpen(false);
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Đóng lớp thất bại.", "error");
                  void refreshCloseReadiness();
                } finally {
                  setClosingClass(false);
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
