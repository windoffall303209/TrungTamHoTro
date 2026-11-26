"use client";

import { activeLocale } from "@/i18n/runtime";

import { Archive, ArrowRight, BookOpen, GraduationCap, History, ImagePlus, Pencil, Plus, Rocket, Search, Trash2, UserCheck, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "@/shared/auth/access-denied";
import { ClassAvatar } from "@/shared/ui/class-avatar";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionState } from "@/shared/ui/section-state";
import { useServerPagination, type PaginatedResponse } from "@/shared/hooks/use-server-pagination";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge } from "@/shared/ui/ui";
import { apiRequest } from "@/lib/api-client";
import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/date-time";
import {
  CUSTOM_OPTION_VALUE,
  formatGradeLabel,
  K12_GRADES,
  K12_SUBJECTS,
  type Course,
  type CourseVersionSnapshot,
  type LearningClass,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

const blankCourse = {
  code: "",
  name: "",
  description: "",
  outcomes: "",
  grade: "",
  customGrade: "",
  subject: "",
  customSubject: "",
};

const blankClass = {
  code: "",
  name: "",
  term: "2026-2027",
  grade: "",
  customGrade: "",
  subject: "",
  customSubject: "",
  startAt: "",
  endAt: "",
  capacity: 40,
  timezone: "Asia/Bangkok",
  allowPeerGradeViewing: false,
  allowLearnerFeedPosting: true,
  description: "",
};
const MAX_CLASS_AVATAR_BYTES = 3 * 1024 * 1024;

/** Màu sắc banner card lớp học ngẫu nhiên theo chỉ số */
const GRADIENTS = [
  "from-blue-600 to-indigo-600",
  "from-emerald-600 to-teal-600",
  "from-violet-600 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-amber-600 to-orange-600",
  "from-rose-600 to-pink-600",
];

/** Kiểm tra một giá trị khối có nằm trong 12 khối chuẩn K-12 hay không. */
function isStandardGrade(value?: string | null): boolean {
  if (!value) return false;
  return K12_GRADES.some((item) => item.value === value);
}

/** Kiểm tra một giá trị môn học có nằm trong danh sách môn chuẩn K-12 hay không. */
function isStandardSubject(value?: string | null): boolean {
  if (!value) return false;
  return K12_SUBJECTS.includes(value);
}

/** Hiển thị môn học và lớp theo tab độc lập, kèm luồng tạo, phiên bản hóa và kích hoạt. */
export default function CoursesPage() {
  const router = useRouter();
  const { session, notify } = useApp();
  const [courses, setCourses] = useState<Course[]>([]);
  const [pagedCourses, setPagedCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [activeTab, setActiveTab] = useState<"courses" | "classes">("classes");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"course" | "class" | null>(null);
  const [courseForm, setCourseForm] = useState(blankCourse);
  const [classForm, setClassForm] = useState(blankClass);
  const [newClassAvatarFile, setNewClassAvatarFile] = useState<File | null>(null);
  const [newClassAvatarPreview, setNewClassAvatarPreview] = useState<string | null>(null);
  const newClassAvatarInputRef = useRef<HTMLInputElement>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<Course | null>(null);
  const [versions, setVersions] = useState<CourseVersionSnapshot[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null);
  const loadRequestId = useRef(0);
  const versionRequestId = useRef(0);
  
  // Bộ lọc chuẩn: Khối -> Môn -> Lớp/Môn học
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "course:manage");

  const effectiveCourseGrade =
    courseForm.grade === CUSTOM_OPTION_VALUE
      ? courseForm.customGrade.trim()
      : courseForm.grade.trim();
  const effectiveCourseSubject =
    courseForm.subject === CUSTOM_OPTION_VALUE
      ? courseForm.customSubject.trim()
      : courseForm.subject.trim();

  const effectiveClassGrade =
    classForm.grade === CUSTOM_OPTION_VALUE
      ? classForm.customGrade.trim()
      : classForm.grade.trim();
  const effectiveClassSubject =
    classForm.subject === CUSTOM_OPTION_VALUE
      ? classForm.customSubject.trim()
      : classForm.subject.trim();

  /** Mở modal tạo môn học mới với mã tự sinh */
  const openCreateCourseModal = () => {
    setEditingCourseId(null);
    const autoCode = `MH-${Math.floor(1000 + Math.random() * 9000)}`;
    setCourseForm({ ...blankCourse, code: autoCode });
    setMode("course");
  };

  /** Dọn ảnh đại diện lớp đang chờ tải lên để tránh rò rỉ object URL. */
  const clearNewClassAvatar = useCallback(() => {
    setNewClassAvatarFile(null);
    setNewClassAvatarPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (newClassAvatarPreview) URL.revokeObjectURL(newClassAvatarPreview);
    };
  }, [newClassAvatarPreview]);

  /** Chọn ảnh đại diện tùy chọn khi mở lớp mới (PNG/JPEG/WebP tối đa 3 MB). */
  const handleSelectNewClassAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size <= 0 || file.size > MAX_CLASS_AVATAR_BYTES) {
      notify("Ảnh đại diện lớp học phải có kích thước từ 1 byte đến 3 MB.", "error");
      return;
    }
    setNewClassAvatarFile(file);
    setNewClassAvatarPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  };

  /** Mở modal tạo lớp học mới với mã và các thông số mặc định */
  const openCreateClassModal = () => {
    const autoCode = `LOP-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const future = new Date(Date.now() + 180 * 86400000);
    clearNewClassAvatar();
    setClassForm({
      ...blankClass,
      code: autoCode,
      startAt: toLocalDateTimeInput(now),
      endAt: toLocalDateTimeInput(future),
    });
    setMode("class");
  };

  // Danh sách các môn học có thể chọn lọc (theo khối đang chọn hoặc toàn bộ)
  const availableSubjects = useMemo(() => {
    const list = new Set<string>(K12_SUBJECTS);
    courses.forEach((c) => {
      if (
        !gradeFilter ||
        (gradeFilter === CUSTOM_OPTION_VALUE
          ? Boolean(c.grade && !isStandardGrade(String(c.grade)))
          : String(c.grade) === gradeFilter)
      ) {
        if (c.subject) list.add(c.subject);
      }
    });
    classes.forEach((cl) => {
      if (
        !gradeFilter ||
        (gradeFilter === CUSTOM_OPTION_VALUE
          ? Boolean(cl.grade && !isStandardGrade(String(cl.grade)))
          : String(cl.grade) === gradeFilter)
      ) {
        if (cl.subject) list.add(cl.subject);
      }
    });
    return Array.from(list);
  }, [courses, classes, gradeFilter]);

  const coursePagination = useServerPagination(10);
  const classPagination = useServerPagination(10);
  const { page: coursePage, pageSize: coursePageSize, syncResponse: syncCoursePage } = coursePagination;
  const { page: classPage, pageSize: classPageSize, syncResponse: syncClassPage } = classPagination;
  const loadControllerRef = useRef<AbortController | null>(null);

  /** Nạp danh sách môn học làm tùy chọn cho bộ lọc của quản lý. */
  const loadCourseOptions = useCallback(async () => {
    if (!allowed || !manager) return;
    try {
      const courseData = await apiRequest<Course[]>("/manager/courses", {
        roleCode: session.roleCode,
      });
      if (Array.isArray(courseData)) setCourses(courseData);
    } catch {
      // Giữ danh sách tùy chọn cũ nếu tải danh mục dropdown thất bại tạm thời.
    }
  }, [allowed, manager, session.roleCode]);

  useEffect(() => {
    void loadCourseOptions();
  }, [loadCourseOptions]);

  /** Nạp trang dữ liệu đang xem (môn học hoặc lớp học) trực tiếp từ DB theo bộ lọc và hủy request cũ. */
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!allowed) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      const isCourseTab = manager && activeTab === "courses";
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("query", searchQuery.trim());
      if (manager) {
        if (gradeFilter) params.set("grade", gradeFilter);
        if (subjectFilter) params.set("subject", subjectFilter);
        if (!isCourseTab && courseFilter) params.set("courseId", courseFilter);
      }
      if (isCourseTab) {
        params.set("page", String(coursePage));
        params.set("pageSize", String(coursePageSize));
        const result = await apiRequest<PaginatedResponse<Course>>(
          `/manager/courses/page?${params.toString()}`,
          { roleCode: session.roleCode, signal: controller.signal },
        );
        if (controller.signal.aborted || requestId !== loadRequestId.current) return;
        setPagedCourses(result.items);
        syncCoursePage(result);
      } else {
        params.set("page", String(classPage));
        params.set("pageSize", String(classPageSize));
        const result = await apiRequest<PaginatedResponse<LearningClass>>(
          `/classes/page?${params.toString()}`,
          { roleCode: session.roleCode, signal: controller.signal },
        );
        if (controller.signal.aborted || requestId !== loadRequestId.current) return;
        setClasses(result.items);
        syncClassPage(result);
      }
    } catch (error) {
      if (!controller.signal.aborted && requestId === loadRequestId.current) {
        notify(error instanceof Error ? error.message : "Không tải được dữ liệu.", "error");
      }
    } finally {
      if (!controller.signal.aborted && requestId === loadRequestId.current) setLoading(false);
    }
  }, [
    activeTab,
    allowed,
    classPage,
    classPageSize,
    courseFilter,
    coursePage,
    coursePageSize,
    gradeFilter,
    manager,
    notify,
    searchQuery,
    session.roleCode,
    subjectFilter,
    syncClassPage,
    syncCoursePage,
  ]);

  useEffect(() => {
    const delay = searchQuery.trim() ? 180 : 0;
    const timer = window.setTimeout(() => void load(), delay);
    return () => {
      window.clearTimeout(timer);
      loadRequestId.current += 1;
      loadControllerRef.current?.abort();
      versionRequestId.current += 1;
    };
  }, [load, searchQuery]);

  /** Tạo môn học mới hoặc tạo bản nháp phiên bản kế tiếp từ môn học đang sửa. */
  const createCourse = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const code = courseForm.code.trim() || `MH-${Math.floor(1000 + Math.random() * 9000)}`;
      const fallbackOutcomes = courseForm.description?.trim()
        ? [courseForm.description.trim()]
        : [courseForm.name?.trim() || "Hoàn thành môn học"];
      const outcomes = courseForm.outcomes
        ? courseForm.outcomes.split("\n").map((item) => item.trim()).filter(Boolean)
        : fallbackOutcomes;

      const payload = {
        code,
        name: courseForm.name.trim(),
        description:
          courseForm.description.trim().length >= 10
            ? courseForm.description.trim()
            : `Chương trình đào tạo môn ${courseForm.name.trim()}`,
        grade: effectiveCourseGrade || undefined,
        subject: effectiveCourseSubject || undefined,
        outcomes: outcomes.length ? outcomes : ["Hoàn thành môn học"],
      };
      await apiRequest(
        editingCourseId ? `/manager/courses/${editingCourseId}` : "/manager/courses",
        {
          method: editingCourseId ? "PATCH" : "POST",
          roleCode: session.roleCode,
          body: JSON.stringify(
            editingCourseId
              ? { name: payload.name, description: payload.description, grade: payload.grade, subject: payload.subject, outcomes: payload.outcomes }
              : payload
          ),
        }
      );
      notify(editingCourseId ? "Đã cập nhật bản nháp môn học." : "Đã tạo môn học bản nháp.");
      setMode(null);
      setEditingCourseId(null);
      setCourseForm(blankCourse);
      await Promise.all([load(), loadCourseOptions()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được môn học.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Mở lớp mới trực tiếp theo Khối & Môn học (kèm tùy chọn Khác) và chuẩn hóa thời gian sang ISO trước khi gửi. */
  const createClass = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!effectiveClassGrade || !effectiveClassSubject) {
      notify("Vui lòng chọn hoặc nhập đầy đủ Khối và Môn học để mở lớp.", "error");
      return;
    }
    setSaving(true);
    try {
      const autoCode = classForm.code?.trim() || `LOP-${Math.floor(1000 + Math.random() * 9000)}`;
      const now = new Date();
      const future = new Date(Date.now() + 180 * 86400000);
      const startAt = classForm.startAt ? localDateTimeToIso(classForm.startAt) : now.toISOString();
      const endAt = classForm.endAt ? localDateTimeToIso(classForm.endAt) : future.toISOString();

      const created = await apiRequest<LearningClass>("/manager/classes", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          code: autoCode,
          name: classForm.name.trim(),
          term: classForm.term || "2026-2027",
          timezone: classForm.timezone || "Asia/Bangkok",
          grade: effectiveClassGrade,
          subject: effectiveClassSubject,
          capacity: Number(classForm.capacity),
          allowPeerGradeViewing: classForm.allowPeerGradeViewing,
          allowLearnerFeedPosting: classForm.allowLearnerFeedPosting,
          startAt,
          endAt,
        }),
      });
      if (newClassAvatarFile && created?.id) {
        try {
          const avatarForm = new FormData();
          avatarForm.append("file", newClassAvatarFile, newClassAvatarFile.name);
          await apiRequest(`/classes/${encodeURIComponent(created.id)}/avatar`, {
            method: "POST",
            roleCode: session.roleCode,
            body: avatarForm,
          });
        } catch (avatarError) {
          notify(
            avatarError instanceof Error
              ? `Đã mở lớp nhưng chưa tải được ảnh đại diện: ${avatarError.message}`
              : "Đã mở lớp nhưng chưa tải được ảnh đại diện.",
            "error",
          );
        }
      }
      notify("Đã mở lớp học mới.");
      setMode(null);
      clearNewClassAvatar();
      setClassForm(blankClass);
      await Promise.all([load(), loadCourseOptions()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tạo được lớp.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Xuất bản phiên bản môn học để có thể dùng cho hoạt động mở lớp. */
  const publish = async (course: Course) => {
    try {
      await apiRequest(`/manager/courses/${course.id}/publish`, { method: "POST", roleCode: session.roleCode });
      notify("Đã xuất bản môn học.");
      await Promise.all([load(), loadCourseOptions()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xuất bản được.", "error");
    }
  };

  /** Đưa dữ liệu môn học vào biểu mẫu để tạo bản nháp chỉnh sửa mới. */
  const editCourse = (course: Course) => {
    const rawGrade = course.grade ? String(course.grade) : "";
    const rawSubject = course.subject || "";
    setEditingCourseId(course.id);
    setCourseForm({
      code: course.code,
      name: course.name,
      description: course.description,
      grade: !rawGrade ? "" : isStandardGrade(rawGrade) ? rawGrade : CUSTOM_OPTION_VALUE,
      customGrade: rawGrade && !isStandardGrade(rawGrade) ? rawGrade : "",
      subject: !rawSubject ? "" : isStandardSubject(rawSubject) ? rawSubject : CUSTOM_OPTION_VALUE,
      customSubject: rawSubject && !isStandardSubject(rawSubject) ? rawSubject : "",
      outcomes: course.outcomes.join("\n"),
    });
    setMode("course");
  };

  /** Nạp lịch sử phiên bản và mở bảng đối chiếu của khóa học. */
  const openVersions = async (course: Course) => {
    const requestId = ++versionRequestId.current;
    try {
      const snapshots = await apiRequest<CourseVersionSnapshot[]>(`/manager/courses/${course.id}/versions`, { roleCode: session.roleCode });
      if (requestId !== versionRequestId.current) return;
      setVersions(snapshots);
      setVersionTarget(course);
    } catch (error) {
      if (requestId === versionRequestId.current) {
        notify(error instanceof Error ? error.message : "Không tải được lịch sử phiên bản.", "error");
      }
    }
  };

  /** Ngừng sử dụng khóa học nhưng giữ snapshot mà các lớp cũ đang tham chiếu. */
  const archiveCourse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!archiveTarget) return;
    try {
      setSaving(true);
      await apiRequest(`/manager/courses/${archiveTarget.id}/archive`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({}),
      });
      notify("Đã ngừng sử dụng khóa học; các lớp cũ vẫn giữ phiên bản đã chọn.");
      setArchiveTarget(null);
      await Promise.all([load(), loadCourseOptions()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không ngừng sử dụng được khóa học.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Kích hoạt lớp sau khi API xác nhận các điều kiện vận hành cần thiết. */
  const activate = async (item: LearningClass) => {
    try {
      await apiRequest(`/manager/classes/${item.id}/activate`, { method: "POST", roleCode: session.roleCode });
      notify("Lớp đã được kích hoạt.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kích hoạt được.", "error");
    }
  };
  if (!allowed) return <AccessDenied />;
  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <PageHeader
        title={session.roleCode === "LEARNER" ? "Lớp của tôi" : session.roleCode === "INSTRUCTOR" ? "Lớp giảng dạy" : "Môn học & lớp"}
        description={manager ? "Quản lý danh mục đào tạo, phân cấp Khối - Môn và danh sách lớp học." : session.roleCode === "INSTRUCTOR" ? "Danh sách các lớp học bạn được phân công giảng dạy." : "Danh sách các lớp học bạn đã ghi danh tham gia."}
      />

      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="mt-4 flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC: MÔN HỌC / LỚP HỌC */}
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Chức năng đào tạo
            </div>

            <button
              type="button"
              onClick={() => { setActiveTab("classes"); classPagination.resetPage(); }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === "classes"
                  ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                  : "text-slate-600 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <GraduationCap size={18} className={activeTab === "classes" ? "text-sky-600 dark:text-sky-400" : "text-slate-600"} />
                <span className="truncate">Lớp học</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                activeTab === "classes"
                  ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}>
                {classPagination.totalItems}
              </span>
            </button>

            {manager && (
              <button
                type="button"
                onClick={() => { setActiveTab("courses"); coursePagination.resetPage(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                  activeTab === "courses"
                    ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                    : "text-slate-600 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookOpen size={18} className={activeTab === "courses" ? "text-sky-600 dark:text-sky-400" : "text-slate-600"} />
                  <span className="truncate">Môn học</span>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                  activeTab === "courses"
                    ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                }`}>
                  {activeTab === "courses" ? coursePagination.totalItems : courses.length}
                </span>
              </button>
            )}
          </div>

          {/* Widget tóm tắt nhỏ phía dưới */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 shadow-xs text-xs space-y-2.5 hidden lg:block">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Chỉ số danh mục</div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-600">
              <span>Tổng lớp học:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{classPagination.totalItems}</span>
            </div>
            {manager && (
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-600">
                <span>Tổng môn học:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{courses.length}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600">
              Hệ thống hỗ trợ phân cấp chuẩn Khối 1 - 12 & theo Môn học.
            </div>
          </div>
        </aside>

        {/* CỘT PHẢI: VÙNG TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full space-y-3.5">
          {/* THANH BỘ LỌC VÀ TÌM KIẾM CÙNG HÀNG (SINGLE ROW TOOLBAR) */}
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap lg:flex-nowrap items-center gap-2.5">
            {/* Ô tìm kiếm */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  classPagination.resetPage();
                  coursePagination.resetPage();
                }}
                placeholder={activeTab === "courses" ? "Tìm kiếm môn học theo tên, mã, mô tả..." : "Tìm kiếm lớp học theo tên, mã lớp, học kỳ..."}
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-600 focus:outline-hidden focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    classPagination.resetPage();
                    coursePagination.resetPage();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  title="Xóa tìm kiếm"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Lọc Khối */}
            {manager && (
              <div className="w-32 sm:w-36 shrink-0">
                <select
                  value={gradeFilter}
                  onChange={(e) => {
                    setGradeFilter(e.target.value);
                    classPagination.resetPage();
                    coursePagination.resetPage();
                  }}
                  className={`${inputClass} h-9 text-xs font-semibold`}
                >
                  <option value="">Tất cả khối</option>
                  {K12_GRADES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác</option>
                </select>
              </div>
            )}

            {/* Lọc Môn học */}
            {manager && (
              <div className="w-36 sm:w-40 shrink-0">
                <select
                  value={subjectFilter}
                  onChange={(e) => {
                    setSubjectFilter(e.target.value);
                    classPagination.resetPage();
                    coursePagination.resetPage();
                  }}
                  className={`${inputClass} h-9 text-xs font-semibold`}
                >
                  <option value="">Tất cả môn</option>
                  {availableSubjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác (tùy chỉnh)</option>
                </select>
              </div>
            )}

            {/* Lọc Môn học cha (chỉ hiện khi ở tab Lớp học) */}
            {manager && activeTab === "classes" && (
              <div className="w-40 sm:w-44 shrink-0">
                <select
                  className={`${inputClass} h-9 text-xs font-semibold`}
                  onChange={(event) => {
                    setCourseFilter(event.target.value);
                    classPagination.resetPage();
                  }}
                  value={courseFilter}
                >
                  <option value="">Tất cả môn học</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.code} — {course.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Nút reset lọc */}
            {(gradeFilter || subjectFilter || (activeTab === "classes" && courseFilter) || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setGradeFilter("");
                  setSubjectFilter("");
                  setCourseFilter("");
                  setSearchQuery("");
                  classPagination.resetPage();
                  coursePagination.resetPage();
                }}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0 cursor-pointer"
                title="Xóa bộ lọc"
              >
                Xóa lọc
              </button>
            )}

            {/* TÁCH BIỆT NÚT THÊM Ở TỪNG CÁI: Môn học -> Thêm môn học, Lớp học -> Mở lớp học */}
            {manager && (
              <div className="shrink-0">
                {activeTab === "courses" ? (
                  <Button onClick={openCreateCourseModal} className="h-9 px-3.5 text-xs font-bold whitespace-nowrap">
                    <Plus size={15} />
                    Thêm môn học
                  </Button>
                ) : (
                  <Button onClick={openCreateClassModal} className="h-9 px-3.5 text-xs font-bold whitespace-nowrap">
                    <Plus size={15} />
                    Mở lớp học
                  </Button>
                )}
              </div>
            )}
          </div>

          <SectionState loading={loading} empty={manager && activeTab === "courses" ? pagedCourses.length === 0 : classes.length === 0}>
            <div>
              {manager && activeTab === "courses" ? (
                <section className="min-w-0">
                  <div className="flex items-center justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Danh mục môn học</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-600">Nội dung đào tạo và phiên bản đang được sử dụng.</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 rounded-full border border-sky-200/80 dark:border-sky-800/60 tabular-nums">
                      {coursePagination.totalItems} môn học
                    </span>
                  </div>
                  <div className="space-y-3">
                    {pagedCourses.map((course) => (
                      <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4.5 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all space-y-3" key={course.id}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                                {course.code} · v{course.version}
                              </span>
                              {course.grade && (
                                <span className="inline-flex items-center rounded-md bg-purple-50 dark:bg-purple-950/50 border border-purple-200/80 dark:border-purple-800/60 px-2 py-0.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                                  {formatGradeLabel(course.grade)}
                                </span>
                              )}
                              {course.subject && (
                                <span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                  {`Môn ${course.subject}`}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-100">{course.name}</h3>
                            <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-600 max-w-3xl">{course.description}</p>
                          </div>
                          <StatusBadge status={course.status} />
                        </div>
                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-600 dark:text-slate-600">
                            Lớp trực thuộc môn học này
                          </p>
                          <button
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:border-sky-400 transition-colors shadow-2xs cursor-pointer"
                            onClick={() => {
                              setCourseFilter(course.id);
                              classPagination.resetPage();
                              setActiveTab("classes");
                            }}
                            type="button"
                          >
                            <span>Mở danh sách lớp học</span>
                            <ArrowRight size={13} />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                          {course.status === "DRAFT" ? (
                            <Button onClick={() => void publish(course)} variant="secondary" className="h-8 text-xs">
                              <Rocket size={14} />
                              Xuất bản
                            </Button>
                          ) : null}
                          {course.status !== "ARCHIVED" ? (
                            <Button onClick={() => editCourse(course)} variant="ghost" className="h-8 text-xs">
                              <Pencil size={14} />
                              Sửa bản nháp
                            </Button>
                          ) : null}
                          <Button onClick={() => void openVersions(course)} variant="ghost" className="h-8 text-xs">
                            <History size={14} />
                            Lịch sử
                          </Button>
                          {course.status !== "ARCHIVED" ? (
                            <Button onClick={() => setArchiveTarget(course)} variant="ghost" className="h-8 text-xs text-rose-600 dark:text-rose-400">
                              <Archive size={14} />
                              Ngừng dùng
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                  <Pagination itemLabel="môn học" onPageChange={coursePagination.setPage} onPageSizeChange={coursePagination.setPageSize} page={coursePagination.displayPage} pageSize={coursePagination.pageSize} totalItems={coursePagination.totalItems} />
                </section>
              ) : null}

              {!manager || activeTab === "classes" ? (
                <section className="min-w-0">
                  <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {manager ? "Danh sách lớp học" : session.roleCode === "INSTRUCTOR" ? "Lớp đang dạy" : "Lớp đã ghi danh"}
                      </h2>
                      <span className="shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-0.5 rounded-full border border-blue-200/80 dark:border-blue-800/60 tabular-nums">
                        {classPagination.totalItems} lớp
                      </span>
                    </div>
                  </div>

                  {/* GIAO DIỆN DẠNG DANH SÁCH THẺ HÀNG NGANG (CARD LIST ROWS) */}
                  {classes.length === 0 ? (
                    <div className="py-16 text-center space-y-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8">
                      <GraduationCap className="mx-auto text-slate-300 dark:text-slate-600" size={48} />
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                        Không tìm thấy lớp học nào
                      </h3>
                      <p className="text-xs text-slate-600 max-w-sm mx-auto">
                        {searchQuery ? "Thử tìm kiếm với từ khóa khác hoặc xóa ô tìm kiếm." : manager ? "Chưa có lớp học nào được mở trong hệ thống." : "Bạn hiện chưa tham gia lớp học nào."}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {classes.map((item, idx) => {
                        const course = courses.find((c) => c.id === item.courseId);
                        const gradient = GRADIENTS[idx % GRADIENTS.length];
                        const classGrade = item.grade ?? course?.grade;
                        const classSubject = item.subject ?? course?.subject;
                        return (
                          <div
                            key={item.id}
                            onClick={() => router.push(`/courses/classes/${item.id}`)}
                            className="group relative cursor-pointer rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            {/* Cột thông tin chính: Avatar lớp hoặc icon gradient + Tên lớp + Mã lớp + Môn học + Khối */}
                            <div className="flex items-center gap-3.5 min-w-0">
                              <ClassAvatar
                                avatarUrl={item.avatarUrl}
                                name={item.name || item.code}
                                gradient={gradient}
                                sizeClass="size-12"
                                iconSize={22}
                                className="group-hover:scale-105 transition-transform"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 text-[11px] font-extrabold uppercase tracking-wide">
                                    {item.code}
                                  </span>
                                  {classGrade && (
                                    <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200/80 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                                      {formatGradeLabel(classGrade)}
                                    </span>
                                  )}
                                  {classSubject && (
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                      {classSubject}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-600 text-[10px] font-semibold">
                                    {item.term}
                                  </span>
                                </div>
                                <h3 className="mt-1 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                  {item.name || item.code}
                                </h3>
                                {course?.name && (
                                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-600 truncate">
                                    Môn học: <span className="font-medium text-slate-700 dark:text-slate-300">{course.name}</span> · v{item.courseVersion}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Cột thông tin phụ: Giảng viên + Sĩ số + Trạng thái + Nút vào lớp / Vào điều hành */}
                            <div className="flex items-center gap-4 sm:gap-5 flex-wrap md:flex-nowrap justify-between md:justify-end pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                              {manager && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-600">
                                  <UserCheck size={15} className="text-slate-600 shrink-0" />
                                  <span>
                                    GV: <strong className="text-slate-700 dark:text-slate-200">{item.instructorIds?.length ?? 0}</strong>
                                  </span>
                                </div>
                              )}

                              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-600">
                                <Users size={15} className="text-slate-600 shrink-0" />
                                <span>
                                  Sĩ số: <strong className="text-slate-700 dark:text-slate-200">{item.learnerIds?.length ?? 0}/{item.capacity ?? 40}</strong>
                                </span>
                              </div>

                              <StatusBadge status={item.status} />

                              {manager && item.status === "DRAFT" ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void activate(item);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold border border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-600 hover:text-white transition-all shadow-2xs cursor-pointer"
                                >
                                  Kích hoạt
                                </button>
                              ) : null}

                              <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold border border-blue-200/80 dark:border-blue-800/60 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-2xs">
                                <span>{manager ? "Vào điều hành" : "Vào lớp"}</span>
                                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Pagination className="mt-4" itemLabel="lớp học" onPageChange={classPagination.setPage} onPageSizeChange={classPagination.setPageSize} page={classPagination.displayPage} pageSize={classPagination.pageSize} totalItems={classPagination.totalItems} />
                </section>
              ) : null}
            </div>
          </SectionState>
        </main>
      </div>

      {/* MODAL TẠO / SỬA MÔN HỌC */}
      <Modal
        open={mode === "course"}
        onClose={() => { setMode(null); setEditingCourseId(null); setCourseForm(blankCourse); }}
        title={editingCourseId ? "Sửa môn học" : "Tạo môn học"}
        description={editingCourseId ? "Thay đổi được lưu thành bản nháp mới; các lớp đang chạy vẫn giữ snapshot cũ." : "Môn học được lưu ở trạng thái nháp để rà soát trước khi xuất bản."}
      >
        <form className="space-y-4" onSubmit={(e) => void createCourse(e)}>
          <Field label="Tên môn học">
            <input
              className={inputClass}
              required
              minLength={3}
              placeholder="VD: Tin học ứng dụng 11"
              value={courseForm.name}
              onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
            />
          </Field>

          {/* Phân cấp Khối & Môn học (12 khối + Khác, các môn + Khác) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Khối">
              <div className="space-y-2">
                <select
                  className={inputClass}
                  required
                  value={courseForm.grade}
                  onChange={(e) =>
                    setCourseForm({
                      ...courseForm,
                      grade: e.target.value,
                      customGrade:
                        e.target.value === CUSTOM_OPTION_VALUE ? courseForm.customGrade : "",
                    })
                  }
                >
                  <option value="">-- Chọn khối --</option>
                  {K12_GRADES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác</option>
                </select>
                {courseForm.grade === CUSTOM_OPTION_VALUE && (
                  <input
                    type="text"
                    className={inputClass}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="Nhập tên khối bất kỳ..."
                    value={courseForm.customGrade}
                    onChange={(e) =>
                      setCourseForm({ ...courseForm, customGrade: e.target.value })
                    }
                  />
                )}
              </div>
            </Field>
            <Field label="Môn học">
              <div className="space-y-2">
                <select
                  className={inputClass}
                  required
                  value={courseForm.subject}
                  onChange={(e) =>
                    setCourseForm({
                      ...courseForm,
                      subject: e.target.value,
                      customSubject:
                        e.target.value === CUSTOM_OPTION_VALUE ? courseForm.customSubject : "",
                    })
                  }
                >
                  <option value="">-- Chọn môn học --</option>
                  {K12_SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác</option>
                </select>
                {courseForm.subject === CUSTOM_OPTION_VALUE && (
                  <input
                    type="text"
                    className={inputClass}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="Nhập tên môn học bất kỳ..."
                    value={courseForm.customSubject}
                    onChange={(e) =>
                      setCourseForm({ ...courseForm, customSubject: e.target.value })
                    }
                  />
                )}
              </div>
            </Field>
          </div>

          <Field label="Mô tả">
            <input
              type="text"
              className={inputClass}
              placeholder="Nhập 1 dòng mô tả ngắn về môn học..."
              value={courseForm.description}
              onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
            />
          </Field>

          <Button loading={saving} type="submit">{editingCourseId ? "Lưu bản nháp" : "Tạo môn học"}</Button>
        </form>
      </Modal>

      {/* MODAL MỞ LỚP HỌC */}
      <Modal open={mode === "class"} onClose={() => setMode(null)} title="Mở lớp học">
        <form className="space-y-4" onSubmit={(e) => void createClass(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Khối">
              <div className="space-y-2">
                <select
                  aria-label="Chọn khối"
                  className={inputClass}
                  required
                  value={classForm.grade}
                  onChange={(e) =>
                    setClassForm({
                      ...classForm,
                      grade: e.target.value,
                      customGrade:
                        e.target.value === CUSTOM_OPTION_VALUE ? classForm.customGrade : "",
                    })
                  }
                >
                  <option value="">-- Chọn khối --</option>
                  {K12_GRADES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác</option>
                </select>
                {classForm.grade === CUSTOM_OPTION_VALUE && (
                  <input
                    type="text"
                    aria-label="Tên khối tùy chỉnh"
                    className={inputClass}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="Nhập tên khối bất kỳ..."
                    value={classForm.customGrade}
                    onChange={(e) =>
                      setClassForm({ ...classForm, customGrade: e.target.value })
                    }
                  />
                )}
              </div>
            </Field>

            <Field label="Môn học">
              <div className="space-y-2">
                <select
                  aria-label="Chọn môn học"
                  className={inputClass}
                  required
                  value={classForm.subject}
                  onChange={(e) =>
                    setClassForm({
                      ...classForm,
                      subject: e.target.value,
                      customSubject:
                        e.target.value === CUSTOM_OPTION_VALUE ? classForm.customSubject : "",
                    })
                  }
                >
                  <option value="">-- Chọn môn học --</option>
                  {K12_SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>Khác</option>
                </select>
                {classForm.subject === CUSTOM_OPTION_VALUE && (
                  <input
                    type="text"
                    aria-label="Tên môn học tùy chỉnh"
                    className={inputClass}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="Nhập tên môn học bất kỳ..."
                    value={classForm.customSubject}
                    onChange={(e) =>
                      setClassForm({ ...classForm, customSubject: e.target.value })
                    }
                  />
                )}
              </div>
            </Field>
          </div>

          <Field label="Tên lớp">
            <input
              className={inputClass}
              required
              minLength={2}
              placeholder="VD: Lớp 11A1 - Chuyên Tin"
              value={classForm.name}
              onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
            />
          </Field>

          <Field label="Sức chứa">
            <input
              className={inputClass}
              min={1}
              max={500}
              type="number"
              value={classForm.capacity}
              onChange={(e) => setClassForm({ ...classForm, capacity: Number(e.target.value) })}
            />
          </Field>

          <Field label="Mô tả lớp học (không bắt buộc)">
            <input
              type="text"
              className={inputClass}
              placeholder="1 dòng mô tả ngắn hoặc ghi chú về lớp học..."
              value={classForm.description}
              onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
            />
          </Field>

          <Field label="Ảnh đại diện lớp học (không bắt buộc)">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3">
              <ClassAvatar
                avatarUrl={newClassAvatarPreview}
                name={classForm.name || classForm.code || "Lớp học"}
                sizeClass="size-12"
                iconSize={22}
              />
              <div className="flex-1 min-w-44 space-y-1.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Không chọn ảnh sẽ dùng icon mặc định. Hỗ trợ PNG, JPEG, WebP tối đa 3 MB.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={newClassAvatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Chọn ảnh đại diện khi tạo lớp"
                    className="hidden"
                    onChange={handleSelectNewClassAvatar}
                  />
                  <button
                    type="button"
                    onClick={() => newClassAvatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <ImagePlus size={13} />
                    <span>Chọn ảnh đại diện</span>
                  </button>
                  {newClassAvatarPreview && (
                    <button
                      type="button"
                      onClick={clearNewClassAvatar}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Dùng icon mặc định</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Field>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/40">
              <input
                type="checkbox"
                checked={classForm.allowPeerGradeViewing}
                onChange={(event) =>
                  setClassForm((current) => ({
                    ...current,
                    allowPeerGradeViewing: event.target.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 accent-blue-600"
              />
              <span>
                <strong className="block text-slate-900 dark:text-slate-100">
                  Cho phép học sinh xem bảng điểm
                </strong>
                <span className="text-slate-500 dark:text-slate-400">
                  Học sinh chỉ xem bảng điểm, không có thao tác chấm bài hay xem chi tiết bài làm.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/40">
              <input
                type="checkbox"
                checked={classForm.allowLearnerFeedPosting}
                onChange={(event) =>
                  setClassForm((current) => ({
                    ...current,
                    allowLearnerFeedPosting: event.target.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 accent-blue-600"
              />
              <span>
                <strong className="block text-slate-900 dark:text-slate-100">
                  Cho phép học sinh đăng bài trên bảng tin
                </strong>
                <span className="text-slate-500 dark:text-slate-400">
                  Học sinh có thể tạo bài viết mới kèm ảnh/tệp trên bảng tin lớp học.
                </span>
              </span>
            </label>
          </div>

          <Button
            disabled={!effectiveClassGrade || !effectiveClassSubject || classForm.name.trim().length < 2}
            loading={saving}
            type="submit"
          >
            Mở lớp
          </Button>
        </form>
      </Modal>

      <Modal open={Boolean(versionTarget)} onClose={() => { versionRequestId.current += 1; setVersionTarget(null); }} title={`Lịch sử ${versionTarget?.code ?? "môn học"}`} description="Mỗi phiên bản đã phát hành là snapshot bất biến; lớp học tiếp tục dùng đúng version đã chọn lúc mở.">
        <div className="space-y-3">
          {versions.length ? versions.map((version) => (
            <article className="rounded-xl border border-slate-200 p-4" key={version.id}>
              <div className="flex items-center justify-between">
                <strong>Phiên bản {version.version}</strong>
                <span className="text-xs text-slate-500">{new Date(version.publishedAt).toLocaleString(activeLocale())}</span>
              </div>
              <p className="mt-2 text-sm font-bold">{version.name}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{version.outcomes.join(" · ")}</p>
            </article>
          )) : <p className="text-sm text-slate-500">Môn học chưa có phiên bản phát hành.</p>}
        </div>
      </Modal>
      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => { if (!saving) { setArchiveTarget(null); } }}
        title={`Ngừng sử dụng ${archiveTarget?.code ?? "môn học"}`}
        description="Khóa học sẽ không thể mở lớp mới; lớp hiện có và snapshot phiên bản vẫn được giữ nguyên."
      >
        <form className="space-y-4" onSubmit={(event) => void archiveCourse(event)}>
          <div className="flex justify-end gap-2">
            <Button disabled={saving} onClick={() => { setArchiveTarget(null); }} variant="ghost">Hủy</Button>
            <Button loading={saving} type="submit" variant="danger">Xác nhận ngừng dùng</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
