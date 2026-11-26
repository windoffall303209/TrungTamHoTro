"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  ImagePlus,
  LayoutDashboard,
  Lock,
  MessageCircle,
  MessageSquare,
  Play,
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
import { ClassAvatar } from "@/shared/ui/class-avatar";
import { UserPicker } from "@/shared/ui/user-picker";
import { UserAvatar } from "@/shared/ui/user-avatar";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { ClassSchedulePanel } from "@/features/class-detail/class-schedule-panel";
import { ClassMaterialRow } from "@/features/class-detail/class-material-row";
import { activeLocale } from "@/i18n/runtime";
import { hasPermission } from "@/lib/access-control";
import { useI18n } from "@/providers/i18n-provider";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useClassExamPage } from "@/lib/class-exams";
import { isMaterialForClass, loadClassMaterials } from "@/lib/materials";
import { useApp } from "@/providers/app-provider";
import type {
  Assignment,
  ClassClosureReadiness,
  ClassRoster,
  Course,
  EnrollmentImportResult,
  InstructorRole,
  LearningClass,
  Material,
} from "@/lib/learning-types";
import { type RemoveTarget } from "@/features/class-detail/class-detail.shared";
import { isLectureMaterial, toLectureItem, toMaterialDisplayItem } from "@/roles/instructor/class/instructor-class-workspace.helpers";
import { buildManagerFolderView } from "./manager-folder-view";
import { ManagerFolderSidebar } from "./manager-folder-sidebar";
import { detachOpener } from "@/lib/safe-content";

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
  onClassUpdated?: (updated: LearningClass) => void;
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
  onClassUpdated,
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
  const { notify, session } = useApp();
  const { t, locale } = useI18n();
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  const [currentClass, setCurrentClass] = useState<LearningClass>(item);
  const canManageSchedule =
    ["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(session.roleCode) &&
    (session.permissions.length === 0 || hasPermission(session, "class:manage")) &&
    currentClass.status !== "CLOSED";
  const canTransitionSession =
    session.roleCode === "SYSTEM_ADMIN" || hasPermission(session, "session:manage");
  const [activeTab, setActiveTab] = useState<ManagerSubTab>("overview");
  const [copiedLink, setCopiedLink] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequest = useRef(0);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Trạng thái cài đặt lớp học
  const [settingsForm, setSettingsForm] = useState({
    name: item.name,
    capacity: item.capacity ?? 40,
    description: "description" in item && typeof item.description === "string" ? item.description : "",
    allowLateEnrollment: item.allowLateEnrollment ?? false,
    allowPeerGradeViewing: item.allowPeerGradeViewing ?? false,
    allowLearnerFeedPosting: item.allowLearnerFeedPosting ?? true,
  });

  // Trạng thái xác nhận kích hoạt/đóng lớp học
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
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");

  // Trạng thái học liệu & bài giảng thật tải từ máy chủ
  const [classMaterials, setClassMaterials] = useState<Material[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const loadedMaterialsFor = useRef<{ classId: string; roleCode: string } | null>(null);
  const needsMaterials = activeTab === "materials" || activeTab === "lectures";

  // Trạng thái tab Bài giảng (chuẩn giao diện học sinh)
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");
  const [lectureSearch, setLectureSearch] = useState("");
  const [selectedLectureId, setSelectedLectureId] = useState<string>("");

  // Trạng thái tab Tài liệu (chuẩn giao diện học sinh)
  const [selectedMaterialFolder, setSelectedMaterialFolder] = useState<string>("__ALL__");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");

  // Đồng bộ lại khi prop item thay đổi
  useEffect(() => {
    setCurrentClass(item);
    setSettingsForm({
      name: item.name,
      capacity: item.capacity ?? 40,
      description: "description" in item && typeof item.description === "string" ? item.description : "",
      allowLateEnrollment: item.allowLateEnrollment ?? false,
      allowPeerGradeViewing: item.allowPeerGradeViewing ?? false,
      allowLearnerFeedPosting: item.allowLearnerFeedPosting ?? true,
    });
  }, [item]);

  const examPage = useClassExamPage(currentClass.id, session.roleCode, activeTab === "assignments", assignmentSearch, "newest",
    () => notifyRef.current("Không tải được đầy đủ bài tập của lớp.", "error"));
  const classExams = examPage.rows;
  const [classAssignments, setClassAssignments] = useState<Assignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  // Load current visibility whenever the manager opens the assignments tab.
  useEffect(() => {
    if (activeTab !== "assignments") return;
    const controller = new AbortController();
    setClassAssignments([]);
    setAssignmentsLoading(true);
    void apiRequest<Assignment[]>("/academic/assignments?classId=" + encodeURIComponent(currentClass.id), {
      roleCode: session.roleCode, signal: controller.signal,
    }).then(rows => {
      if (!controller.signal.aborted) setClassAssignments(rows);
    }).catch(() => {
      if (!controller.signal.aborted) notifyRef.current("Không tải được đầy đủ bài tập của lớp.", "error");
    }).finally(() => {
      if (!controller.signal.aborted) setAssignmentsLoading(false);
    });
    return () => controller.abort();
  }, [activeTab, currentClass.id, session.roleCode]);

  // Hai tab học liệu dùng chung danh sách đã tải thành công cho lớp và vai trò hiện tại.
  useEffect(() => {
    if (!needsMaterials) return;
    const loaded = loadedMaterialsFor.current;
    if (loaded?.classId === currentClass.id && loaded.roleCode === session.roleCode) return;
    loadedMaterialsFor.current = null;
    const controller = new AbortController();
    let active = true;
    setClassMaterials([]);
    setMaterialsLoading(true);
    loadClassMaterials<Material>(currentClass.id, {
      roleCode: session.roleCode,
      signal: controller.signal,
    })
      .then((materials) => {
        if (!active) return;
        loadedMaterialsFor.current = { classId: currentClass.id, roleCode: session.roleCode };
        setClassMaterials(
          materials.filter((material) => isMaterialForClass(material, currentClass.id)),
        );
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setClassMaterials([]);
        notifyRef.current(
          error instanceof Error ? error.message : "Không thể tải danh sách học liệu của lớp.",
          "error",
        );
      })
      .finally(() => {
        if (active) setMaterialsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [needsMaterials, currentClass.id, session.roleCode]);

  // Mở xem trước học liệu hoặc liên kết bài giảng; chặn quản trị viên mở mục đang ẩn.
  const handlePreviewMaterial = async (
    materialId: string,
    title: string,
    visibility: "PUBLISHED" | "HIDDEN",
    sourceUrl?: string,
  ) => {
    if (visibility === "HIDDEN") {
      notify("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.", "error");
      return;
    }
    if (sourceUrl) {
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const previewWindow = detachOpener(window.open("", "_blank"));
    if (!previewWindow) {
      notify("Trình duyệt đã chặn cửa sổ xem trước.", "error");
      return;
    }
    try {
      const access = await apiRequest<{ url: string }>(
        `/materials/${encodeURIComponent(materialId)}/access?action=PREVIEW`,
        { roleCode: session.roleCode },
      );
      await previewApiFile(access.url, session.roleCode, title, previewWindow);
    } catch (error) {
      previewWindow.close();
      notify(error instanceof Error ? error.message : "Không thể xem trước tài liệu.", "error");
    }
  };

  // Tải xuống tệp học liệu; chặn quản trị viên tải mục đang ẩn.
  const handleDownloadMaterial = async (materialId: string, visibility: "PUBLISHED" | "HIDDEN") => {
    if (visibility === "HIDDEN") {
      notify("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.", "error");
      return;
    }
    try {
      const access = await apiRequest<{ url: string }>(
        `/materials/${encodeURIComponent(materialId)}/access?action=DOWNLOAD`,
        { roleCode: session.roleCode },
      );
      await downloadApiFile(access.url, session.roleCode);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tải xuống tài liệu.", "error");
    }
  };

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
      const updated = await apiRequest<LearningClass>(`/classes/${encodeURIComponent(item.id)}/settings`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          name: settingsForm.name.trim(),
          capacity: Number(settingsForm.capacity),
          allowLateEnrollment: settingsForm.allowLateEnrollment,
          allowPeerGradeViewing: settingsForm.allowPeerGradeViewing,
          allowLearnerFeedPosting: settingsForm.allowLearnerFeedPosting,
        }),
      });
      setCurrentClass(updated);
      onClassUpdated?.(updated);
      notify("Đã cập nhật cài đặt lớp học thành công.", "success");
      setSettingsModalOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được cài đặt lớp.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  /** Tải ảnh đại diện lớp học thay cho icon mặc định từ màn hình quản lý. */
  const handleSelectClassAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploadingAvatar) return;
    if (file.size <= 0 || file.size > 3 * 1024 * 1024) {
      notify("Ảnh đại diện lớp học phải có kích thước từ 1 byte đến 3 MB.", "error");
      return;
    }
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const updated = await apiRequest<LearningClass>(`/classes/${encodeURIComponent(item.id)}/avatar`, {
        method: "POST",
        roleCode: session.roleCode,
        body: formData,
      });
      setCurrentClass(updated);
      onClassUpdated?.(updated);
      notify("Đã cập nhật ảnh đại diện lớp học.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được ảnh đại diện lớp học.", "error");
    } finally {
      setUploadingAvatar(false);
    }
  };

  /** Gỡ ảnh đại diện lớp học để quay về icon mặc định. */
  const handleRemoveClassAvatar = async () => {
    if (!currentClass.avatarUrl || uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      const updated = await apiRequest<LearningClass>(`/classes/${encodeURIComponent(item.id)}/avatar`, {
        method: "DELETE",
        roleCode: session.roleCode,
      });
      setCurrentClass(updated);
      onClassUpdated?.(updated);
      notify("Đã chuyển lớp học về icon mặc định.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gỡ được ảnh đại diện lớp học.", "error");
    } finally {
      setUploadingAvatar(false);
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
          <ClassAvatar
            avatarUrl={currentClass.avatarUrl}
            name={currentClass.name}
            sizeClass="size-8"
            iconSize={15}
          />
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
                    Theo dõi các bài viết, trao đổi giữa giáo viên và học sinh.
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
            <ClassSchedulePanel
              classItem={currentClass}
              roleCode={session.roleCode}
              canManage={canManageSchedule}
              canTransitionStatus={canTransitionSession}
              addButtonLabel="Thêm buổi học"
              locale={locale}
              notify={notify}
              t={t}
            />
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 6: BÀI TẬP (MASTER-DETAIL 3 CỘT CHUẨN HỌC SINH - CHỈ XEM) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "assignments" && (() => {
            const rawAssignments = [...classAssignments.filter(row => row.classId === currentClass.id).map(assignment => ({
              ...assignment,
              folder: "Bài tập chung",
              dueDate: new Date(assignment.dueAt).toLocaleString(activeLocale()),
              status: assignment.hidden ? "Đã ẩn" : assignment.status === "CLOSED" ? "Đã kết thúc" : "Đang mở",
            })), ...classExams.filter(row => row.classId === currentClass.id).map(exam => ({
              id: exam.id, title: exam.title, folder: "Đề thi", dueDate: new Date(exam.closeAt).toLocaleString(activeLocale()),
              status: exam.hidden ? "Đã ẩn" : { DRAFT: "Bản nháp", PENDING_REVIEW: "Chờ duyệt", PUBLISHED: "Đã phát hành", CLOSED: "Đã kết thúc" }[exam.status],
              hidden: Boolean(exam.hidden), description: "", instructions: exam.questionIds.length + " câu · " + exam.durationMinutes + " phút",
            }))];
            const { counts, filtered, active: activeAsg } = buildManagerFolderView(
              rawAssignments, selectedAssignmentFolder, assignmentSearch, selectedAssignmentId,
            );

            const matchingAssignments = classAssignments.filter(row => row.title.toLowerCase().includes(assignmentSearch.trim().toLowerCase())).length;
            if (counts.has("Bài tập chung")) counts.set("Bài tập chung", matchingAssignments);
            if (examPage.total || selectedAssignmentFolder === "Đề thi") counts.set("Đề thi", examPage.total);
            const folders = Array.from(counts.keys());

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
                    totalCount={matchingAssignments + examPage.total}
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
                          <p className="text-xs text-slate-400">{assignmentsLoading || examPage.loading ? "Đang tải bài tập…" : "Không có bài tập nào trong thư mục này"}</p>
                        </div>
                      ) : (
                        filtered.map((assign) => {
                          const isSelected = activeAsg?.id === assign.id;
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
                                  <p className="text-[11px] text-slate-500">Hạn nộp · {assign.dueDate}
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
                    {selectedAssignmentFolder !== "Bài tập chung" && examPage.total > examPage.pageSize && (
                      <Pagination compact totalItems={examPage.total} page={examPage.page} pageSize={examPage.pageSize}
                        onPageChange={examPage.setPage} onPageSizeChange={examPage.setPageSize} itemLabel="đề thi" />
                    )}
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

                        <p className="text-xs">Hạn nộp · {activeAsg.dueDate}</p>
                        {!activeAsg.hidden && <div className="space-y-2 text-sm whitespace-pre-wrap">
                          <p>{activeAsg.description}</p>
                          <p>{activeAsg.instructions}</p>
                        </div>}
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
            const rawMaterials = classMaterials
              .filter((material) => !isLectureMaterial(material))
              .map((material) => {
                const display = toMaterialDisplayItem(material);
                return {
                  ...display,
                  author: primaryInstructor?.displayName || material.ownerId || "Giảng viên phụ trách",
                };
              });

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
                          <p className="text-xs text-slate-400">
                            {materialsLoading ? "Đang tải danh sách tài liệu..." : "Không có tài liệu nào trong thư mục này"}
                          </p>
                        </div>
                      ) : (
                        filtered.map((mat) => {
                          const isSelected = activeMat?.id === mat.id;
                          return (
                            <ClassMaterialRow
                              key={mat.id}
                              fileType={mat.fileType}
                              title={mat.title}
                              size={mat.size}
                              uploadedAt={mat.uploadedAt}
                              selected={isSelected}
                              onSelect={() => setSelectedMaterialId(mat.id)}
                              trailing={
                                mat.visibility === "HIDDEN" ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold">
                                    <EyeOff size={11} />
                                    Đã ẩn
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    Đang hiển thị
                                  </span>
                                )
                              }
                            />
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
                            <span>Trạng thái</span>
                            {activeMat.visibility === "HIDDEN" ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                                <EyeOff size={12} />
                                Đã ẩn
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                Đang hiển thị
                              </span>
                            )}
                          </div>
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

                        {activeMat.visibility === "HIDDEN" && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
                            Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.
                          </div>
                        )}

                        {/* Nút thao tác: Xem trước và Tải xuống */}
                        <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            disabled={activeMat.visibility === "HIDDEN"}
                            onClick={() => void handlePreviewMaterial(activeMat.id, activeMat.title, activeMat.visibility)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Eye size={13} />
                            <span>Xem trước</span>
                          </button>

                          <button
                            type="button"
                            disabled={activeMat.visibility === "HIDDEN"}
                            onClick={() => void handleDownloadMaterial(activeMat.id, activeMat.visibility)}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            const rawLectures = classMaterials
              .filter((material) => isLectureMaterial(material))
              .map((material) => {
                const lec = toLectureItem(material, primaryInstructor?.displayName || "Giảng viên phụ trách");
                const createdDate = material.createdAt ? new Date(material.createdAt) : null;
                const uploadedAtLabel = createdDate && !Number.isNaN(createdDate.getTime())
                  ? createdDate.toLocaleDateString(activeLocale())
                  : "—";
                return {
                  id: lec.id,
                  title: lec.title,
                  folder: lec.folder?.trim() || "Chuyên đề chung",
                  fileType: lec.fileType || (lec.sourceType === "LINK" ? "link" : "mp4"),
                  teacher: lec.teacher || primaryInstructor?.displayName || "Giảng viên phụ trách",
                  uploadedAt: uploadedAtLabel,
                  visibility: lec.visibility,
                  sourceType: lec.sourceType,
                  sourceUrl: lec.sourceUrl,
                };
              });

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
                          <p className="text-xs text-slate-400">
                            {materialsLoading ? "Đang tải danh sách bài giảng..." : "Không có bài giảng nào trong thư mục này"}
                          </p>
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
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    GV: {lec.teacher} · Đăng ngày {lec.uploadedAt}
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                {lec.visibility === "HIDDEN" ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold">
                                    <EyeOff size={11} />
                                    Đã ẩn
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    Đang hiển thị
                                  </span>
                                )}
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
                          <span className="text-[11px] text-slate-400 mt-0.5 block">
                            Thư mục: {activeLec.folder}
                          </span>
                        </div>

                        {/* Bảng thông số */}
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Trạng thái</span>
                            {activeLec.visibility === "HIDDEN" ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                                <EyeOff size={12} />
                                Đã ẩn
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                Đang hiển thị
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Giảng viên</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[140px]">
                              {activeLec.teacher}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Loại nguồn</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeLec.sourceType === "LINK" ? "Liên kết ngoài" : "Tệp bài giảng"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Ngày đăng</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {activeLec.uploadedAt}
                            </span>
                          </div>
                        </div>

                        {activeLec.visibility === "HIDDEN" && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
                            Bài giảng đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.
                          </div>
                        )}

                        {/* Nút Xem bài giảng */}
                        <div className="pt-2">
                          <button
                            type="button"
                            disabled={activeLec.visibility === "HIDDEN"}
                            onClick={() =>
                              void handlePreviewMaterial(
                                activeLec.id,
                                activeLec.title,
                                activeLec.visibility,
                                activeLec.sourceUrl,
                              )
                            }
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
          <Field label="Ảnh đại diện lớp học">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3">
              <ClassAvatar
                avatarUrl={currentClass.avatarUrl}
                name={currentClass.name}
                sizeClass="size-12"
                iconSize={22}
              />
              <div className="flex-1 min-w-44 space-y-1.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Chọn ảnh PNG, JPEG hoặc WebP (tối đa 3 MB) để thay icon mặc định.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Chọn ảnh đại diện lớp học"
                    className="hidden"
                    onChange={(event) => void handleSelectClassAvatar(event)}
                  />
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={() => avatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    <ImagePlus size={13} />
                    <span>Chọn ảnh đại diện</span>
                  </button>
                  {currentClass.avatarUrl && (
                    <button
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={() => void handleRemoveClassAvatar()}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Dùng icon mặc định</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Field>

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
              max={1000}
              className={inputClass}
              required
              value={settingsForm.capacity}
              onChange={(e) => setSettingsForm({ ...settingsForm, capacity: Number(e.target.value) })}
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
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Cho phép học sinh xem bảng điểm</span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">Học sinh trong lớp có thể xem bảng điểm ở chế độ chỉ xem, không có thao tác chấm bài hay xem chi tiết bài làm.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-sky-600"
              checked={settingsForm.allowLearnerFeedPosting}
              onChange={(event) => setSettingsForm((current) => ({ ...current, allowLearnerFeedPosting: event.target.checked }))}
            />
            <span className="space-y-1">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Cho phép học sinh đăng bài trên bảng tin</span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">Khi bật, học sinh được đăng bài mới trên bảng tin lớp; khi tắt chỉ giảng viên và quản lý được đăng bài.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-sky-600"
              checked={settingsForm.allowLateEnrollment}
              onChange={(event) => setSettingsForm((current) => ({ ...current, allowLateEnrollment: event.target.checked }))}
            />
            <span className="space-y-1">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Cho phép ghi danh muộn</span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">Cho phép thêm học viên mới sau khi lớp đã bắt đầu diễn ra.</span>
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
              Đang kiểm tra bài thi, bài tập, buổi học còn mở...
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
