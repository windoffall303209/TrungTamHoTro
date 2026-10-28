"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  GraduationCap,
  History,
  Info,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Plus,
  Repeat2,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge } from "@/components/ui";
import { UserPicker } from "@/components/user-picker";
import { UserAvatar } from "@/components/user-avatar";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { activeLocale } from "@/i18n/runtime";
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
  | "materials"
  | "lifecycle";

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

// Không gian làm việc chuẩn mực 2 cột dành riêng cho Quản lý trung tâm
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
  historyPagination,
  assignInstructor,
  transferPrimary,
  enrollLearner,
  importEnrollments,
  removeMember,
  activate,
}: ManagerClassWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ManagerSubTab>("overview");
  const [copiedLink, setCopiedLink] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const classGrade = item.grade ?? course?.grade;
  const classSubject = item.subject ?? course?.subject;

  // Sao chép liên kết lớp học vào bộ nhớ tạm
  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const navMenuItems: Array<{
    id: ManagerSubTab;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { id: "overview", label: "Tổng quan & KPI", icon: LayoutDashboard },
    { id: "feed", label: "Bảng tin lớp học", icon: MessageSquare },
    {
      id: "instructors",
      label: "Giảng viên & Trợ giảng",
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
    { id: "lifecycle", label: "Vòng đời & Đóng lớp", icon: Archive },
  ];

  const capacityPercent = Math.min(
    100,
    Math.round(((item.learnerIds.length || activeEnrollments.length) / (item.capacity || 40)) * 100)
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* ========================================================= */}
      {/* HEADER NGANG LỚP HỌC (Hero Banner thông tin tổng quan)     */}
      {/* ========================================================= */}
      <section className="mb-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-7 shadow-lg relative overflow-hidden">
        {/* Glow hiệu ứng trang trí */}
        <div className="absolute -right-12 -bottom-12 size-56 rounded-full bg-blue-500/15 blur-3xl pointer-events-none" />
        <div className="absolute right-1/3 -top-12 size-40 rounded-full bg-indigo-500/15 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
          {/* Cột trái: Nhận diện & Tiêu đề lớp học */}
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={onBack}
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-xs transition cursor-pointer"
              >
                <ArrowLeft size={13} />
                <span>Danh sách lớp</span>
              </button>
              <span className="text-slate-400 text-xs">/</span>
              <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-mono font-bold tracking-wider uppercase">
                {item.code}
              </span>
              <StatusBadge status={item.status} />
              {classGrade && (
                <span className="px-2.5 py-0.5 rounded-lg bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs font-semibold">
                  Khối {classGrade}
                </span>
              )}
              {classSubject && (
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-semibold">
                  Môn {classSubject}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-lg bg-white/10 text-slate-300 text-xs font-semibold">
                {item.term}
              </span>
            </div>

            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                <span className="grid size-9 sm:size-10 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-sky-400 text-white shadow-md shadow-indigo-500/30 shrink-0">
                  <GraduationCap size={22} />
                </span>
                <span className="truncate">{item.name}</span>
              </h1>
              <p className="mt-1.5 text-xs text-slate-300 flex items-center gap-2 flex-wrap">
                <span>
                  {course?.name ? `Chương trình: ${course.name} (v${item.courseVersion})` : "Lớp học chuẩn K-12"}
                </span>
                <span className="text-slate-500">·</span>
                <span>
                  Khai giảng: {new Date(item.startAt).toLocaleDateString(activeLocale())} — Bế giảng: {new Date(item.endAt).toLocaleDateString(activeLocale())}
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-slate-400 text-[11px]">{item.timezone}</span>
              </p>
            </div>
          </div>

          {/* Cột phải: KPI nhanh & Thao tác của Header ngang */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {/* Quick KPI Sĩ số */}
            <div className="px-4 py-2.5 rounded-2xl bg-white/10 border border-white/10 backdrop-blur-xs text-left min-w-[110px]">
              <span className="text-[10px] text-slate-300 block font-bold uppercase tracking-wider">
                Sĩ số lớp
              </span>
              <p className="text-lg font-black text-white tabular-nums mt-0.5">
                {item.learnerIds.length} <span className="text-xs text-slate-400 font-normal">/{item.capacity}</span>
              </p>
            </div>

            {/* Quick KPI Giảng viên chính */}
            <div className="px-4 py-2.5 rounded-2xl bg-white/10 border border-white/10 backdrop-blur-xs flex items-center gap-3">
              <UserAvatar
                avatarUrl={primaryInstructor?.avatarUrl}
                name={primaryInstructor?.displayName || "Chưa phân công"}
                className="size-9 rounded-full text-xs shrink-0"
              />
              <div className="min-w-0">
                <span className="text-[10px] text-slate-300 block font-bold uppercase tracking-wider">
                  GV Phụ trách
                </span>
                <p className="text-xs font-bold text-white truncate max-w-[130px] mt-0.5">
                  {primaryInstructor?.displayName || "Chưa phân công"}
                </p>
              </div>
            </div>

            {/* Nút tác vụ Header ngang */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-3.5 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer backdrop-blur-xs shadow-xs"
              >
                <Share2 size={14} />
                <span>{copiedLink ? "Đã chép link!" : "Sao chép link"}</span>
              </button>

              {item.status === "DRAFT" && (
                <Button
                  loading={saving}
                  onClick={() => void activate()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-2xl shadow-sm"
                >
                  <CheckCircle2 size={15} />
                  <span>Kích hoạt lớp</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ========================================================= */}
        {/* CỘT 1: THANH DỌC ĐIỀU HƯỚNG VÀ WIDGET TÁC NGHIỆP (280px)  */}
        {/* ========================================================= */}
        <aside className="w-full lg:w-72 shrink-0 space-y-3.5 lg:sticky lg:top-20">
          {/* Card 1: Menu 7 Phân hệ nghiệp vụ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1 mb-1">
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
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
          </div>

          {/* Card 2: Widget Sĩ số & Tỷ lệ lấp đầy (Capacity Progress) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                Năng lực & Sĩ số
              </span>
              <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                {capacityPercent}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Đã ghi danh: <strong className="text-slate-800 dark:text-slate-200">{item.learnerIds.length}</strong></span>
              <span>Tối đa: <strong className="text-slate-800 dark:text-slate-200">{item.capacity}</strong></span>
            </div>
            <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
              {item.allowLateEnrollment ? "✓ Cho phép ghi danh muộn" : "✕ Đã khóa ghi danh muộn"}
            </p>
          </div>

          {/* Card 3: Widget Đội ngũ giảng dạy (Mini Staff List) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                Đội ngũ giảng dạy
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {instructors.length} GV
              </span>
            </div>

            <div className="space-y-2 max-h-36 overflow-y-auto scrollbar-thin">
              {instructors.slice(0, 3).map((ins) => (
                <div key={ins.instructorId} className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <UserAvatar
                    avatarUrl={ins.avatarUrl}
                    name={ins.displayName || "Giảng viên"}
                    className="size-7 rounded-full text-[10px] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                      {ins.displayName || "Giảng viên"}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {ins.role === "PRIMARY" ? "Giảng viên chính" : "Đồng giảng viên"}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setAssignModalOpen(true)}
              className="w-full py-1.5 px-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 text-blue-600 dark:text-blue-400 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <UserPlus size={13} />
              <span>Phân công giảng viên</span>
            </button>
          </div>

          {/* Card 4: Thao tác nhanh cho Quản lý trung tâm */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-2">
            <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide block">
              Thao tác nhanh
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEnrollModalOpen(true)}
                className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-[11px] font-bold transition text-left cursor-pointer border border-slate-100 dark:border-slate-800"
              >
                + Ghi danh
              </button>
              <button
                type="button"
                onClick={() => setBulkModalOpen(true)}
                className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-[11px] font-bold transition text-left cursor-pointer border border-slate-100 dark:border-slate-800"
              >
                + Nhập sỉ
              </button>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("lifecycle")}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-slate-700 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 text-[11px] font-bold transition text-left cursor-pointer border border-slate-100 dark:border-slate-800 flex items-center justify-between"
            >
              <span>Vòng đời & Đóng lớp</span>
              <Archive size={13} />
            </button>
          </div>
        </aside>

        {/* ========================================================= */}
        {/* CỘT 2: KHU VỰC TÁC NGHIỆP CHÍNH (MAIN CONTENT AREA)        */}
        {/* ========================================================= */}
        <main className="flex-1 min-w-0 space-y-5">
          {/* ------------------------------------------------------------- */}
          {/* TAB 1: TỔNG QUAN & KPI                                        */}
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
                    <span className="text-xs font-normal text-slate-400 ml-1">/{item.capacity}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {item.allowLateEnrollment ? "Cho ghi danh muộn" : "Đã khóa ghi danh"}
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
                  <p className="mt-1 text-[11px] text-slate-500">Múi giờ: {item.timezone}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Kết thúc</span>
                    <Clock size={16} className="text-purple-500" />
                  </div>
                  <p className="mt-2 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {new Date(item.endAt).toLocaleDateString(activeLocale())}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">Học kỳ: {item.term}</p>
                </div>
              </div>

              {/* Khung thông tin lớp học & Khóa học */}
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3.5">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Thông tin lớp học
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Tên lớp:</span>
                      <strong className="text-slate-800 dark:text-slate-200">{item.name}</strong>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Mã lớp:</span>
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                        {item.code}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Khối & Môn (K-12):</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Khối {classGrade || "—"} · {classSubject || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Học kỳ:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {item.term}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-500">Trạng thái vận hành:</span>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3.5">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Khóa đào tạo trực thuộc
                  </h3>
                  {course ? (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-slate-500">Tên khóa học:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{course.name}</strong>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-slate-500">Mã khóa:</span>
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {course.code}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-slate-500">Phiên bản đang áp dụng:</span>
                        <span className="font-semibold text-sky-600 dark:text-sky-400">
                          v{item.courseVersion}
                        </span>
                      </div>
                      <div className="py-1.5">
                        <span className="text-slate-500 block mb-1">Mô tả khóa học:</span>
                        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                          {course.description}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Chưa liên kết khóa học chuẩn.</p>
                  )}
                </div>
              </div>

              {/* Lối tắt truy cập nhanh các nghiệp vụ */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
                  Lối tắt điều hành lớp
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("feed")}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-left transition-all cursor-pointer"
                  >
                    <MessageSquare size={18} className="text-blue-600 dark:text-blue-400 mb-2" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Bảng tin lớp học
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Giám sát trao đổi</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("instructors")}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 text-left transition-all cursor-pointer"
                  >
                    <UserCheck size={18} className="text-indigo-600 dark:text-indigo-400 mb-2" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Phân công nhân sự
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Bổ nhiệm giảng viên</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("learners")}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left transition-all cursor-pointer"
                  >
                    <Users size={18} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Ghi danh học viên
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Nhập đơn lẻ hoặc sỉ</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("lifecycle")}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 text-left transition-all cursor-pointer"
                  >
                    <Archive size={18} className="text-purple-600 dark:text-purple-400 mb-2" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Vòng đời & Đóng lớp
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Đối soát điều kiện</p>
                  </button>
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
          {/* TAB 3: GIẢNG VIÊN & TRỢ GIẢNG                                  */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "instructors" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Đội ngũ giảng viên phụ trách
                    </h3>
                    <p className="text-xs text-slate-400">
                      Quản lý giảng viên chính, đồng giảng viên và trợ giảng của lớp học.
                    </p>
                  </div>
                  <Button onClick={() => setAssignModalOpen(true)} className="text-xs">
                    <UserPlus size={15} />
                    <span>Phân công giảng viên</span>
                  </Button>
                </div>

                {/* Danh sách giảng viên phụ trách */}
                {instructors.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Chưa có giảng viên nào được phân công vào lớp này.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {instructors.map((ins) => {
                      const isPrimary = ins.role === "PRIMARY";
                      return (
                        <div
                          key={ins.instructorId}
                          className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <UserAvatar
                              avatarUrl={ins.avatarUrl}
                              name={ins.displayName || "GV"}
                              className="size-10 rounded-full"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {ins.displayName || "Giảng viên"}
                                </strong>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isPrimary
                                      ? "bg-blue-600 text-white"
                                      : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {roleLabel[ins.role as InstructorRole] || "Đồng giảng viên"}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {ins.email || "giangvien@wind.edu.vn"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
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
          {/* TAB 4: HỌC VIÊN & GHI DANH                                    */}
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
                    <table className="w-full min-w-[600px] text-left text-xs">
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
          {/* TAB 5: LỊCH HỌC & CA DẠY                                       */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "schedule" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Lịch học & Ca dạy trực tuyến
                  </h3>
                  <p className="text-xs text-slate-400">
                    Theo dõi các buổi học trực tuyến và tiến độ giảng dạy của lớp.
                  </p>
                </div>
                <Link
                  href={`/attendance?classId=${encodeURIComponent(item.id)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold border border-blue-200/80 dark:border-blue-800/60 hover:bg-blue-600 hover:text-white transition-all shadow-2xs"
                >
                  <CalendarDays size={14} />
                  <span>Đối soát điểm danh</span>
                </Link>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Clock size={15} className="text-blue-500" />
                  <span>Múi giờ hoạt động: {item.timezone}</span>
                </div>
                <p className="text-xs text-slate-500">
                  Thời gian khóa học: {new Date(item.startAt).toLocaleDateString(activeLocale())} đến{" "}
                  {new Date(item.endAt).toLocaleDateString(activeLocale())}.
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 6: HỌC LIỆU & BÀI TẬP                                      */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "materials" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Học liệu & Bài tập lớp
                  </h3>
                  <p className="text-xs text-slate-400">
                    Giám sát các bài tập, đề thi, bài giảng và tài liệu lớp học.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/materials?classId=${encodeURIComponent(item.id)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <BookOpen size={14} />
                    <span>Kho tài liệu</span>
                  </Link>
                  <Link
                    href={`/academic?classId=${encodeURIComponent(item.id)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold border border-blue-200/80 dark:border-blue-800/60 hover:bg-blue-600 hover:text-white transition-all shadow-2xs"
                  >
                    <ListChecks size={14} />
                    <span>Bài tập & Đề thi</span>
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                  <BookOpenCheck size={20} className="text-blue-500 mb-1.5" />
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Kho bài giảng lớp
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Đồng bộ video, slide và phiếu bài tập
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                  <BookOpen size={20} className="text-emerald-500 mb-1.5" />
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Tài liệu học tập
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">PDF, Word, Excel tham khảo</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                  <ListChecks size={20} className="text-purple-500 mb-1.5" />
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Bài tập & Khảo thí
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Theo dõi nộp bài & bảng điểm</p>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 7: VÒNG ĐỜI & ĐÓNG LỚP                                    */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "lifecycle" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Điều kiện sẵn sàng đóng lớp (Closure Readiness)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Đối soát đầy đủ các ràng buộc nghiệp vụ trước khi chuyển lớp sang lưu trữ.
                    </p>
                  </div>
                  <Link
                    href={`/class-lifecycle?classId=${encodeURIComponent(item.id)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-xs font-bold border border-purple-200/80 dark:border-purple-800/60 hover:bg-purple-600 hover:text-white transition-all shadow-2xs"
                  >
                    <Archive size={14} />
                    <span>Màn hình đóng lớp</span>
                  </Link>
                </div>

                {readiness ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-[11px] text-slate-500 block">Bài thi đang mở:</span>
                        <strong className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {readiness.openExams}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-[11px] text-slate-500 block">Khiếu nại mở:</span>
                        <strong className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {readiness.openAppeals}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-[11px] text-slate-500 block">Trạng thái sẵn sàng:</span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-bold mt-1 ${
                            readiness.eligible ? "text-emerald-600" : "text-amber-600"
                          }`}
                        >
                          {readiness.eligible ? (
                            <>
                              <CheckCircle2 size={15} /> Đủ điều kiện đóng
                            </>
                          ) : (
                            <>
                              <ShieldAlert size={15} /> Cần hoàn tất tồn đọng
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Đang nạp dữ liệu điều kiện đóng lớp…</p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ========================================================= */}
      {/* CÁC MODAL THAO TÁC CỦA QUẢN TRỊ TRUNG TÂM                */}
      {/* ========================================================= */}

      {/* Modal 1: Phân công giảng viên mới */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Phân công giảng viên"
        description="Gán giảng viên phụ trách hoặc trợ giảng vào lớp học."
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
