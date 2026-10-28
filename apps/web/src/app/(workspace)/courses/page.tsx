"use client";

import { activeLocale } from "@/i18n/runtime";

import { Archive, ArrowRight, BookOpen, Calendar, GraduationCap, History, Pencil, Plus, Rocket, Search, UserCheck, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, Tabs, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { K12_GRADES, K12_SUBJECTS, type Course, type CourseVersionSnapshot, type LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

const blankCourse = { code: "", name: "", description: "", outcomes: "", grade: "", subject: "" };
const blankClass = { courseId: "", code: "", name: "", term: "2026-2027", grade: "", subject: "", startAt: "", endAt: "", capacity: 40, timezone: "Asia/Bangkok", allowLateEnrollment: false };

/** Màu sắc banner card lớp học ngẫu nhiên theo chỉ số */
const GRADIENTS = [
  "from-blue-600 to-indigo-600",
  "from-emerald-600 to-teal-600",
  "from-violet-600 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-amber-600 to-orange-600",
  "from-rose-600 to-pink-600",
];

/** Hiển thị khóa học và lớp theo tab độc lập, kèm luồng tạo, phiên bản hóa và kích hoạt. */
export default function CoursesPage() {
  const router = useRouter();
  const { session, notify } = useApp();
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [activeTab, setActiveTab] = useState<"courses" | "classes">("classes");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"course" | "class" | null>(null);
  const [courseForm, setCourseForm] = useState(blankCourse);
  const [classForm, setClassForm] = useState(blankClass);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<Course | null>(null);
  const [versions, setVersions] = useState<CourseVersionSnapshot[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  
  // Bộ lọc chuẩn K-12: Khối -> Môn -> Lớp/Khóa học
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const isLearner = session.roleCode === "LEARNER";
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "course:manage");

  // Danh sách các môn học có thể chọn lọc (theo khối đang chọn hoặc toàn bộ)
  const availableSubjects = useMemo(() => {
    const list = new Set<string>();
    courses.forEach((c) => {
      if (!gradeFilter || String(c.grade) === gradeFilter) {
        if (c.subject) list.add(c.subject);
      }
    });
    classes.forEach((cl) => {
      if (!gradeFilter || String(cl.grade) === gradeFilter) {
        if (cl.subject) list.add(cl.subject);
      }
    });
    if (list.size === 0) {
      K12_SUBJECTS.forEach((s) => list.add(s));
    }
    return Array.from(list);
  }, [courses, classes, gradeFilter]);

  const displayCourses = useMemo(() => {
    let result = courses;
    if (gradeFilter) {
      result = result.filter((item) => String(item.grade) === gradeFilter);
    }
    if (subjectFilter) {
      result = result.filter((item) => item.subject === subjectFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [courses, gradeFilter, subjectFilter, searchQuery]);

  const displayClasses = useMemo(() => {
    let result = classes;
    if (gradeFilter) {
      result = result.filter((item) => {
        if (item.grade) return String(item.grade) === gradeFilter;
        const course = courses.find((c) => c.id === item.courseId);
        return course ? String(course.grade) === gradeFilter : false;
      });
    }
    if (subjectFilter) {
      result = result.filter((item) => {
        if (item.subject) return item.subject === subjectFilter;
        const course = courses.find((c) => c.id === item.courseId);
        return course ? course.subject === subjectFilter : false;
      });
    }
    if (courseFilter) {
      result = result.filter((item) => item.courseId === courseFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.term.toLowerCase().includes(q)
      );
    }
    return result;
  }, [classes, courses, gradeFilter, subjectFilter, courseFilter, searchQuery]);

  const coursePagination = usePagination(displayCourses);
  const classPagination = usePagination(displayClasses);

  /** Nạp khóa học dành cho quản lý và các lớp mà vai trò hiện tại được phép truy cập. */
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [courseData, classData] = await Promise.all([
        manager ? apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode }) : Promise.resolve([]),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
      ]);
      setCourses(courseData);
      setClasses(classData);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được dữ liệu.", "error");
    } finally {
      setLoading(false);
    }
  }, [allowed, manager, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Tạo khóa học mới hoặc tạo bản nháp phiên bản kế tiếp từ khóa học đang sửa. */
  const createCourse = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...courseForm,
        grade: courseForm.grade ? Number(courseForm.grade) : undefined,
        subject: courseForm.subject?.trim() || undefined,
        outcomes: courseForm.outcomes.split("\n").map((item) => item.trim()).filter(Boolean),
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
      notify(editingCourseId ? "Đã tạo bản nháp mới; phiên bản đang dùng của lớp không đổi." : "Đã tạo khóa học bản nháp.");
      setMode(null);
      setEditingCourseId(null);
      setCourseForm(blankCourse);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được khóa học.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Mở lớp mới từ khóa học đã chọn và chuẩn hóa thời gian sang ISO trước khi gửi. */
  const createClass = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/manager/classes", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          ...classForm,
          grade: classForm.grade ? Number(classForm.grade) : undefined,
          subject: classForm.subject?.trim() || undefined,
          startAt: new Date(classForm.startAt).toISOString(),
          endAt: new Date(classForm.endAt).toISOString(),
        }),
      });
      notify("Đã mở lớp học mới.");
      setMode(null);
      setClassForm(blankClass);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tạo được lớp.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Xuất bản phiên bản khóa học để có thể dùng cho hoạt động giảng dạy. */
  const publish = async (course: Course) => {
    try {
      await apiRequest(`/manager/courses/${course.id}/publish`, { method: "POST", roleCode: session.roleCode });
      notify("Đã xuất bản khóa học.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xuất bản được.", "error");
    }
  };

  /** Đưa dữ liệu khóa học vào biểu mẫu để tạo bản nháp chỉnh sửa mới. */
  const editCourse = (course: Course) => {
    setEditingCourseId(course.id);
    setCourseForm({
      code: course.code,
      name: course.name,
      description: course.description,
      grade: course.grade ? String(course.grade) : "",
      subject: course.subject || "",
      outcomes: course.outcomes.join("\n"),
    });
    setMode("course");
  };

  /** Nạp lịch sử phiên bản và mở bảng đối chiếu của khóa học. */
  const openVersions = async (course: Course) => {
    try {
      setVersions(await apiRequest<CourseVersionSnapshot[]>(`/manager/courses/${course.id}/versions`, { roleCode: session.roleCode }));
      setVersionTarget(course);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được lịch sử phiên bản.", "error");
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
        body: JSON.stringify({ reason: archiveReason }),
      });
      notify("Đã ngừng sử dụng khóa học; các lớp cũ vẫn giữ phiên bản đã chọn.");
      setArchiveTarget(null);
      setArchiveReason("");
      await load();
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
  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <PageHeader
        title={session.roleCode === "LEARNER" ? "Lớp của tôi" : session.roleCode === "INSTRUCTOR" ? "Lớp giảng dạy" : "Khóa học & lớp"}
        description={manager ? "Quản lý danh mục đào tạo, kỳ học, phân cấp Khối - Môn và vòng đời lớp." : session.roleCode === "INSTRUCTOR" ? "Danh sách các lớp học bạn được phân công giảng dạy." : "Danh sách các lớp học bạn đã ghi danh tham gia."}
      />

      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="mt-4 flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC: KHÓA HỌC / LỚP HỌC */}
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Chức năng đào tạo
            </div>

            <button
              type="button"
              onClick={() => { setActiveTab("classes"); classPagination.resetPage(); }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === "classes"
                  ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <GraduationCap size={18} className={activeTab === "classes" ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                <span className="truncate">Lớp học</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                activeTab === "classes"
                  ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}>
                {displayClasses.length}
              </span>
            </button>

            {manager && (
              <button
                type="button"
                onClick={() => { setActiveTab("courses"); coursePagination.resetPage(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                  activeTab === "courses"
                    ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookOpen size={18} className={activeTab === "courses" ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                  <span className="truncate">Khóa học</span>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                  activeTab === "courses"
                    ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                }`}>
                  {displayCourses.length}
                </span>
              </button>
            )}
          </div>

          {/* Widget tóm tắt nhỏ phía dưới để không bị trống trải */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 shadow-xs text-xs space-y-2.5 hidden lg:block">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Chỉ số danh mục</div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Tổng lớp học:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{classes.length}</span>
            </div>
            {manager && (
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span>Tổng khóa đào tạo:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{courses.length}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
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
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  classPagination.resetPage();
                  coursePagination.resetPage();
                }}
                placeholder={activeTab === "courses" ? "Tìm kiếm khóa học theo tên, mã, mô tả..." : "Tìm kiếm lớp học theo tên, mã lớp, học kỳ..."}
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    classPagination.resetPage();
                    coursePagination.resetPage();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
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
                </select>
              </div>
            )}

            {/* Lọc Khóa học (chỉ hiện khi ở tab Lớp học) */}
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
                  <option value="">Tất cả khóa</option>
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

            {/* TÁCH BIỆT NÚT THÊM Ở TỪNG CÁI: Khóa học -> Nút Thêm khóa học, Lớp học -> Nút Mở lớp học */}
            {manager && (
              <div className="shrink-0">
                {activeTab === "courses" ? (
                  <Button onClick={() => setMode("course")} className="h-9 px-3.5 text-xs font-bold whitespace-nowrap">
                    <Plus size={15} />
                    Thêm khóa học
                  </Button>
                ) : (
                  <Button onClick={() => setMode("class")} className="h-9 px-3.5 text-xs font-bold whitespace-nowrap">
                    <Plus size={15} />
                    Mở lớp học
                  </Button>
                )}
              </div>
            )}
          </div>

          <SectionState loading={loading} empty={manager ? activeTab === "courses" ? displayCourses.length === 0 : displayClasses.length === 0 : displayClasses.length === 0}>
            <div>
              {manager && activeTab === "courses" ? (
                <section className="min-w-0">
                  <div className="flex items-center justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Danh mục khóa học</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Nội dung đào tạo và phiên bản đang được sử dụng.</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 rounded-full border border-sky-200/80 dark:border-sky-800/60 tabular-nums">
                      {displayCourses.length} khóa học
                    </span>
                  </div>
                  <div className="space-y-3">
                    {coursePagination.pageItems.map((course) => (
                      <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4.5 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all space-y-3" key={course.id}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                                {course.code} · v{course.version}
                              </span>
                              {course.grade && (
                                <span className="inline-flex items-center rounded-md bg-purple-50 dark:bg-purple-950/50 border border-purple-200/80 dark:border-purple-800/60 px-2 py-0.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                                  {`Khối ${course.grade}`}
                                </span>
                              )}
                              {course.subject && (
                                <span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                  {`Môn ${course.subject}`}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-100">{course.name}</h3>
                            <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400 max-w-3xl">{course.description}</p>
                          </div>
                          <StatusBadge status={course.status} />
                        </div>
                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3">
                          <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                            {`Lớp trực thuộc (${classes.filter((item) => item.courseId === course.id).length})`}
                          </p>
                          {classes.some((item) => item.courseId === course.id) ? (
                            <ul className="mt-2 flex flex-wrap gap-2">
                              {classes.filter((item) => item.courseId === course.id).map((item) => (
                                <li key={item.id}>
                                  <button
                                    className="inline-flex items-center gap-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-xs font-semibold hover:border-sky-400 transition-colors shadow-2xs"
                                    onClick={() => router.push(`/courses/classes/${item.id}`)}
                                    type="button"
                                  >
                                    <span>{item.code} · {item.term}</span>
                                    <StatusBadge status={item.status} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-xs text-slate-400">Chưa có lớp nào mở cho khóa này.</p>
                          )}
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
                  <Pagination itemLabel="khóa học" onPageChange={coursePagination.setPage} onPageSizeChange={coursePagination.setPageSize} page={coursePagination.page} pageSize={coursePagination.pageSize} totalItems={coursePagination.totalItems} />
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
                        {displayClasses.length} lớp
                      </span>
                    </div>
                  </div>

                  {manager && !displayClasses.length && classes.length ? (
                    <p className="my-4 text-xs text-slate-500">Không có lớp nào phù hợp với bộ lọc hiện tại.</p>
                  ) : null}

            {/* GIAO DIỆN DẠNG DANH SÁCH THẺ HÀNG NGANG (CARD LIST ROWS) ĐỒNG BỘ CHO TẤT CẢ VAI TRÒ */}
            {displayClasses.length === 0 ? (
              <div className="py-16 text-center space-y-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8">
                <GraduationCap className="mx-auto text-slate-300 dark:text-slate-600" size={48} />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Không tìm thấy lớp học nào
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {searchQuery ? "Thử tìm kiếm với từ khóa khác hoặc xóa ô tìm kiếm." : manager ? "Chưa có lớp học nào được mở trong hệ thống." : "Bạn hiện chưa tham gia lớp học nào."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {classPagination.pageItems.map((item, idx) => {
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
                      {/* Cột thông tin chính: Icon gradient + Tên lớp + Mã lớp + Môn học + Khối */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className={`size-12 rounded-xl bg-gradient-to-tr ${gradient} grid place-items-center text-white shrink-0 shadow-xs group-hover:scale-105 transition-transform`}>
                          <GraduationCap size={22} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 text-[11px] font-extrabold uppercase tracking-wide">
                              {item.code}
                            </span>
                            {classGrade && (
                              <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200/80 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                                {`Khối ${classGrade}`}
                              </span>
                            )}
                            {classSubject && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                {classSubject}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-semibold">
                              {item.term}
                            </span>
                          </div>
                          <h3 className="mt-1 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                            {item.name || item.code}
                          </h3>
                          {course?.name && (
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                              Khóa học: <span className="font-medium text-slate-700 dark:text-slate-300">{course.name}</span> · v{item.courseVersion}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Cột thông tin phụ: Giảng viên + Sĩ số + Khai giảng + Trạng thái + Nút vào lớp / Vào điều hành */}
                      <div className="flex items-center gap-4 sm:gap-5 flex-wrap md:flex-nowrap justify-between md:justify-end pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                        {manager && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <UserCheck size={15} className="text-slate-400 shrink-0" />
                            <span>
                              GV: <strong className="text-slate-700 dark:text-slate-200">{item.instructorIds?.length ?? 0}</strong>
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <Users size={15} className="text-slate-400 shrink-0" />
                          <span>
                            Sĩ số: <strong className="text-slate-700 dark:text-slate-200">{item.learnerIds?.length ?? 0}/{item.capacity ?? 40}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <Calendar size={15} className="text-slate-400 shrink-0" />
                          <span>
                            Khai giảng: <strong className="text-slate-700 dark:text-slate-200">{new Date(item.startAt).toLocaleDateString(activeLocale())}</strong>
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
            <Pagination className="mt-4" itemLabel="lớp học" onPageChange={classPagination.setPage} onPageSizeChange={classPagination.setPageSize} page={classPagination.page} pageSize={classPagination.pageSize} totalItems={classPagination.totalItems} />
          </section>
        ) : null}
      </div>
    </SectionState>
  </main>
</div>

    {/* MODAL TẠO / SỬA KHÓA HỌC */}
    <Modal
      open={mode === "course"}
      onClose={() => { setMode(null); setEditingCourseId(null); setCourseForm(blankCourse); }}
      title={editingCourseId ? "Sửa khóa học" : "Tạo khóa học"}
      description={editingCourseId ? "Thay đổi được lưu thành bản nháp mới; các lớp đang chạy vẫn giữ snapshot cũ." : "Khóa học được lưu ở trạng thái nháp để rà soát trước khi xuất bản."}
    >
      <form className="space-y-4" onSubmit={(e) => void createCourse(e)}>
        <Field label="Mã khóa học">
          <input className={inputClass} disabled={Boolean(editingCourseId)} required value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })} />
        </Field>
        <Field label="Tên khóa học">
          <input className={inputClass} required minLength={3} value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} />
        </Field>

        {/* Phân cấp chuẩn K-12: Khối lớp & Môn học */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Khối lớp (K-12)">
            <select
              className={inputClass}
              value={courseForm.grade}
              onChange={(e) => setCourseForm({ ...courseForm, grade: e.target.value })}
            >
              <option value="">-- Chọn khối --</option>
              {K12_GRADES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Môn học">
            <input
              list="k12-subject-list"
              className={inputClass}
              placeholder="VD: Toán, Ngữ văn, Tiếng Anh..."
              value={courseForm.subject}
              onChange={(e) => setCourseForm({ ...courseForm, subject: e.target.value })}
            />
            <datalist id="k12-subject-list">
              {K12_SUBJECTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field label="Mô tả">
          <textarea className={inputClass} required minLength={10} rows={3} value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
        </Field>
        <Field label="Chuẩn đầu ra — mỗi dòng một mục">
          <textarea className={inputClass} required rows={3} value={courseForm.outcomes} onChange={(e) => setCourseForm({ ...courseForm, outcomes: e.target.value })} />
        </Field>
        <Button loading={saving} type="submit">{editingCourseId ? "Lưu bản nháp" : "Tạo khóa học"}</Button>
      </form>
    </Modal>

    {/* MODAL MỞ LỚP HỌC */}
    <Modal open={mode === "class"} onClose={() => setMode(null)} title="Mở lớp học">
      <form className="space-y-4" onSubmit={(e) => void createClass(e)}>
        <Field label="Khóa học">
          <SearchableSelect
            aria-label="Tìm và chọn khóa học"
            onChange={(value) => {
              const selectedCrs = courses.find((c) => c.id === value);
              setClassForm({
                ...classForm,
                courseId: value,
                grade: selectedCrs?.grade ? String(selectedCrs.grade) : "",
                subject: selectedCrs?.subject || "",
              });
            }}
            options={courses.filter((course) => course.status === "PUBLISHED").map((course) => ({
              value: course.id,
              label: `${course.code} — ${course.name}`,
              description: `Khối ${course.grade ?? "?"} · Môn ${course.subject ?? "?"} · v${course.version}`,
              keywords: `${course.id} ${course.subject ?? ""} ${course.grade ?? ""}`
            }))}
            placeholder="Gõ mã hoặc tên khóa học để lọc…"
            value={classForm.courseId}
          />
        </Field>

        {/* Hiển thị Khối & Môn theo khóa học được chọn */}
        {classForm.courseId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 text-xs">
            <span className="font-bold text-slate-500 dark:text-slate-400">Phân cấp K-12 kế thừa:</span>
            {classForm.grade ? (
              <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200/80 text-purple-700 dark:text-purple-300 font-bold">
                Khối {classForm.grade}
              </span>
            ) : null}
            {classForm.subject ? (
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 text-emerald-700 dark:text-emerald-300 font-bold">
                Môn {classForm.subject}
              </span>
            ) : null}
            {!classForm.grade && !classForm.subject && (
              <span className="text-slate-400 italic">Khóa học này chưa thiết lập Khối & Môn</span>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mã lớp">
            <input className={inputClass} required value={classForm.code} onChange={(e) => setClassForm({ ...classForm, code: e.target.value })} />
          </Field>
          <Field label="Học kỳ">
            <input className={inputClass} required value={classForm.term} onChange={(e) => setClassForm({ ...classForm, term: e.target.value })} />
          </Field>
        </div>

        <Field label="Tên lớp">
          <input className={inputClass} required value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bắt đầu">
            <input className={inputClass} required type="datetime-local" value={classForm.startAt} onChange={(e) => setClassForm({ ...classForm, startAt: e.target.value })} />
          </Field>
          <Field label="Kết thúc">
            <input className={inputClass} required type="datetime-local" value={classForm.endAt} onChange={(e) => setClassForm({ ...classForm, endAt: e.target.value })} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sức chứa">
            <input className={inputClass} min={1} type="number" value={classForm.capacity} onChange={(e) => setClassForm({ ...classForm, capacity: Number(e.target.value) })} />
          </Field>
          <Field label="Múi giờ">
            <input className={inputClass} required value={classForm.timezone} onChange={(e) => setClassForm({ ...classForm, timezone: e.target.value })} />
          </Field>
        </div>

        <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
          <input checked={classForm.allowLateEnrollment} className="size-5 accent-sky-600" onChange={(e) => setClassForm({ ...classForm, allowLateEnrollment: e.target.checked })} type="checkbox" />
          Cho phép ghi danh sau ngày khai giảng
        </label>

        <Button disabled={!classForm.courseId} loading={saving} type="submit">Mở lớp</Button>
      </form>
    </Modal>
    <Modal open={Boolean(versionTarget)} onClose={() => setVersionTarget(null)} title={`Lịch sử ${versionTarget?.code ?? "khóa học"}`} description="Mỗi phiên bản đã phát hành là snapshot bất biến; lớp học tiếp tục dùng đúng version đã chọn lúc mở."><div className="space-y-3">{versions.length ? versions.map((version) => <article className="rounded-xl border border-slate-200 p-4" key={version.id}><div className="flex items-center justify-between"><strong>Phiên bản {version.version}</strong><span className="text-xs text-slate-500">{new Date(version.publishedAt).toLocaleString(activeLocale())}</span></div><p className="mt-2 text-sm font-bold">{version.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{version.outcomes.join(" · ")}</p></article>) : <p className="text-sm text-slate-500">Khóa học chưa có phiên bản phát hành.</p>}</div></Modal>
  </div>
  );
}
