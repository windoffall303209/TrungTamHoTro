"use client";

import { activeLocale } from "@/i18n/runtime";

import { CheckCircle2, Download, Filter, Plus, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest, downloadApiFile } from "@/lib/api-client";
import type { ClassProgressReport, ClassRoster, ExamAnalytics, OperationalReport, ProgressIntervention, ReportExport, ReportRun } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

interface ClassReport { classId: string; classCode: string; className: string; learners: number; instructors: number; publishedMaterials: number; exams: number; submittedAttempts: number; averageScore: number; sessions: number; attendanceRate: number; status: string }

/** Chuyển Date thành YYYY-MM-DD ổn định cho input ngày theo múi giờ cục bộ. */
const dateInput = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Tổng hợp báo cáo vận hành, phân tích kết quả và các can thiệp theo khoảng thời gian. */
export default function ReportsPage() {
  const { session, notify } = useApp();
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const instructor = session.roleCode === "INSTRUCTOR" && hasPermission(session, "question:manage");
  const allowed = (manager || instructor) && hasPermission(session, "report:view");
  const today = useMemo(() => new Date(), []);
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [classReports, setClassReports] = useState<ClassReport[]>([]);
  const [progress, setProgress] = useState<ClassProgressReport | null>(null);
  const [roster, setRoster] = useState<ClassRoster | null>(null);
  const [myInterventions, setMyInterventions] = useState<ProgressIntervention[]>([]);
  const [examAnalytics, setExamAnalytics] = useState<ExamAnalytics | null>(null);
  const [exports, setExports] = useState<ReportExport[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [filters, setFilters] = useState({ from: dateInput(new Date(today.getFullYear(), 0, 1)), to: dateInput(today), attendanceBelow: 70, scoreBelow: 50, completionBelow: 60 });
  const [interventionLearnerId, setInterventionLearnerId] = useState<string | null>(null);
  const [interventionForm, setInterventionForm] = useState({ assigneeId: "", title: "Liên hệ hỗ trợ học tập", notes: "", dueAt: dateInput(new Date(today.getTime() + 7 * 86_400_000)) });
  const [completionTarget, setCompletionTarget] = useState<ProgressIntervention | null>(null);
  const [completionOutcome, setCompletionOutcome] = useState("");
  const [transferTarget, setTransferTarget] = useState<ProgressIntervention | null>(null);
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(() => new URLSearchParams({ from: new Date(`${filters.from}T00:00:00+07:00`).toISOString(), to: new Date(`${filters.to}T23:59:59+07:00`).toISOString() }).toString(), [filters.from, filters.to]);

  /** Nạp các chỉ số tổng quan theo bộ lọc ngày và ngưỡng cảnh báo hiện tại. */
  const loadOverview = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [overview, classes, exportRows] = await Promise.all([
        apiRequest<OperationalReport>(`/reports/operations?${query}`, { roleCode: session.roleCode }),
        apiRequest<ClassReport[]>("/reports/classes", { roleCode: session.roleCode }),
        manager ? apiRequest<ReportExport[]>("/manager/reports/exports", { roleCode: session.roleCode }) : Promise.resolve([]),
      ]);
      setReport(overview);
      setClassReports(classes);
      setExports(exportRows);
      setSelectedClassId((current) => current || classes[0]?.classId || "");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được báo cáo.", "error");
    } finally {
      setLoading(false);
    }
  }, [allowed, manager, notify, query, session.roleCode]);

  /** Nạp tiến độ học tập chi tiết để tìm các trường hợp cần hỗ trợ. */
  const loadProgress = useCallback(async () => {
    if (!manager || !selectedClassId) return;
    try {
      const params = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), attendanceBelow: String(filters.attendanceBelow), scoreBelow: String(filters.scoreBelow), completionBelow: String(filters.completionBelow) });
      const [progressResult, rosterResult] = await Promise.all([
        apiRequest<ClassProgressReport>(`/manager/classes/${selectedClassId}/progress?${params}`, { roleCode: session.roleCode }),
        apiRequest<ClassRoster>(`/manager/classes/${selectedClassId}/roster`, { roleCode: session.roleCode }),
      ]);
      setProgress(progressResult);
      setRoster(rosterResult);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được tiến độ lớp.", "error");
    }
  }, [filters.attendanceBelow, filters.completionBelow, filters.scoreBelow, manager, notify, query, selectedClassId, session.roleCode]);

  /** Nạp hàng đợi hỗ trợ riêng để giảng viên nhận và trả kết quả công việc được giao. */
  const loadMyInterventions = useCallback(async () => {
    if (!instructor) return;
    try { setMyInterventions(await apiRequest<ProgressIntervention[]>("/progress/interventions/mine", { roleCode: session.roleCode })); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được công việc hỗ trợ.", "error"); }
  }, [instructor, notify, session.roleCode]);
  /** Nạp thống kê đề thi và phân phối kết quả trong phạm vi báo cáo. */
  const loadExamAnalytics = useCallback(async () => {
    if (!instructor) return;
    try { const params = new URLSearchParams(query); if (selectedClassId) params.set("classId", selectedClassId); setExamAnalytics(await apiRequest<ExamAnalytics>(`/instructor/analytics/exams?${params}`, { roleCode: session.roleCode })); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được phân tích đánh giá.", "error"); }
  }, [instructor, notify, query, selectedClassId, session.roleCode]);

  useEffect(() => { const timer = window.setTimeout(() => void loadOverview(), 0); return () => window.clearTimeout(timer); }, [loadOverview]);
  useEffect(() => { const timer = window.setTimeout(() => void loadProgress(), 0); return () => window.clearTimeout(timer); }, [loadProgress]);
  useEffect(() => { const timer = window.setTimeout(() => void loadExamAnalytics(), 0); return () => window.clearTimeout(timer); }, [loadExamAnalytics]);
  useEffect(() => { const timer = window.setTimeout(() => void loadMyInterventions(), 0); return () => window.clearTimeout(timer); }, [loadMyInterventions]);

  const classPagination = usePagination(classReports);
  const examPagination = usePagination(examAnalytics?.exams ?? []);
  const learnerPagination = usePagination(progress?.learners ?? []);
  const exportPagination = usePagination(exports);

  if (!allowed) return <AccessDenied />;

  const metrics = report ? [
    { label: "Khóa học", value: report.courses }, { label: "Lớp học", value: report.classes },
    { label: "Học liệu", value: report.materials }, { label: "Đề thi", value: report.exams },
    { label: "Báo cáo mở", value: report.openReports }, { label: "Buổi trực tuyến", value: report.liveSessions },
    { label: "Phiếu hỗ trợ mở", value: report.openTickets },
  ] : [];

  /** Tạo tác vụ xuất CSV theo bộ lọc hiện tại và tải kết quả khi sẵn sàng. */
  const createExport = async () => {
    try {
      setSubmitting(true);
      const run = await apiRequest<ReportRun>("/manager/reports/run", { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ from: new Date(`${filters.from}T00:00:00+07:00`).toISOString(), to: new Date(`${filters.to}T23:59:59+07:00`).toISOString() }) });
      const created = await apiRequest<ReportExport>("/manager/reports/exports", { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ reportRunId: run.id, format: "CSV" }) });
      setExports((current) => [created, ...current]);
      notify("Đã tạo tệp CSV có phiên bản định nghĩa và hạn tải 24 giờ.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tạo được tệp xuất.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  /** Tạo phiếu can thiệp cho người học có chỉ số rủi ro. */
  const createIntervention = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!interventionLearnerId || !selectedClassId) return;
    try {
      setSubmitting(true);
      await apiRequest(`/manager/classes/${selectedClassId}/progress/interventions`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ learnerId: interventionLearnerId, assigneeId: interventionForm.assigneeId, title: interventionForm.title, notes: interventionForm.notes, dueAt: new Date(`${interventionForm.dueAt}T17:00:00+07:00`).toISOString() }) });
      notify("Đã giao hành động hỗ trợ và lưu vào hồ sơ tiến độ.");
      setInterventionLearnerId(null);
      setInterventionForm((current) => ({ ...current, assigneeId: "" }));
      await loadProgress();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không giao được hành động hỗ trợ.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  /** Chuyển trạng thái công việc hỗ trợ và bắt buộc kết quả khi hoàn tất. */
  const updateIntervention = async (interventionId: string, status: "IN_PROGRESS" | "DONE", outcome?: string) => {
    try {
      setSubmitting(true);
      await apiRequest(`/manager/progress/interventions/${interventionId}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ status, outcome }) });
      notify(status === "DONE" ? "Đã lưu kết quả hỗ trợ." : "Đã nhận xử lý hành động hỗ trợ.");
      setCompletionTarget(null);
      setCompletionOutcome("");
      await loadProgress();
      await loadMyInterventions();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được hành động.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  /** Bàn giao công việc hỗ trợ cho giảng viên khác trong cùng lớp. */
  const transferIntervention = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!transferTarget) return;
    try {
      setSubmitting(true);
      await apiRequest(`/manager/progress/interventions/${transferTarget.id}/transfer`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ assigneeId: transferAssigneeId, reason: transferReason }) });
      notify("Đã bàn giao công việc và lưu lịch sử.");
      setTransferTarget(null); setTransferAssigneeId(""); setTransferReason("");
      await loadProgress();
    } catch (error) { notify(error instanceof Error ? error.message : "Không bàn giao được công việc.", "error"); }
    finally { setSubmitting(false); }
  };

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
    <PageHeader eyebrow="Operational Intelligence" title="Báo cáo vận hành" description="Đối soát chỉ số theo kỳ, nhận diện rủi ro có giải thích và quản lý lịch sử xuất dữ liệu." />

    <section className="mb-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <Field label="Từ ngày"><input className={inputClass} max={filters.to} type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></Field>
        <Field label="Đến ngày"><input className={inputClass} min={filters.from} type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></Field>
        {manager ? <><Field label="Điểm danh dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.attendanceBelow} onChange={(event) => setFilters({ ...filters, attendanceBelow: Number(event.target.value) })} /></Field><Field label="Điểm dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.scoreBelow} onChange={(event) => setFilters({ ...filters, scoreBelow: Number(event.target.value) })} /></Field><Field label="Tiến độ dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.completionBelow} onChange={(event) => setFilters({ ...filters, completionBelow: Number(event.target.value) })} /></Field></> : null}
        <div className="flex items-end gap-2"><Button loading={loading} onClick={() => { void loadOverview(); void loadExamAnalytics(); }} variant="secondary"><Filter size={15} />Áp dụng</Button>{manager ? <Button loading={submitting} onClick={() => void createExport()}><Download size={15} />CSV</Button> : null}{instructor ? <Button onClick={() => { const params = new URLSearchParams(query); if (selectedClassId) params.set("classId", selectedClassId); void downloadApiFile(`/instructor/analytics/exams/export?${params}`, session.roleCode); }}><Download size={15} />CSV đánh giá</Button> : null}</div>
      </div>
    </section>

    <section aria-label="Chỉ số báo cáo" className="metric-ledger">{metrics.map(({ label, value }) => <div key={label}><p className="tabular text-2xl font-extrabold tracking-[-0.03em]">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div>)}</section>

    {report ? <section className="mt-7 grid gap-6 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6 lg:grid-cols-[1.2fr_.8fr]">
      <div><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-xl font-extrabold">Định nghĩa chỉ số</h2><span className="text-xs font-bold text-slate-500">v{report.definitionVersion} · {report.timezone}</span></div><dl className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{Object.entries(report.metricDefinitions).map(([key, definition]) => <div className="grid gap-1 py-3 text-xs leading-5 sm:grid-cols-[minmax(8rem,.4fr)_1fr]" key={key}><dt className="font-bold text-slate-900">{key}</dt><dd className="text-slate-600">{definition}</dd></div>)}</dl></div>
      <aside className="rounded-xl bg-amber-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wider text-amber-700">Cần chú ý</p><p className="mt-3 text-3xl font-extrabold text-amber-950">{report.openReports + report.openTickets}</p><p className="mt-1 text-sm leading-6 text-amber-800">báo cáo nội dung và phiếu hỗ trợ đang chờ xử lý.</p></aside>
    </section> : <div className="mt-7 h-48 animate-pulse rounded-2xl bg-slate-200" />}

    <section className="mt-7 overflow-hidden border-y border-[var(--rule-strong)] bg-[var(--surface)]/65"><div className="border-b border-slate-100 p-5"><h2 className="font-heading text-xl font-extrabold">Hiệu quả theo lớp</h2><p className="mt-1 text-sm text-slate-500">Tiến độ nội dung, đánh giá và tỷ lệ tham dự được tổng hợp theo lớp.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Lớp</th><th className="px-5 py-3">Học viên</th><th className="px-5 py-3">Học liệu</th><th className="px-5 py-3">Đề / lượt nộp</th><th className="px-5 py-3">Điểm TB</th><th className="px-5 py-3">Điểm danh</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-slate-100">{classPagination.pageItems.map((item) => <tr key={item.classId}><td className="px-5 py-4"><p className="font-extrabold">{item.classCode}</p><p className="text-xs text-slate-500">{item.className}</p></td><td className="px-5 py-4">{item.learners}</td><td className="px-5 py-4">{item.publishedMaterials}</td><td className="px-5 py-4">{item.exams} / {item.submittedAttempts}</td><td className="px-5 py-4 font-extrabold">{item.averageScore}</td><td className="px-5 py-4">{item.attendanceRate}%</td><td className="px-5 py-4"><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div><Pagination className="mx-5 mb-5" itemLabel="lớp học" onPageChange={classPagination.setPage} onPageSizeChange={classPagination.setPageSize} page={classPagination.page} pageSize={classPagination.pageSize} totalItems={classPagination.totalItems} /></section>

    {instructor ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-heading text-xl font-extrabold">Phân tích kết quả đánh giá</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Chỉ số lấy từ bài đã chấm; thống kê câu hỏi chỉ mở sau khi đề đóng.</p></div><div className="w-full sm:w-80"><Field label="Lớp"><SearchableSelect aria-label="Tìm và lọc lớp được phân công" onChange={(value) => { setSelectedClassId(value); examPagination.resetPage(); }} options={classReports.map((item) => ({ value: item.classId, label: `${item.classCode} — ${item.className}`, keywords: item.classId }))} placeholder="Tất cả lớp được phân công" value={selectedClassId} /></Field></div></div><div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{examPagination.pageItems.map((exam) => <article className="py-5" key={exam.examId}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{exam.title}</strong>{exam.smallSampleWarning ? <StatusBadge status="SMALL_SAMPLE" /> : <StatusBadge status="STABLE" />}</div><div className="mt-4 grid grid-cols-3 divide-x divide-[var(--rule)] text-center"><div><p className="tabular text-2xl font-extrabold">{exam.sampleSize}</p><p className="text-xs text-[var(--ink-soft)]">Bài đã chấm</p></div><div><p className="tabular text-2xl font-extrabold">{exam.averagePercentage}%</p><p className="text-xs text-[var(--ink-soft)]">Điểm TB</p></div><div><p className="tabular text-2xl font-extrabold">{exam.passRate}%</p><p className="text-xs text-[var(--ink-soft)]">Đạt ≥ 50%</p></div></div><p className={`mt-4 rounded-lg px-3 py-2 text-xs ${exam.questionStatsAvailable ? "bg-[var(--success-soft)] text-[var(--success-deep)]" : "bg-amber-50 text-amber-800"}`}>{exam.questionStatsAvailable ? `Đã mở thống kê ${exam.questionStats.length} câu sau khi đề đóng.` : "Đề còn mở: hệ thống chưa hiển thị thống kê câu hỏi để tránh lộ tín hiệu đáp án."}</p></article>)}</div><Pagination itemLabel="đề thi phân tích" onPageChange={examPagination.setPage} onPageSizeChange={examPagination.setPageSize} page={examPagination.page} pageSize={examPagination.pageSize} totalItems={examPagination.totalItems} /></section> : null}

    {instructor ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-extrabold">Công việc hỗ trợ của tôi</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Nhận việc trước khi xử lý và ghi kết quả cụ thể khi hoàn tất.</p></div><span className="tabular text-2xl font-extrabold">{myInterventions.filter((item) => ["OPEN", "IN_PROGRESS"].includes(item.status)).length}</span></div><div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{myInterventions.length ? myInterventions.map((item) => <article className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center" key={item.id}><div><div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong><StatusBadge status={item.status} /></div><p className="mt-1 text-xs text-[var(--ink-soft)]">Học viên {item.learnerId} · hạn {new Date(item.dueAt).toLocaleString(activeLocale())}</p>{item.notes ? <p className="mt-2 text-sm text-[var(--ink-soft)]">{item.notes}</p> : null}{item.outcome ? <p className="mt-2 text-sm font-bold text-[var(--success-deep)]">Kết quả: {item.outcome}</p> : null}</div><div className="flex gap-2">{item.status === "OPEN" ? <Button onClick={() => void updateIntervention(item.id, "IN_PROGRESS")} variant="secondary">Nhận xử lý</Button> : null}{item.status === "IN_PROGRESS" ? <Button onClick={() => setCompletionTarget(item)}><CheckCircle2 size={14} />Hoàn tất</Button> : null}</div></article>) : <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Chưa có công việc hỗ trợ nào được giao.</p>}</div></section> : null}

    {manager ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-heading text-xl font-extrabold">Học viên cần hỗ trợ</h2><p className="mt-1 text-sm text-slate-500">Cờ rủi ro chỉ là tín hiệu giải thích được, không dùng làm quyết định kỷ luật tự động.</p></div><div className="w-full sm:w-80"><Field label="Lớp"><SearchableSelect aria-label="Tìm và chọn lớp cần theo dõi" onChange={(value) => { setSelectedClassId(value); learnerPagination.resetPage(); }} options={classReports.map((item) => ({ value: item.classId, label: `${item.classCode} — ${item.className}`, keywords: item.classId }))} placeholder="Gõ mã hoặc tên lớp…" value={selectedClassId} /></Field></div></div>
      <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{learnerPagination.pageItems.map((learner) => <article className="grid gap-4 py-5 lg:grid-cols-[1fr_.75fr_1.25fr_auto] lg:items-center" key={learner.learnerId}><div><p className="font-extrabold">{learner.learnerId}</p><div className="mt-2 flex items-center gap-2"><StatusBadge status={learner.riskLevel} /><span className="text-xs text-slate-500">Hoạt động cuối: {learner.lastActivityAt ? new Date(learner.lastActivityAt).toLocaleString(activeLocale()) : "Chưa có"}</span></div></div><div className="grid grid-cols-2 gap-2 text-xs"><span>Học liệu <strong>{learner.materialCompletionRate}%</strong></span><span>Bài thi <strong>{learner.assessmentCompletionRate}%</strong></span><span>Điểm danh <strong>{learner.attendanceRate}%</strong></span><span>Điểm TB <strong>{learner.averageScore}%</strong></span></div><div className="text-xs leading-5 text-slate-600">{learner.riskReasons.length ? learner.riskReasons.map((reason) => <p key={reason}>• {reason}</p>) : <p className="text-emerald-700">Không có tín hiệu vượt ngưỡng.</p>}{learner.interventions.filter((item) => ["OPEN", "IN_PROGRESS"].includes(item.status)).map((item) => <div className="mt-2 flex flex-wrap items-center gap-2" key={item.id}><StatusBadge status={item.status} /><span className="font-bold">{item.title}</span><span>· phụ trách {item.ownerId}</span><button className="action-link px-0" onClick={() => setCompletionTarget(item)} type="button">Ghi kết quả</button><button className="action-link px-0" onClick={() => { setTransferTarget(item); setTransferAssigneeId(""); setTransferReason(""); }} type="button">Bàn giao</button></div>)}</div><Button onClick={() => setInterventionLearnerId(learner.learnerId)} variant="secondary"><Plus size={14} />Hành động</Button></article>)}</div><Pagination itemLabel="học viên" onPageChange={learnerPagination.setPage} onPageSizeChange={learnerPagination.setPageSize} page={learnerPagination.page} pageSize={learnerPagination.pageSize} totalItems={learnerPagination.totalItems} />
    </section> : null}

    {manager && exports.length ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5"><h2 className="font-heading text-xl font-extrabold">Lịch sử xuất báo cáo</h2><div className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{exportPagination.pageItems.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 py-4" key={item.id}><div><p className="text-sm font-bold">{item.fileName}</p><p className="text-xs text-slate-500">{item.sizeBytes ?? 0} byte · hết hạn {new Date(item.expiresAt).toLocaleString(activeLocale())}</p></div><div className="flex items-center gap-2"><StatusBadge status={item.status} />{item.status === "COMPLETED" ? <Button onClick={() => void downloadApiFile(`/manager/reports/exports/${item.id}/download`, session.roleCode)} variant="ghost"><Download size={14} />Tải</Button> : null}</div></div>)}</div><Pagination itemLabel="tệp xuất" onPageChange={exportPagination.setPage} onPageSizeChange={exportPagination.setPageSize} page={exportPagination.page} pageSize={exportPagination.pageSize} totalItems={exportPagination.totalItems} /></section> : null}

    <Modal open={Boolean(interventionLearnerId)} onClose={() => setInterventionLearnerId(null)} title="Giao hành động hỗ trợ" description={`Học viên ${interventionLearnerId ?? ""}; hành động này được theo dõi riêng, không thay đổi điểm hay kỷ luật.`}><form className="space-y-4" onSubmit={(event) => void createIntervention(event)}><Field label="Người phụ trách"><SearchableSelect aria-label="Chọn giảng viên phụ trách hỗ trợ" onChange={(value) => setInterventionForm({ ...interventionForm, assigneeId: value })} options={(roster?.instructors ?? []).map((item) => ({ value: item.instructorId, label: `${item.displayName ?? item.instructorId}${item.role === "PRIMARY" ? " — Giảng viên chính" : " — Đồng giảng viên"}`, keywords: item.email ?? item.instructorId }))} placeholder="Chọn giảng viên trong lớp" value={interventionForm.assigneeId} /></Field><Field label="Tên hành động"><input className={inputClass} minLength={3} required value={interventionForm.title} onChange={(event) => setInterventionForm({ ...interventionForm, title: event.target.value })} /></Field><Field label="Ghi chú"><textarea className={inputClass} rows={3} value={interventionForm.notes} onChange={(event) => setInterventionForm({ ...interventionForm, notes: event.target.value })} /></Field><Field label="Hạn hoàn thành"><input className={inputClass} min={dateInput(new Date(today.getTime() + 86_400_000))} required type="date" value={interventionForm.dueAt} onChange={(event) => setInterventionForm({ ...interventionForm, dueAt: event.target.value })} /></Field><Button disabled={!interventionForm.assigneeId} loading={submitting} type="submit"><ShieldAlert size={15} />Giao hỗ trợ</Button></form></Modal>
    <Modal open={Boolean(completionTarget)} onClose={() => { setCompletionTarget(null); setCompletionOutcome(""); }} title="Ghi kết quả hỗ trợ" description="Kết quả này khép công việc và được lưu trong hồ sơ truy vết."><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (completionTarget) void updateIntervention(completionTarget.id, "DONE", completionOutcome); }}><Field label="Kết quả đã thực hiện"><textarea className={inputClass} minLength={5} onChange={(event) => setCompletionOutcome(event.target.value)} required rows={4} value={completionOutcome} /></Field><Button disabled={completionOutcome.trim().length < 5} loading={submitting} type="submit"><CheckCircle2 size={15} />Lưu và hoàn tất</Button></form></Modal>
    <Modal open={Boolean(transferTarget)} onClose={() => setTransferTarget(null)} title="Bàn giao công việc" description="Chỉ có thể bàn giao cho giảng viên đang được phân công trong cùng lớp."><form className="space-y-4" onSubmit={(event) => void transferIntervention(event)}><Field label="Người nhận"><SearchableSelect aria-label="Chọn giảng viên nhận bàn giao" onChange={setTransferAssigneeId} options={(roster?.instructors ?? []).filter((item) => item.instructorId !== transferTarget?.ownerId).map((item) => ({ value: item.instructorId, label: item.displayName ?? item.instructorId, keywords: item.email ?? item.instructorId }))} placeholder="Chọn người nhận" value={transferAssigneeId} /></Field><Field label="Lý do bàn giao"><textarea className={inputClass} minLength={5} onChange={(event) => setTransferReason(event.target.value)} required rows={3} value={transferReason} /></Field><Button disabled={!transferAssigneeId || transferReason.trim().length < 5} loading={submitting} type="submit">Xác nhận bàn giao</Button></form></Modal>
  </div>;
}
