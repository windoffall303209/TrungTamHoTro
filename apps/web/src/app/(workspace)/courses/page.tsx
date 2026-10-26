"use client";

import { activeLocale } from "@/i18n/runtime";

import { Archive, ArrowRight, BookOpen, Calendar, GraduationCap, History, Pencil, Plus, Rocket, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, Tabs, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { Course, CourseVersionSnapshot, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

const blankCourse = { code: "", name: "", description: "", outcomes: "" };
const blankClass = { courseId: "", code: "", name: "", term: "2026-2027", startAt: "", endAt: "", capacity: 40, timezone: "Asia/Bangkok", allowLateEnrollment: false };

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
  const [courses, setCourses] = useState<Course[]>([]); const [classes, setClasses] = useState<LearningClass[]>([]);
  const [activeTab, setActiveTab] = useState<"courses" | "classes">("classes");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [mode, setMode] = useState<"course" | "class" | null>(null);
  const [courseForm, setCourseForm] = useState(blankCourse); const [classForm, setClassForm] = useState(blankClass);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null); const [versionTarget, setVersionTarget] = useState<Course | null>(null); const [versions, setVersions] = useState<CourseVersionSnapshot[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null); const [archiveReason, setArchiveReason] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const isLearner = session.roleCode === "LEARNER";
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "course:manage");

  const displayClasses = useMemo(() => {
    let result = classes;
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
  }, [classes, courseFilter, searchQuery]);

  const coursePagination = usePagination(courses);
  const classPagination = usePagination(displayClasses);
  /** Nạp khóa học dành cho quản lý và các lớp mà vai trò hiện tại được phép truy cập. */
  const load = useCallback(async () => { if (!allowed) return; setLoading(true); try { const [courseData, classData] = await Promise.all([manager ? apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode }) : Promise.resolve([]), apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode })]); setCourses(courseData); setClasses(classData); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được dữ liệu.", "error"); } finally { setLoading(false); } }, [allowed, manager, notify, session.roleCode]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  /** Tạo khóa học mới hoặc tạo bản nháp phiên bản kế tiếp từ khóa học đang sửa. */
  const createCourse = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { const payload = { ...courseForm, outcomes: courseForm.outcomes.split("\n").map((item) => item.trim()).filter(Boolean) }; await apiRequest(editingCourseId ? `/manager/courses/${editingCourseId}` : "/manager/courses", { method: editingCourseId ? "PATCH" : "POST", roleCode: session.roleCode, body: JSON.stringify(editingCourseId ? { name: payload.name, description: payload.description, outcomes: payload.outcomes } : payload) }); notify(editingCourseId ? "Đã tạo bản nháp mới; phiên bản đang dùng của lớp không đổi." : "Đã tạo khóa học bản nháp."); setMode(null); setEditingCourseId(null); setCourseForm(blankCourse); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không lưu được khóa học.", "error"); } finally { setSaving(false); } };
  /** Mở lớp mới từ khóa học đã chọn và chuẩn hóa thời gian sang ISO trước khi gửi. */
  const createClass = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { await apiRequest("/manager/classes", { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ ...classForm, startAt: new Date(classForm.startAt).toISOString(), endAt: new Date(classForm.endAt).toISOString() }) }); notify("Đã mở lớp học mới."); setMode(null); setClassForm(blankClass); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không tạo được lớp.", "error"); } finally { setSaving(false); } };
  /** Xuất bản phiên bản khóa học để có thể dùng cho hoạt động giảng dạy. */
  const publish = async (course: Course) => { try { await apiRequest(`/manager/courses/${course.id}/publish`, { method: "POST", roleCode: session.roleCode }); notify("Đã xuất bản khóa học."); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không xuất bản được.", "error"); } };
  /** Đưa dữ liệu khóa học vào biểu mẫu để tạo bản nháp chỉnh sửa mới. */
  const editCourse = (course: Course) => { setEditingCourseId(course.id); setCourseForm({ code: course.code, name: course.name, description: course.description, outcomes: course.outcomes.join("\n") }); setMode("course"); };
  /** Nạp lịch sử phiên bản và mở bảng đối chiếu của khóa học. */
  const openVersions = async (course: Course) => { try { setVersions(await apiRequest<CourseVersionSnapshot[]>(`/manager/courses/${course.id}/versions`, { roleCode: session.roleCode })); setVersionTarget(course); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được lịch sử phiên bản.", "error"); } };
  /** Ngừng sử dụng khóa học nhưng giữ snapshot mà các lớp cũ đang tham chiếu. */
  const archiveCourse = async (event: React.FormEvent) => { event.preventDefault(); if (!archiveTarget) return; try { setSaving(true); await apiRequest(`/manager/courses/${archiveTarget.id}/archive`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ reason: archiveReason }) }); notify("Đã ngừng sử dụng khóa học; các lớp cũ vẫn giữ phiên bản đã chọn."); setArchiveTarget(null); setArchiveReason(""); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không ngừng sử dụng được khóa học.", "error"); } finally { setSaving(false); } };
  /** Kích hoạt lớp sau khi API xác nhận các điều kiện vận hành cần thiết. */
  const activate = async (item: LearningClass) => { try { await apiRequest(`/manager/classes/${item.id}/activate`, { method: "POST", roleCode: session.roleCode }); notify("Lớp đã được kích hoạt."); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không kích hoạt được.", "error"); } };
  return <div className="w-full px-5 sm:px-6 lg:px-8 py-5"><PageHeader title={session.roleCode === "LEARNER" ? "Lớp của tôi" : session.roleCode === "INSTRUCTOR" ? "Lớp giảng dạy" : "Khóa học & lớp"} description={manager ? "Quản lý danh mục đào tạo, kỳ học, sức chứa và vòng đời lớp." : "Theo dõi các lớp được phân công hoặc đã ghi danh theo đúng phạm vi truy cập."} actions={manager ? <div className="flex gap-2"><Button onClick={() => setMode("course")} variant="secondary"><BookOpen size={17} />Khóa học</Button><Button onClick={() => setMode("class")}><Plus size={17} />Mở lớp</Button></div> : undefined} />
    {manager ? <Tabs className="mt-3.5 mb-3" items={[{ value: "courses", label: "Khóa học", count: courses.length }, { value: "classes", label: "Lớp học", count: classes.length }]} label="Chọn nội dung quản lý" onChange={setActiveTab} value={activeTab} /> : null}
    <SectionState loading={loading} empty={manager ? activeTab === "courses" ? courses.length === 0 : classes.length === 0 : classes.length === 0}>
      <div className="mt-3.5">
        {manager && activeTab === "courses" ? (
          <section className="min-w-0">
            <div className="flex items-end justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">Danh mục khóa học</h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">Nội dung đào tạo và phiên bản đang được sử dụng.</p>
              </div>
              <span className="shrink-0 text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 rounded-full border border-sky-200/80 dark:border-sky-800/60 tabular-nums">
                {courses.length} khóa học
              </span>
            </div>
            <div className="space-y-3">
              {coursePagination.pageItems.map((course) => (
                <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4.5 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all space-y-3" key={course.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                        {course.code} · v{course.version}
                      </span>
                      <h3 className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-100">{course.name}</h3>
                      <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400 max-w-3xl">{course.description}</p>
                    </div>
                    <StatusBadge status={course.status} />
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                      Lớp trực thuộc ({classes.filter((item) => item.courseId === course.id).length})
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
            {/* Thanh tìm kiếm và tiêu đề danh sách lớp */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  {manager ? "Lớp đang quản lý" : session.roleCode === "INSTRUCTOR" ? "Lớp được phân công" : "Lớp đã ghi danh"}
                </span>
                <span className="shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-0.5 rounded-full border border-blue-200/80 dark:border-blue-800/60 tabular-nums">
                  {displayClasses.length} lớp
                </span>
              </div>

              {/* Thanh tìm kiếm lớp học căn ra CHÍNH GIỮA */}
              <div className="relative w-full max-w-md mx-auto">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    classPagination.resetPage();
                  }}
                  placeholder="Tìm kiếm lớp học theo tên, mã lớp, học kỳ..."
                  className="w-full pl-9.5 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-2xs transition-all"
                />
              </div>

              {/* Giữ cân bằng cho thanh tìm kiếm ở giữa trên màn hình desktop */}
              <div className="hidden md:block shrink-0 w-28" />
            </div>

            {manager ? (
              <div className="mb-3 max-w-sm">
                <Field label="Lọc theo khóa học">
                  <select
                    className={`${inputClass} h-9 text-xs sm:text-sm`}
                    onChange={(event) => { setCourseFilter(event.target.value); classPagination.resetPage(); }}
                    value={courseFilter}
                  >
                    <option value="">Tất cả khóa học</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code} — {course.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}

            {manager && !displayClasses.length && classes.length ? (
              <p className="my-4 text-xs text-slate-500">Không có lớp nào thuộc khóa học này.</p>
            ) : null}

            {isLearner ? (
              /* GIAO DIỆN DẠNG DANH SÁCH (LIST ROWS) CHO HỌC SINH - CLICK VÀO HÀNG ĐỂ VÀO LỚP */
              displayClasses.length === 0 ? (
                <div className="py-16 text-center space-y-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8">
                  <GraduationCap className="mx-auto text-slate-300 dark:text-slate-600" size={48} />
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Không tìm thấy lớp học nào
                  </h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {searchQuery ? "Thử tìm kiếm với từ khóa khác hoặc xóa ô tìm kiếm." : "Bạn hiện chưa tham gia lớp học nào."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {classPagination.pageItems.map((item, idx) => {
                    const course = courses.find((c) => c.id === item.courseId);
                    const gradient = GRADIENTS[idx % GRADIENTS.length];
                    return (
                      <div
                        key={item.id}
                        onClick={() => router.push(`/courses/classes/${item.id}`)}
                        className="group relative cursor-pointer rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        {/* Cột thông tin chính: Icon gradient + Tên lớp + Mã lớp + Môn học */}
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className={`size-12 rounded-xl bg-gradient-to-tr ${gradient} grid place-items-center text-white shrink-0 shadow-xs group-hover:scale-105 transition-transform`}>
                            <GraduationCap size={22} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 text-[11px] font-extrabold uppercase tracking-wide">
                                {item.code}
                              </span>
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-semibold">
                                {item.term}
                              </span>
                            </div>
                            <h3 className="mt-1 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                              {item.name || item.code}
                            </h3>
                            {course?.name && (
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                                Khóa học: <span className="font-medium text-slate-700 dark:text-slate-300">{course.name}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Cột thông tin phụ: Sĩ số + Ngày khai giảng + Trạng thái + Nút vào lớp */}
                        <div className="flex items-center gap-5 sm:gap-6 flex-wrap md:flex-nowrap justify-between md:justify-end pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <Users size={15} className="text-slate-400 shrink-0" />
                            <span>
                              Sĩ số: <strong className="text-slate-700 dark:text-slate-200">{item.learnerIds?.length ?? 0}/{item.capacity ?? 40}</strong>
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <Calendar size={15} className="text-slate-400 shrink-0" />
                            <span>
                              Khai giảng: <strong className="text-slate-700 dark:text-slate-200">{new Date(item.startAt).toLocaleDateString(activeLocale())}</strong>
                            </span>
                          </div>

                          <StatusBadge status={item.status} />

                          <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold border border-blue-200/80 dark:border-blue-800/60 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-2xs">
                            <span>Vào lớp</span>
                            <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              /* GIAO DIỆN BẢNG DÀNH CHO MANAGER / INSTRUCTOR */
              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-2.5">Lớp học</th>
                        <th className="px-3.5 py-2.5">Học kỳ / Khóa</th>
                        <th className="px-3 py-2.5 text-center">Giảng viên</th>
                        <th className="px-3 py-2.5 text-center">Sĩ số</th>
                        <th className="px-3.5 py-2.5">Khai giảng</th>
                        <th className="px-3.5 py-2.5 text-center">Trạng thái</th>
                        <th className="px-4 py-2.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {classPagination.pageItems.map((item) => {
                        const course = courses.find((c) => c.id === item.courseId);
                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-sky-50/40 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex shrink-0 items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
                                  {item.code}
                                </span>
                                <strong className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-xs" title={item.name}>
                                  {item.name}
                                </strong>
                              </div>
                              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                                {item.timezone} · {item.allowLateEnrollment ? "Cho ghi danh muộn" : "Khóa ghi danh muộn"}
                              </p>
                            </td>
                            <td className="px-3.5 py-2.5 text-xs whitespace-nowrap">
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{item.term}</p>
                              <p className="text-[11px] text-slate-400 dark:text-slate-500">{course?.code ?? "Khóa"} v{item.courseVersion}</p>
                            </td>
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              <span className="inline-flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                {item.instructorIds.length}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                                <span className="font-bold text-sky-600 dark:text-sky-400">{item.learnerIds.length}</span>
                                <span className="text-slate-400">/{item.capacity}</span>
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {new Date(item.startAt).toLocaleDateString(activeLocale())}
                            </td>
                            <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                {manager && item.status === "DRAFT" ? (
                                  <button
                                    type="button"
                                    onClick={() => void activate(item)}
                                    className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                                  >
                                    Kích hoạt
                                  </button>
                                ) : null}
                                <Button
                                  onClick={() => router.push(`/courses/classes/${item.id}`)}
                                  variant="secondary"
                                  className="h-8 px-2.5 text-xs font-semibold"
                                >
                                  Chi tiết
                                  <ArrowRight size={13} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Pagination className="mt-4" itemLabel="lớp học" onPageChange={classPagination.setPage} onPageSizeChange={classPagination.setPageSize} page={classPagination.page} pageSize={classPagination.pageSize} totalItems={classPagination.totalItems} />
          </section>
        ) : null}
      </div>
    </SectionState>
    <Modal open={mode === "course"} onClose={() => { setMode(null); setEditingCourseId(null); setCourseForm(blankCourse); }} title={editingCourseId ? "Sửa khóa học" : "Tạo khóa học"} description={editingCourseId ? "Thay đổi được lưu thành bản nháp mới; các lớp đang chạy vẫn giữ snapshot cũ." : "Khóa học được lưu ở trạng thái nháp để rà soát trước khi xuất bản."}><form className="space-y-4" onSubmit={(e) => void createCourse(e)}><Field label="Mã khóa học"><input className={inputClass} disabled={Boolean(editingCourseId)} required value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })} /></Field><Field label="Tên khóa học"><input className={inputClass} required minLength={3} value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} /></Field><Field label="Mô tả"><textarea className={inputClass} required minLength={10} rows={3} value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} /></Field><Field label="Chuẩn đầu ra — mỗi dòng một mục"><textarea className={inputClass} required rows={3} value={courseForm.outcomes} onChange={(e) => setCourseForm({ ...courseForm, outcomes: e.target.value })} /></Field><Button loading={saving} type="submit">{editingCourseId ? "Lưu bản nháp" : "Tạo khóa học"}</Button></form></Modal>
    <Modal open={mode === "class"} onClose={() => setMode(null)} title="Mở lớp học"><form className="space-y-4" onSubmit={(e) => void createClass(e)}><Field label="Khóa học"><SearchableSelect aria-label="Tìm và chọn khóa học" onChange={(value) => setClassForm({ ...classForm, courseId: value })} options={courses.filter((course) => course.status === "PUBLISHED").map((course) => ({ value: course.id, label: `${course.code} — ${course.name}`, description: `Phiên bản ${course.version}`, keywords: course.id }))} placeholder="Gõ mã hoặc tên khóa học để lọc…" value={classForm.courseId} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Mã lớp"><input className={inputClass} required value={classForm.code} onChange={(e) => setClassForm({ ...classForm, code: e.target.value })} /></Field><Field label="Học kỳ"><input className={inputClass} required value={classForm.term} onChange={(e) => setClassForm({ ...classForm, term: e.target.value })} /></Field></div><Field label="Tên lớp"><input className={inputClass} required value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Bắt đầu"><input className={inputClass} required type="datetime-local" value={classForm.startAt} onChange={(e) => setClassForm({ ...classForm, startAt: e.target.value })} /></Field><Field label="Kết thúc"><input className={inputClass} required type="datetime-local" value={classForm.endAt} onChange={(e) => setClassForm({ ...classForm, endAt: e.target.value })} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Sức chứa"><input className={inputClass} min={1} type="number" value={classForm.capacity} onChange={(e) => setClassForm({ ...classForm, capacity: Number(e.target.value) })} /></Field><Field label="Múi giờ"><input className={inputClass} required value={classForm.timezone} onChange={(e) => setClassForm({ ...classForm, timezone: e.target.value })} /></Field></div><label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700"><input checked={classForm.allowLateEnrollment} className="size-5 accent-sky-600" onChange={(e) => setClassForm({ ...classForm, allowLateEnrollment: e.target.checked })} type="checkbox" />Cho phép ghi danh sau ngày khai giảng</label><Button disabled={!classForm.courseId} loading={saving} type="submit">Mở lớp</Button></form></Modal>
    <Modal open={Boolean(versionTarget)} onClose={() => setVersionTarget(null)} title={`Lịch sử ${versionTarget?.code ?? "khóa học"}`} description="Mỗi phiên bản đã phát hành là snapshot bất biến; lớp học tiếp tục dùng đúng version đã chọn lúc mở."><div className="space-y-3">{versions.length ? versions.map((version) => <article className="rounded-xl border border-slate-200 p-4" key={version.id}><div className="flex items-center justify-between"><strong>Phiên bản {version.version}</strong><span className="text-xs text-slate-500">{new Date(version.publishedAt).toLocaleString(activeLocale())}</span></div><p className="mt-2 text-sm font-bold">{version.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{version.outcomes.join(" · ")}</p></article>) : <p className="text-sm text-slate-500">Khóa học chưa có phiên bản phát hành.</p>}</div></Modal>
    <Modal open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title="Ngừng sử dụng khóa học" description="Khóa học sẽ không thể mở lớp mới; lớp hiện có và snapshot phiên bản vẫn được giữ nguyên."><form className="space-y-4" onSubmit={(event) => void archiveCourse(event)}><Field label="Lý do"><textarea className={inputClass} minLength={5} required rows={4} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></Field><Button loading={saving} type="submit" variant="danger"><Archive size={15} />Xác nhận ngừng dùng</Button></form></Modal>
  </div>;
}
