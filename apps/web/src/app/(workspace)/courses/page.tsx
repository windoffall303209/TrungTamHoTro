"use client";

import { activeLocale } from "@/i18n/runtime";

import { Archive, ArrowRight, BookOpen, History, Pencil, Plus, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "course:manage");
  const filteredClasses = courseFilter ? classes.filter((item) => item.courseId === courseFilter) : classes;
  const coursePagination = usePagination(courses);
  const classPagination = usePagination(filteredClasses);
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
  if (!allowed) return <AccessDenied />;
  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10"><PageHeader eyebrow="Learning Operations" title={session.roleCode === "LEARNER" ? "Lớp của tôi" : session.roleCode === "INSTRUCTOR" ? "Lớp giảng dạy" : "Khóa học & lớp"} description={manager ? "Quản lý danh mục đào tạo, kỳ học, sức chứa và vòng đời lớp." : "Theo dõi các lớp được phân công hoặc đã ghi danh theo đúng phạm vi truy cập."} actions={manager ? <div className="flex gap-2"><Button onClick={() => setMode("course")} variant="secondary"><BookOpen size={17} />Khóa học</Button><Button onClick={() => setMode("class")}><Plus size={17} />Mở lớp</Button></div> : undefined} />
    {manager ? <Tabs className="mt-6" items={[{ value: "courses", label: "Khóa học", count: courses.length }, { value: "classes", label: "Lớp học", count: classes.length }]} label="Chọn nội dung quản lý" onChange={setActiveTab} value={activeTab} /> : null}
    <SectionState loading={loading} empty={manager ? activeTab === "courses" ? courses.length === 0 : classes.length === 0 : classes.length === 0}>
      <div className="mt-7">
        {manager && activeTab === "courses" ? (
          <section className="min-w-0">
            <div className="flex items-end justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Danh mục khóa học</h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">Nội dung đào tạo và phiên bản đang được sử dụng.</p>
              </div>
              <span className="shrink-0 text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 rounded-full border border-sky-200/80 dark:border-sky-800/60 tabular-nums">
                {courses.length} khóa học
              </span>
            </div>
            <div className="space-y-4">
              {coursePagination.pageItems.map((course) => (
                <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all space-y-4" key={course.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                        {course.code} · v{course.version}
                      </span>
                      <h3 className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">{course.name}</h3>
                      <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400 max-w-3xl">{course.description}</p>
                    </div>
                    <StatusBadge status={course.status} />
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-4">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                      Lớp trực thuộc ({classes.filter((item) => item.courseId === course.id).length})
                    </p>
                    {classes.some((item) => item.courseId === course.id) ? (
                      <ul className="mt-2.5 flex flex-wrap gap-2">
                        {classes.filter((item) => item.courseId === course.id).map((item) => (
                          <li key={item.id}>
                            <button
                              className="inline-flex items-center gap-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-semibold hover:border-sky-400 transition-colors shadow-2xs"
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
            <div className="flex items-end justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {manager ? "Lớp đang quản lý" : session.roleCode === "INSTRUCTOR" ? "Lớp được phân công" : "Lớp đã ghi danh"}
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">Theo dõi nhân sự, quy mô lớp và mốc vận hành tại một chỗ.</p>
              </div>
              <span className="shrink-0 text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 rounded-full border border-sky-200/80 dark:border-sky-800/60 tabular-nums">
                {filteredClasses.length} lớp
              </span>
            </div>
            {manager ? (
              <div className="mb-5 max-w-sm">
                <Field label="Lọc theo khóa học">
                  <select
                    className={`${inputClass} h-10 text-sm`}
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
            {manager && !filteredClasses.length && classes.length ? (
              <p className="my-6 text-sm text-slate-500">Không có lớp nào thuộc khóa học này.</p>
            ) : null}
            <div className="space-y-4">
              {classPagination.pageItems.map((item) => (
                <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all space-y-4" key={item.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                          {item.code}
                        </span>
                        <span className="text-xs text-slate-400">· {item.term} · {courses.find((course) => course.id === item.courseId)?.code ?? "Khóa"} v{item.courseVersion}</span>
                      </div>
                      <h3 className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">{item.name}</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.timezone} · {item.allowLateEnrollment ? "Cho ghi danh muộn" : "Khóa ghi danh muộn"}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3.5 text-center">
                    <div>
                      <p className="tabular text-lg font-bold text-slate-900 dark:text-slate-100">{item.instructorIds.length}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Giảng viên</p>
                    </div>
                    <div>
                      <p className="tabular text-lg font-bold text-slate-900 dark:text-slate-100">
                        {item.learnerIds.length}<span className="text-xs text-slate-400 font-normal">/{item.capacity}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Học viên</p>
                    </div>
                    <div>
                      <p className="tabular text-lg font-bold text-slate-900 dark:text-slate-100">{new Date(item.startAt).toLocaleDateString(activeLocale())}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Khai giảng</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                    <Button onClick={() => router.push(`/courses/classes/${item.id}`)} variant="secondary" className="h-8 text-xs">
                      Xem chi tiết lớp
                      <ArrowRight size={14} />
                    </Button>
                    {manager && item.status === "DRAFT" ? (
                      <Button onClick={() => void activate(item)} variant="ghost" className="h-8 text-xs text-emerald-600 dark:text-emerald-400">
                        Kích hoạt lớp
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <Pagination itemLabel="lớp học" onPageChange={classPagination.setPage} onPageSizeChange={classPagination.setPageSize} page={classPagination.page} pageSize={classPagination.pageSize} totalItems={classPagination.totalItems} />
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
