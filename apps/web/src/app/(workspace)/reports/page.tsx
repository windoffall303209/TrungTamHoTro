"use client";

import { Activity, BookOpenCheck, CheckCircle2, Download, FileStack, Filter, MessageSquareWarning, Plus, Radio, ShieldAlert, TicketCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest, downloadApiFile } from "@/lib/api-client";
import type { ClassProgressReport, ExamAnalytics, OperationalReport, ReportExport, ReportRun } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface ClassReport { classId: string; classCode: string; className: string; learners: number; instructors: number; publishedMaterials: number; exams: number; submittedAttempts: number; averageScore: number; sessions: number; attendanceRate: number; status: string }

const dateInput = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export default function ReportsPage() {
  const { session, notify } = useApp();
  const manager = session.roleCode === "CENTER_MANAGER";
  const instructor = session.roleCode === "INSTRUCTOR";
  const allowed = manager || session.roleCode === "INSTRUCTOR";
  const today = useMemo(() => new Date(), []);
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [classReports, setClassReports] = useState<ClassReport[]>([]);
  const [progress, setProgress] = useState<ClassProgressReport | null>(null);
  const [examAnalytics, setExamAnalytics] = useState<ExamAnalytics | null>(null);
  const [exports, setExports] = useState<ReportExport[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [filters, setFilters] = useState({ from: dateInput(new Date(today.getFullYear(), 0, 1)), to: dateInput(today), attendanceBelow: 70, scoreBelow: 50, completionBelow: 60 });
  const [interventionLearnerId, setInterventionLearnerId] = useState<string | null>(null);
  const [interventionForm, setInterventionForm] = useState({ title: "Liên hệ hỗ trợ học tập", notes: "", dueAt: dateInput(new Date(today.getTime() + 7 * 86_400_000)) });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(() => new URLSearchParams({ from: new Date(`${filters.from}T00:00:00+07:00`).toISOString(), to: new Date(`${filters.to}T23:59:59+07:00`).toISOString() }).toString(), [filters.from, filters.to]);

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

  const loadProgress = useCallback(async () => {
    if (!manager || !selectedClassId) return;
    try {
      const params = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), attendanceBelow: String(filters.attendanceBelow), scoreBelow: String(filters.scoreBelow), completionBelow: String(filters.completionBelow) });
      setProgress(await apiRequest<ClassProgressReport>(`/manager/classes/${selectedClassId}/progress?${params}`, { roleCode: session.roleCode }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được tiến độ lớp.", "error");
    }
  }, [filters.attendanceBelow, filters.completionBelow, filters.scoreBelow, manager, notify, query, selectedClassId, session.roleCode]);
  const loadExamAnalytics = useCallback(async () => {
    if (!instructor) return;
    try { const params = new URLSearchParams(query); if (selectedClassId) params.set("classId", selectedClassId); setExamAnalytics(await apiRequest<ExamAnalytics>(`/instructor/analytics/exams?${params}`, { roleCode: session.roleCode })); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được phân tích đánh giá.", "error"); }
  }, [instructor, notify, query, selectedClassId, session.roleCode]);

  useEffect(() => { const timer = window.setTimeout(() => void loadOverview(), 0); return () => window.clearTimeout(timer); }, [loadOverview]);
  useEffect(() => { const timer = window.setTimeout(() => void loadProgress(), 0); return () => window.clearTimeout(timer); }, [loadProgress]);
  useEffect(() => { const timer = window.setTimeout(() => void loadExamAnalytics(), 0); return () => window.clearTimeout(timer); }, [loadExamAnalytics]);

  if (!allowed) return <AccessDenied />;

  const metrics = report ? [
    { label: "Khóa học", value: report.courses, icon: BookOpenCheck }, { label: "Lớp học", value: report.classes, icon: Activity },
    { label: "Học liệu", value: report.materials, icon: FileStack }, { label: "Đề thi", value: report.exams, icon: BookOpenCheck },
    { label: "Báo cáo mở", value: report.openReports, icon: MessageSquareWarning }, { label: "Buổi trực tuyến", value: report.liveSessions, icon: Radio },
    { label: "Phiếu hỗ trợ mở", value: report.openTickets, icon: TicketCheck },
  ] : [];

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

  const createIntervention = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!interventionLearnerId || !selectedClassId) return;
    try {
      setSubmitting(true);
      await apiRequest(`/manager/classes/${selectedClassId}/progress/interventions`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ learnerId: interventionLearnerId, title: interventionForm.title, notes: interventionForm.notes, dueAt: new Date(`${interventionForm.dueAt}T17:00:00+07:00`).toISOString() }) });
      notify("Đã giao hành động hỗ trợ và lưu vào hồ sơ tiến độ.");
      setInterventionLearnerId(null);
      await loadProgress();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không giao được hành động hỗ trợ.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const completeIntervention = async (interventionId: string) => {
    try {
      await apiRequest(`/manager/progress/interventions/${interventionId}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ status: "DONE" }) });
      notify("Đã hoàn tất hành động hỗ trợ.");
      await loadProgress();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được hành động.", "error");
    }
  };

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
    <PageHeader eyebrow="Operational Intelligence" title="Báo cáo vận hành" description="Đối soát chỉ số theo kỳ, nhận diện rủi ro có giải thích và quản lý lịch sử xuất dữ liệu." />

    <section className="mb-7 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Field label="Từ ngày"><input className={inputClass} max={filters.to} type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></Field>
        <Field label="Đến ngày"><input className={inputClass} min={filters.from} type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></Field>
        {manager ? <><Field label="Điểm danh dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.attendanceBelow} onChange={(event) => setFilters({ ...filters, attendanceBelow: Number(event.target.value) })} /></Field><Field label="Điểm dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.scoreBelow} onChange={(event) => setFilters({ ...filters, scoreBelow: Number(event.target.value) })} /></Field><Field label="Tiến độ dưới %"><input className={inputClass} max={100} min={1} type="number" value={filters.completionBelow} onChange={(event) => setFilters({ ...filters, completionBelow: Number(event.target.value) })} /></Field></> : null}
        <div className="flex items-end gap-2"><Button loading={loading} onClick={() => { void loadOverview(); void loadExamAnalytics(); }} variant="secondary"><Filter size={15} />Áp dụng</Button>{manager ? <Button loading={submitting} onClick={() => void createExport()}><Download size={15} />CSV</Button> : null}{instructor ? <Button onClick={() => { const params = new URLSearchParams(query); if (selectedClassId) params.set("classId", selectedClassId); void downloadApiFile(`/instructor/analytics/exams/export?${params}`, session.roleCode); }}><Download size={15} />CSV đánh giá</Button> : null}</div>
      </div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(({ label, value, icon: Icon }, index) => <article className={`rounded-2xl border p-5 ${index === 0 ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white"}`} key={label}><Icon className={index === 0 ? "text-sky-400" : "text-sky-700"} size={21} /><p className="mt-7 text-3xl font-extrabold">{value}</p><p className={`mt-1 text-xs font-bold ${index === 0 ? "text-slate-400" : "text-slate-500"}`}>{label}</p></article>)}</div>

    {report ? <section className="mt-7 grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-[1.2fr_.8fr]">
      <div><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-xl font-extrabold">Định nghĩa chỉ số</h2><span className="text-xs font-bold text-slate-500">v{report.definitionVersion} · {report.timezone}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(report.metricDefinitions).map(([key, definition]) => <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600" key={key}><strong className="text-slate-900">{key}:</strong> {definition}</p>)}</div></div>
      <aside className="rounded-xl bg-amber-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wider text-amber-700">Cần chú ý</p><p className="mt-3 text-3xl font-extrabold text-amber-950">{report.openReports + report.openTickets}</p><p className="mt-1 text-sm leading-6 text-amber-800">báo cáo nội dung và phiếu hỗ trợ đang chờ xử lý.</p></aside>
    </section> : <div className="mt-7 h-48 animate-pulse rounded-2xl bg-slate-200" />}

    <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-heading text-xl font-extrabold">Hiệu quả theo lớp</h2><p className="mt-1 text-sm text-slate-500">Tiến độ nội dung, đánh giá và tỷ lệ tham dự được tổng hợp theo lớp.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Lớp</th><th className="px-5 py-3">Học viên</th><th className="px-5 py-3">Học liệu</th><th className="px-5 py-3">Đề / lượt nộp</th><th className="px-5 py-3">Điểm TB</th><th className="px-5 py-3">Điểm danh</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-slate-100">{classReports.map((item) => <tr key={item.classId}><td className="px-5 py-4"><p className="font-extrabold">{item.classCode}</p><p className="text-xs text-slate-500">{item.className}</p></td><td className="px-5 py-4">{item.learners}</td><td className="px-5 py-4">{item.publishedMaterials}</td><td className="px-5 py-4">{item.exams} / {item.submittedAttempts}</td><td className="px-5 py-4 font-extrabold">{item.averageScore}</td><td className="px-5 py-4">{item.attendanceRate}%</td><td className="px-5 py-4"><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div></section>

    {instructor ? <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-heading text-xl font-extrabold">Phân tích kết quả đánh giá</h2><p className="mt-1 text-sm text-slate-500">Chỉ số lấy từ bài đã chấm; thống kê câu hỏi chỉ mở sau khi đề đóng.</p></div><Field label="Lớp"><select className={inputClass} value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}><option value="">Tất cả lớp được phân công</option>{classReports.map((item) => <option key={item.classId} value={item.classId}>{item.classCode}</option>)}</select></Field></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{examAnalytics?.exams.map((exam) => <article className="rounded-xl border border-slate-200 p-4" key={exam.examId}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{exam.title}</strong>{exam.smallSampleWarning ? <StatusBadge status="SMALL_SAMPLE" /> : <StatusBadge status="STABLE" />}</div><div className="mt-4 grid grid-cols-3 gap-3 text-center"><div><p className="text-2xl font-extrabold">{exam.sampleSize}</p><p className="text-xs text-slate-500">Bài đã chấm</p></div><div><p className="text-2xl font-extrabold">{exam.averagePercentage}%</p><p className="text-xs text-slate-500">Điểm TB</p></div><div><p className="text-2xl font-extrabold">{exam.passRate}%</p><p className="text-xs text-slate-500">Đạt ≥ 50%</p></div></div><p className={`mt-4 rounded-lg px-3 py-2 text-xs ${exam.questionStatsAvailable ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{exam.questionStatsAvailable ? `Đã mở thống kê ${exam.questionStats.length} câu sau khi đề đóng.` : "Đề còn mở: hệ thống chưa hiển thị thống kê câu hỏi để tránh lộ tín hiệu đáp án."}</p></article>)}</div></section> : null}

    {manager ? <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-heading text-xl font-extrabold">Học viên cần hỗ trợ</h2><p className="mt-1 text-sm text-slate-500">Cờ rủi ro chỉ là tín hiệu giải thích được, không dùng làm quyết định kỷ luật tự động.</p></div><Field label="Lớp"><select className={inputClass} value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}>{classReports.map((item) => <option key={item.classId} value={item.classId}>{item.classCode} — {item.className}</option>)}</select></Field></div>
      <div className="mt-5 space-y-3">{progress?.learners.map((learner) => <article className="grid gap-4 rounded-xl border border-slate-200 p-4 lg:grid-cols-[1fr_.75fr_1.25fr_auto] lg:items-center" key={learner.learnerId}><div><p className="font-extrabold">{learner.learnerId}</p><div className="mt-2 flex items-center gap-2"><StatusBadge status={learner.riskLevel} /><span className="text-xs text-slate-500">Hoạt động cuối: {learner.lastActivityAt ? new Date(learner.lastActivityAt).toLocaleString("vi-VN") : "Chưa có"}</span></div></div><div className="grid grid-cols-2 gap-2 text-xs"><span>Học liệu <strong>{learner.materialCompletionRate}%</strong></span><span>Bài thi <strong>{learner.assessmentCompletionRate}%</strong></span><span>Điểm danh <strong>{learner.attendanceRate}%</strong></span><span>Điểm TB <strong>{learner.averageScore}%</strong></span></div><div className="text-xs leading-5 text-slate-600">{learner.riskReasons.length ? learner.riskReasons.map((reason) => <p key={reason}>• {reason}</p>) : <p className="text-emerald-700">Không có tín hiệu vượt ngưỡng.</p>}{learner.interventions.filter((item) => item.status === "OPEN").map((item) => <button className="mt-1 flex items-center gap-1 font-bold text-sky-700" key={item.id} onClick={() => void completeIntervention(item.id)} type="button"><CheckCircle2 size={13} />{item.title} · hoàn tất</button>)}</div><Button onClick={() => setInterventionLearnerId(learner.learnerId)} variant="secondary"><Plus size={14} />Hành động</Button></article>)}</div>
    </section> : null}

    {manager && exports.length ? <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-heading text-xl font-extrabold">Lịch sử xuất báo cáo</h2><div className="mt-4 space-y-2">{exports.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4" key={item.id}><div><p className="text-sm font-bold">{item.fileName}</p><p className="text-xs text-slate-500">{item.sizeBytes ?? 0} byte · hết hạn {new Date(item.expiresAt).toLocaleString("vi-VN")}</p></div><div className="flex items-center gap-2"><StatusBadge status={item.status} />{item.status === "COMPLETED" ? <Button onClick={() => void downloadApiFile(`/manager/reports/exports/${item.id}/download`, session.roleCode)} variant="ghost"><Download size={14} />Tải</Button> : null}</div></div>)}</div></section> : null}

    <Modal open={Boolean(interventionLearnerId)} onClose={() => setInterventionLearnerId(null)} title="Giao hành động hỗ trợ" description={`Học viên ${interventionLearnerId ?? ""}; hành động này được theo dõi riêng, không thay đổi điểm hay kỷ luật.`}><form className="space-y-4" onSubmit={(event) => void createIntervention(event)}><Field label="Tên hành động"><input className={inputClass} minLength={3} required value={interventionForm.title} onChange={(event) => setInterventionForm({ ...interventionForm, title: event.target.value })} /></Field><Field label="Ghi chú"><textarea className={inputClass} rows={3} value={interventionForm.notes} onChange={(event) => setInterventionForm({ ...interventionForm, notes: event.target.value })} /></Field><Field label="Hạn hoàn thành"><input className={inputClass} min={dateInput(new Date(today.getTime() + 86_400_000))} required type="date" value={interventionForm.dueAt} onChange={(event) => setInterventionForm({ ...interventionForm, dueAt: event.target.value })} /></Field><Button loading={submitting} type="submit"><ShieldAlert size={15} />Giao hỗ trợ</Button></form></Modal>
  </div>;
}
