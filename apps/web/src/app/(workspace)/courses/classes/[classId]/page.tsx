"use client";

import { ArrowLeft, BookOpenCheck, CalendarDays, CheckCircle2, History, RotateCcw, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { SectionState } from "@/components/section-state";
import { UserPicker } from "@/components/user-picker";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, Tabs, usePagination } from "@/components/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import type { ClassClosureReadiness, ClassRoster, Course, EnrollmentImportResult, InstructorRole, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type DetailTab = "overview" | "instructors" | "learners" | "operations";
type RemoveTarget = { kind: "instructors" | "enrollments"; id: string; name: string };

const roleLabel: Record<InstructorRole, string> = {
  PRIMARY: "Giảng viên chính",
  CO_INSTRUCTOR: "Đồng giảng viên",
};

/** Trình bày hồ sơ lớp và điều phối toàn bộ thao tác nhân sự/vòng đời tại một nơi. */
export default function ClassDetailPage() {
  const params = useParams<{ classId: string }>();
  const router = useRouter();
  const { session, notify } = useApp();
  const classId = params.classId;
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const canManage = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [item, setItem] = useState<LearningClass | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [roster, setRoster] = useState<ClassRoster | null>(null);
  const [readiness, setReadiness] = useState<ClassClosureReadiness | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instructorForm, setInstructorForm] = useState({ userId: "", role: "PRIMARY" as InstructorRole });
  const [learnerId, setLearnerId] = useState("");
  const [bulkLearners, setBulkLearners] = useState("");
  const [importResults, setImportResults] = useState<EnrollmentImportResult[]>([]);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  const activeEnrollments = useMemo(() => roster?.enrollments.filter((enrollment) => enrollment.status === "ACTIVE") ?? [], [roster]);
  const instructors = useMemo(
    () => roster?.instructors ?? item?.instructorIds.map((instructorId) => ({ instructorId, role: "CO_INSTRUCTOR" as InstructorRole, assignedAt: "", displayName: undefined, email: undefined })) ?? [],
    [item?.instructorIds, roster?.instructors],
  );
  const learnerPagination = usePagination(activeEnrollments);
  const historyPagination = usePagination(roster?.history ?? []);

  /** Nạp song song chi tiết lớp, roster và danh sách người dùng có thể được thêm. */
  const load = useCallback(async () => {
    if (!allowed || !classId) return;
    setLoading(true);
    try {
      const classData = await apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode });
      const selected = classData.find((candidate) => candidate.id === classId) ?? null;
      setItem(selected);
      if (!selected) return;

      if (canManage) {
        const [rosterData, readinessData, courses] = await Promise.all([
          apiRequest<ClassRoster>(`/manager/classes/${classId}/roster`, { roleCode: session.roleCode }),
          apiRequest<ClassClosureReadiness>(`/manager/classes/${classId}/closure-readiness`, { roleCode: session.roleCode }),
          apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode }),
        ]);
        setRoster(rosterData);
        setReadiness(readinessData);
        setCourse(courses.find((candidate) => candidate.id === selected.courseId) ?? null);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được hồ sơ lớp.", "error");
    } finally {
      setLoading(false);
    }
  }, [allowed, canManage, classId, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Phân công giảng viên với vai trò PRIMARY hoặc CO_INSTRUCTOR đúng hợp đồng API. */
  const assignInstructor = async () => {
    if (!item || !instructorForm.userId) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/instructors`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId: instructorForm.userId, role: instructorForm.role }),
      });
      notify(`Đã phân công ${roleLabel[instructorForm.role].toLowerCase()}.`);
      setInstructorForm({ ...instructorForm, userId: "" });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không phân công được giảng viên.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Ghi danh một học viên vào lớp và làm mới dữ liệu sau khi thành công. */
  const enrollLearner = async () => {
    if (!item || !learnerId) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/enrollments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId: learnerId }),
      });
      notify("Đã ghi danh học viên vào lớp.");
      setLearnerId("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không ghi danh được học viên.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Ghi danh hàng loạt và giữ kết quả từng tài khoản để người quản lý đối soát. */
  const importEnrollments = async () => {
    if (!item) return;
    const userIds = bulkLearners.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
    if (!userIds.length) {
      notify("Nhập ít nhất một email hoặc mã học viên.", "error");
      return;
    }
    setSaving(true);
    try {
      const results = await apiRequest<EnrollmentImportResult[]>(`/manager/classes/${item.id}/enrollments/import`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userIds }),
      });
      setImportResults(results);
      setBulkLearners("");
      notify(`Đã xử lý ${results.length} dòng ghi danh.`);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không nhập được danh sách học viên.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Xác nhận rồi gỡ giảng viên hoặc học viên đã chọn khỏi lớp. */
  const removeMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!item || !removeTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/${removeTarget.kind}/${removeTarget.id}/remove`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: removeReason.trim() }),
      });
      notify("Đã cập nhật thành viên và lưu lịch sử thay đổi.");
      setRemoveTarget(null);
      setRemoveReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gỡ được thành viên.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Chuyển lớp sang trạng thái hoạt động sau kiểm tra điều kiện ở máy chủ. */
  const activate = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/activate`, { method: "POST", roleCode: session.roleCode });
      notify("Đã kích hoạt lớp học.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kích hoạt được lớp.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return <AccessDenied />;

  const tabs: Array<{ value: DetailTab; label: string; count?: number }> = [
    { value: "overview", label: "Tổng quan" },
    { value: "instructors", label: "Giảng viên", count: roster?.instructors.length ?? item?.instructorIds.length ?? 0 },
    { value: "learners", label: "Học viên", count: activeEnrollments.length || item?.learnerIds.length || 0 },
    ...(canManage ? [{ value: "operations" as const, label: "Vận hành lớp" }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <button className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" onClick={() => router.push("/courses")} type="button"><ArrowLeft size={17} />Quay lại danh sách lớp</button>
      <SectionState loading={loading} empty={!item}>
        {item ? <>
          <header className="flex flex-col gap-5 border-b border-[var(--rule-strong)] pb-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-extrabold text-[var(--accent-ink)]">{item.code} · {item.term}</span><StatusBadge status={item.status} /></div>
              <h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.03em] text-[var(--ink)] md:text-[2.125rem]">{item.name}</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{course ? `${course.code} — ${course.name}` : `Khóa học ${item.courseId}`} · phiên bản {item.courseVersion}</p>
            </div>
            {canManage && item.status === "DRAFT" ? <Button loading={saving} onClick={() => void activate()}><CheckCircle2 size={17} />Kích hoạt lớp</Button> : null}
          </header>

          <Tabs className="mt-5" items={tabs} label="Nội dung hồ sơ lớp" onChange={setActiveTab} value={activeTab} />

          <section aria-label="Tổng quan lớp" className="mt-7" hidden={activeTab !== "overview"} role="tabpanel">
            <div className="grid gap-px border-y border-[var(--rule-strong)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-4">
              {[{ label: "Khai giảng", value: new Date(item.startAt).toLocaleDateString("vi-VN") }, { label: "Kết thúc", value: new Date(item.endAt).toLocaleDateString("vi-VN") }, { label: "Sức chứa", value: `${item.learnerIds.length}/${item.capacity} học viên` }, { label: "Múi giờ", value: item.timezone }].map((metric) => <div className="bg-[var(--surface)] px-5 py-5" key={metric.label}><p className="text-xs font-bold text-[var(--ink-muted)]">{metric.label}</p><p className="mt-1 text-lg font-extrabold tabular-nums text-[var(--ink)]">{metric.value}</p></div>)}
            </div>
            <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.85fr]">
              <section className="border-y border-[var(--rule)] py-5">
                <h2 className="font-heading text-xl font-extrabold text-[var(--ink)]">Thông tin lớp</h2>
                <dl className="mt-4 divide-y divide-[var(--rule)] text-sm">
                  {[{ label: "Mã lớp", value: item.code }, { label: "Học kỳ", value: item.term }, { label: "Khóa học", value: course?.name ?? item.courseId }, { label: "Phiên bản nội dung", value: `Phiên bản ${item.courseVersion}` }, { label: "Ghi danh muộn", value: item.allowLateEnrollment ? "Được phép" : "Không cho phép" }].map((row) => <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr]" key={row.label}><dt className="font-bold text-[var(--ink-soft)]">{row.label}</dt><dd className="text-[var(--ink)]">{row.value}</dd></div>)}
                </dl>
              </section>
              <section className="border-y border-[var(--rule)] py-5">
                <h2 className="font-heading text-xl font-extrabold text-[var(--ink)]">Việc nên làm tiếp</h2>
                <ol className="mt-4 space-y-4 text-sm leading-6 text-[var(--ink-soft)]">
                  {item.status === "DRAFT" ? <><li><strong className="text-[var(--ink)]">1. Phân công giảng viên chính</strong><br />Lớp cần ít nhất một giảng viên trước khi kích hoạt.</li><li><strong className="text-[var(--ink)]">2. Ghi danh học viên</strong><br />Thêm từng người hoặc nhập danh sách email hàng loạt.</li><li><strong className="text-[var(--ink)]">3. Kích hoạt lớp</strong><br />Mở lớp sau khi nhân sự và lịch học đã đúng.</li></> : item.status === "ACTIVE" ? <><li><strong className="text-[var(--ink)]">1. Theo dõi thành viên</strong><br />Cập nhật người phụ trách và sĩ số khi có thay đổi.</li><li><strong className="text-[var(--ink)]">2. Vận hành dạy học</strong><br />Tiếp tục với học liệu, đề thi và buổi học trực tuyến.</li><li><strong className="text-[var(--ink)]">3. Đóng lớp khi hoàn tất</strong><br />Kiểm tra bài chấm, điểm danh và yêu cầu còn mở trước khi lưu trữ.</li></> : <><li><strong className="text-[var(--ink)]">Lớp đang ở chế độ chỉ đọc.</strong><br />Dữ liệu vẫn được giữ để tra cứu. Quản lý có thể mở lại lớp với lý do được lưu audit.</li></>}
                </ol>
              </section>
            </div>
          </section>

          <section aria-label="Giảng viên của lớp" className="mt-7" hidden={activeTab !== "instructors"} role="tabpanel">
            <div className="flex flex-col gap-2 border-b border-[var(--rule-strong)] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-heading text-2xl font-extrabold">Đội ngũ giảng dạy</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Một giảng viên chính chịu trách nhiệm lớp; đồng giảng viên cùng hỗ trợ giảng dạy.</p></div><span className="text-sm font-bold text-[var(--ink-muted)]">{roster?.instructors.length ?? item.instructorIds.length} người</span></div>
            {canManage && item.status !== "CLOSED" ? <div className="mt-5 grid gap-3 border-b border-[var(--rule)] pb-5 md:grid-cols-[minmax(0,1fr)_13rem_auto]"><UserPicker classId={item.id} label="Chọn giảng viên" onChange={(userId) => setInstructorForm({ ...instructorForm, userId })} role="INSTRUCTOR" value={instructorForm.userId} /><Field label="Vai trò"><select className={inputClass} onChange={(event) => setInstructorForm({ ...instructorForm, role: event.target.value as InstructorRole })} value={instructorForm.role}><option value="PRIMARY">Giảng viên chính</option><option value="CO_INSTRUCTOR">Đồng giảng viên</option></select></Field><Button className="md:mt-7" disabled={!instructorForm.userId} loading={saving} onClick={() => void assignInstructor()}><UserPlus size={16} />Phân công</Button></div> : null}
            <div className="divide-y divide-[var(--rule)] border-b border-[var(--rule-strong)]">
              {instructors.map((instructor) => <article className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between" key={instructor.instructorId}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-[var(--ink)]">{instructor.displayName || instructor.instructorId}</h3><span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-bold text-[var(--ink-soft)]">{roleLabel[instructor.role]}</span></div>{instructor.email ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{instructor.email}</p> : null}</div>{canManage && item.status !== "CLOSED" ? <Button aria-label={`Gỡ ${instructor.displayName || instructor.instructorId}`} onClick={() => setRemoveTarget({ kind: "instructors", id: instructor.instructorId, name: instructor.displayName || instructor.instructorId })} variant="ghost"><Trash2 size={15} />Gỡ phân công</Button> : null}</article>)}
              {!item.instructorIds.length ? <p className="py-10 text-center text-sm text-[var(--ink-muted)]">Chưa có giảng viên phụ trách. Đây là bước bắt buộc trước khi kích hoạt lớp.</p> : null}
            </div>
          </section>

          <section aria-label="Học viên của lớp" className="mt-7" hidden={activeTab !== "learners"} role="tabpanel">
            <div className="flex flex-col gap-2 border-b border-[var(--rule-strong)] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-heading text-2xl font-extrabold">Danh sách học viên</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Theo dõi sĩ số và nguồn ghi danh của từng học viên.</p></div><span className="text-sm font-bold text-[var(--ink-muted)]">{item.learnerIds.length}/{item.capacity} học viên</span></div>
            {canManage && item.status !== "CLOSED" ? <div className="mt-5 grid gap-5 border-b border-[var(--rule)] pb-5 lg:grid-cols-2"><div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><UserPicker classId={item.id} label="Chọn một học viên" onChange={setLearnerId} role="LEARNER" value={learnerId} /><Button disabled={!learnerId} loading={saving} onClick={() => void enrollLearner()}><UserPlus size={16} />Ghi danh</Button></div><div><Field label="Nhập hàng loạt — email hoặc mã, mỗi dòng một người"><textarea className={inputClass} onChange={(event) => setBulkLearners(event.target.value)} placeholder="hocvien01@example.com&#10;hocvien02@example.com" rows={3} value={bulkLearners} /></Field><Button className="mt-2" disabled={!bulkLearners.trim()} loading={saving} onClick={() => void importEnrollments()} variant="secondary">Kiểm tra và nhập danh sách</Button></div></div> : null}
            {importResults.length ? <div aria-live="polite" className="mt-4 border-y border-[var(--rule)] py-3 text-xs">{importResults.map((result, index) => <p className={`py-1 ${result.status === "ENROLLED" ? "text-[var(--success-deep)]" : result.status === "FAILED" ? "text-[var(--danger-deep)]" : "text-[var(--warning-deep)]"}`} key={`${result.userId}-${index}`}><strong>{result.userId}</strong>: {result.message}</p>)}</div> : null}
            <div className="divide-y divide-[var(--rule)] border-b border-[var(--rule-strong)]">
              {(canManage ? learnerPagination.pageItems : item.learnerIds.map((learnerIdValue) => ({ learnerId: learnerIdValue, status: "ACTIVE" as const, source: "", joinedAt: "" }))).map((learner) => <article className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={learner.learnerId}><div className="min-w-0"><h3 className="font-bold text-[var(--ink)]">{"displayName" in learner && learner.displayName ? learner.displayName : learner.learnerId}</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">{"email" in learner && learner.email ? `${learner.email} · ` : ""}{learner.source ? learner.source === "MANUAL" ? "Ghi danh thủ công" : "Nhập hàng loạt" : "Đang học"}</p></div>{canManage && item.status !== "CLOSED" ? <Button onClick={() => setRemoveTarget({ kind: "enrollments", id: learner.learnerId, name: "displayName" in learner ? learner.displayName ?? learner.learnerId : learner.learnerId })} variant="ghost"><Trash2 size={15} />Gỡ khỏi lớp</Button> : null}</article>)}
              {!item.learnerIds.length ? <p className="py-10 text-center text-sm text-[var(--ink-muted)]">Chưa có học viên được ghi danh.</p> : null}
            </div>
            {canManage ? <Pagination itemLabel="học viên" onPageChange={learnerPagination.setPage} onPageSizeChange={learnerPagination.setPageSize} page={learnerPagination.page} pageSize={learnerPagination.pageSize} totalItems={learnerPagination.totalItems} /> : null}
          </section>

          {canManage ? <section aria-label="Vận hành lớp" className="mt-7" hidden={activeTab !== "operations"} role="tabpanel">
            <div className="grid gap-7 lg:grid-cols-[1fr_.9fr]">
              <section className="border-y border-[var(--rule-strong)] py-5">
                <div className="flex items-center gap-3"><BookOpenCheck className="text-[var(--accent)]" size={22} /><h2 className="font-heading text-xl font-extrabold">Trạng thái vận hành</h2></div>
                <div className="mt-5 grid grid-cols-3 divide-x divide-[var(--rule)] border-y border-[var(--rule)] py-4 text-center text-xs"><div><p className={`font-extrabold ${item.status === "DRAFT" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}>Nháp</p><p className="mt-1 text-[var(--ink-muted)]">Chuẩn bị</p></div><div><p className={`font-extrabold ${item.status === "ACTIVE" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}>Hoạt động</p><p className="mt-1 text-[var(--ink-muted)]">Đang dạy</p></div><div><p className={`font-extrabold ${item.status === "CLOSED" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}>Đã đóng</p><p className="mt-1 text-[var(--ink-muted)]">Chỉ đọc</p></div></div>
                <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">“Vận hành lớp” là nơi kích hoạt lớp, kiểm tra điều kiện kết thúc, đóng để lưu trữ hoặc mở lại. Đóng lớp không xóa học liệu, điểm, bài thi hay điểm danh.</p>
                <div className="mt-5 flex flex-wrap gap-2">{item.status === "DRAFT" ? <Button loading={saving} onClick={() => void activate()}><CheckCircle2 size={16} />Kích hoạt lớp</Button> : null}<Button onClick={() => router.push(`/class-lifecycle?classId=${item.id}`)} variant={item.status === "CLOSED" ? "primary" : "secondary"}>{item.status === "CLOSED" ? <RotateCcw size={16} /> : <CalendarDays size={16} />}{item.status === "CLOSED" ? "Mở lại lớp" : "Kiểm tra trước khi đóng"}</Button></div>
              </section>
              <section className="border-y border-[var(--rule-strong)] py-5">
                <div className="flex items-center gap-3">{readiness?.eligible ? <CheckCircle2 className="text-[var(--success)]" size={22} /> : <ShieldAlert className="text-[var(--warning)]" size={22} />}<h2 className="font-heading text-xl font-extrabold">Điều kiện đóng lớp</h2></div>
                {readiness?.eligible ? <p className="mt-5 bg-[var(--success-soft)] px-4 py-3 text-sm font-bold text-[var(--success-deep)]">Lớp đã đủ điều kiện để đóng và lưu trữ.</p> : <div className="mt-5"><p className="text-sm font-bold text-[var(--warning-deep)]">Cần xử lý trước khi đóng:</p><ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">{readiness?.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}</ul></div>}
              </section>
            </div>
            {roster?.history.length ? <section className="mt-7"><div className="flex items-end justify-between gap-3 border-b border-[var(--rule-strong)] pb-3"><div><h2 className="flex items-center gap-2 font-heading text-xl font-extrabold"><History size={19} />Lịch sử thành viên</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Mọi phân công và ghi danh đều được lưu để truy vết.</p></div></div><div className="divide-y divide-[var(--rule)]">{historyPagination.pageItems.map((entry) => <div className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]" key={entry.id}><p><strong>{entry.memberId}</strong> · {entry.action}{entry.role ? ` · ${roleLabel[entry.role]}` : ""}{entry.reason ? ` — ${entry.reason}` : ""}</p><time className="text-xs text-[var(--ink-muted)]">{new Date(entry.createdAt).toLocaleString("vi-VN")}</time></div>)}</div><Pagination itemLabel="thay đổi" onPageChange={historyPagination.setPage} onPageSizeChange={historyPagination.setPageSize} page={historyPagination.page} pageSize={historyPagination.pageSize} totalItems={historyPagination.totalItems} /></section> : null}
          </section> : null}

          <Modal description={removeTarget ? `Thao tác này được ghi vào lịch sử lớp cho ${removeTarget.name}.` : undefined} onClose={() => { setRemoveTarget(null); setRemoveReason(""); }} open={Boolean(removeTarget)} title={removeTarget?.kind === "instructors" ? "Gỡ phân công giảng viên" : "Gỡ học viên khỏi lớp"}>
            <form className="space-y-4" onSubmit={(event) => void removeMember(event)}><Field label="Lý do thay đổi"><textarea className={inputClass} minLength={5} onChange={(event) => setRemoveReason(event.target.value)} required rows={4} value={removeReason} /></Field><Button loading={saving} type="submit" variant="danger"><Trash2 size={16} />Xác nhận thay đổi</Button></form>
          </Modal>
        </> : null}
      </SectionState>
    </div>
  );
}
