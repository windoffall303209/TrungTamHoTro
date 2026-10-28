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
  MessageCircle,
  MessageSquare,
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
  | "materials";

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
    allowLateEnrollment: item.allowLateEnrollment ?? false,
    description: (item as any).description || "",
  });

  // Trạng thái thư mục tài liệu
  const [selectedFolder, setSelectedFolder] = useState<string>("__ALL__");

  // Đồng bộ lại khi prop item thay đổi
  useEffect(() => {
    setCurrentClass(item);
    setSettingsForm({
      name: item.name,
      capacity: item.capacity ?? 40,
      allowLateEnrollment: item.allowLateEnrollment ?? false,
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
          allowLateEnrollment: settingsForm.allowLateEnrollment,
        }),
      });
      setCurrentClass((prev) => ({
        ...prev,
        ...updated,
        name: settingsForm.name.trim(),
        capacity: Number(settingsForm.capacity),
        allowLateEnrollment: settingsForm.allowLateEnrollment,
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
    { id: "schedule", label: "Lịch học & Ca dạy", icon: CalendarDays },
    { id: "materials", label: "Học liệu & Bài tập", icon: BookOpenCheck },
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
          <StatusBadge status={item.status} />
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

          {item.status === "DRAFT" && (
            <Button
              loading={saving}
              onClick={() => void activate()}
              className="h-8 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 size={14} />
              <span>Kích hoạt lớp</span>
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
            <div className="space-y-5">
              {/* 4 Thẻ KPI thông số lớp học */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Sĩ số lớp</span>
                    <Users size={16} className="text-blue-500" />
                  </div>
                  <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                    {item.learnerIds.length}
                    <span className="text-xs font-normal text-slate-400 ml-1">/{currentClass.capacity}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {currentClass.allowLateEnrollment ? "Cho ghi danh muộn" : "Đã khóa ghi danh"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Giảng viên</span>
                    <UserCheck size={16} className="text-indigo-500" />
                  </div>
                  <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                    {instructors.length}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {primaryInstructor ? "Đã có GV chính" : "Chưa có GV chính"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Khai giảng</span>
                    <Calendar size={16} className="text-emerald-500" />
                  </div>
                  <p className="mt-2 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {new Date(item.startAt).toLocaleDateString(activeLocale())}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Bế giảng: {new Date(item.endAt).toLocaleDateString(activeLocale())}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Trạng thái</span>
                    <Clock size={16} className="text-amber-500" />
                  </div>
                  <div className="mt-2">
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 font-mono">
                    {item.timezone}
                  </p>
                </div>
              </div>

              {/* 2 Card chi tiết: Thông tin lớp học & Phân cấp môn học K-12 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                      Thông tin lớp học
                    </span>
                    <button
                      type="button"
                      onClick={() => setSettingsModalOpen(true)}
                      className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                    >
                      Sửa cài đặt
                    </button>
                  </div>
                  <div className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-slate-800">
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-500">Mã lớp học:</span>
                      <strong className="font-mono text-slate-900 dark:text-slate-100">{item.code}</strong>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-500">Tên lớp học:</span>
                      <strong className="text-slate-900 dark:text-slate-100">{currentClass.name}</strong>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-500">Học kỳ:</span>
                      <strong className="text-slate-900 dark:text-slate-100">{item.term}</strong>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-500">Sức chứa tối đa:</span>
                      <strong className="text-slate-900 dark:text-slate-100 tabular-nums">{currentClass.capacity} học viên</strong>
                    </div>
                    {(currentClass as any).description && (
                      <div className="py-1.5">
                        <span className="text-slate-500 block mb-1">Mô tả lớp học:</span>
                        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                          {(currentClass as any).description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                      Phân cấp môn học K-12
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      K-12 Chuẩn
                    </span>
                  </div>
                  {course ? (
                    <div className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-slate-800">
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">Môn học gốc:</span>
                        <strong className="text-slate-900 dark:text-slate-100">{course.name} ({course.code})</strong>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">Khối lớp:</span>
                        <span className="font-bold text-purple-600 dark:text-purple-400">
                          {classGrade ? `Khối ${classGrade}` : "Chưa gắn khối"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">Môn học:</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          {classSubject ? `Môn ${classSubject}` : "Chưa phân môn"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">Phiên bản snapshot:</span>
                        <span className="font-semibold text-sky-600 dark:text-sky-400">
                          v{item.courseVersion}
                        </span>
                      </div>
                      <div className="py-1.5">
                        <span className="text-slate-500 block mb-1">Mô tả môn học:</span>
                        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                          {course.description}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Chưa liên kết môn học chuẩn.</p>
                  )}
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
          {/* TAB 5: LỊCH HỌC & CA DẠY (Đồng bộ theo giao diện giáo viên)    */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "schedule" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                    Lịch học của lớp ({currentClass.name})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Quản lý các ca học, phòng học trực tuyến và điểm danh
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-2xs"
                  >
                    <CalendarDays size={14} />
                    <span>Đối soát điểm danh</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => notify("Chức năng thêm buổi học mới đã sẵn sàng.", "info")}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus size={15} />
                    <span>Thêm buổi học mới</span>
                  </button>
                </div>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { title: "Buổi 1: Giới thiệu chung & Phổ biến quy định", date: "Thứ Hai, 27/10/2026", time: "18:00 - 19:30", status: "COMPLETED" },
                  { title: "Buổi 2: Phương trình & Giải thuật cơ bản", date: "Thứ Tư, 29/10/2026", time: "18:00 - 19:30", status: "SCHEDULED" },
                  { title: "Buổi 3: Luyện tập chuyên sâu & Giải đề thi", date: "Thứ Sáu, 31/10/2026", time: "18:00 - 19:30", status: "SCHEDULED" },
                ].map((s, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4.5 shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.status === "COMPLETED"
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          : "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
                      }`}>
                        {s.status === "COMPLETED" ? "Đã diễn ra" : "Sắp tới"}
                      </span>
                      <Clock size={14} className="text-slate-400" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{s.title}</h3>
                    <div className="text-xs text-slate-500 space-y-1">
                      <div>📅 {s.date}</div>
                      <div>⏰ {s.time}</div>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
                        className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Vào phòng
                      </button>
                      <Link
                        href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-center"
                      >
                        Điểm danh
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 6: HỌC LIỆU & BÀI TẬP (Đồng bộ theo giao diện giáo viên)   */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "materials" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              {/* Header tiêu đề danh mục */}
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Học liệu & Bài tập ({currentClass.name})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục chuyên đề.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/materials?classId=${encodeURIComponent(item.id)}`}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition shadow-2xs"
                  >
                    Kho tài liệu
                  </Link>
                  <Link
                    href={`/academic?classId=${encodeURIComponent(item.id)}`}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition shadow-2xs"
                  >
                    Bài tập & Đề thi
                  </Link>
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

                {/* CỘT 2: DANH SÁCH HỌC LIỆU VÀ BÀI TẬP */}
                <div className="flex-1 min-w-0 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Tài liệu trong thư mục ({selectedFolder === "__ALL__" ? "Tất cả" : "Chuyên đề"})
                  </div>
                  <div className="space-y-2">
                    {[
                      { title: "Giáo trình bài giảng lý thuyết tuần 1.pdf", type: "PDF", size: "2.4 MB", date: "24/10/2026", author: "Vũ Đức Minh" },
                      { title: "Slide trình chiếu trực quan chương 1.pptx", type: "SLIDE", size: "8.1 MB", date: "25/10/2026", author: "Vũ Đức Minh" },
                      { title: "Phiếu bài tập rèn luyện kỹ năng số 01.docx", type: "DOC", size: "450 KB", date: "26/10/2026", author: "Vũ Đức Minh" },
                      { title: "Video hướng dẫn giải bài mẫu thực hành.mp4", type: "VIDEO", size: "45 MB", date: "26/10/2026", author: "Vũ Đức Minh" },
                    ].map((mat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition bg-white dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                            {mat.type === "VIDEO" ? <Video size={16} /> : <FileText size={16} />}
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

          <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              checked={settingsForm.allowLateEnrollment}
              className="size-5 accent-sky-600"
              onChange={(e) => setSettingsForm({ ...settingsForm, allowLateEnrollment: e.target.checked })}
              type="checkbox"
            />
            Cho phép ghi danh sau ngày khai giảng
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
