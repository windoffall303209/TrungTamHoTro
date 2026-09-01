"use client";

import { BookOpenCheck, CalendarDays, CheckCircle2, ClipboardPenLine, Download, Eye, FileText, Megaphone, Paperclip, Plus, Send, Trash2, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { AcademicCalendarEvent, Assignment, AssignmentSubmission, ClassAnnouncement, GradebookRow, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

const emptyAssignment = { classId: "", title: "", description: "", instructions: "", dueAt: "", maxScore: 10, rubric: [{ title: "Nội dung", description: "Đáp ứng yêu cầu của bài tập", maxPoints: 10 }] };

export default function AcademicPage() {
  const { session, notify } = useApp();
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [events, setEvents] = useState<AcademicCalendarEvent[]>([]);
  const [announcements, setAnnouncements] = useState<ClassAnnouncement[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignment);
  const [announcementForm, setAnnouncementForm] = useState({ classId: "", title: "", body: "" });
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false);
  const [submitting, setSubmitting] = useState<Assignment | null>(null);
  const [submissionContent, setSubmissionContent] = useState("");
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([]);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [reviewing, setReviewing] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [grading, setGrading] = useState<AssignmentSubmission | null>(null);
  const [rubricScores, setRubricScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const allowed = session.roleCode === "INSTRUCTOR" || session.roleCode === "LEARNER";
  const canTeach = session.roleCode === "INSTRUCTOR" && hasPermission(session, "exam:manage");

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [classData, assignmentData, calendarData, announcementData] = await Promise.all([
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }), apiRequest<Assignment[]>("/academic/assignments", { roleCode: session.roleCode }),
        apiRequest<AcademicCalendarEvent[]>("/academic/calendar", { roleCode: session.roleCode }), apiRequest<ClassAnnouncement[]>("/academic/announcements", { roleCode: session.roleCode }),
      ]);
      setClasses(classData); setAssignments(assignmentData); setEvents(calendarData); setAnnouncements(announcementData);
      const first = selectedClassId || classData[0]?.id || ""; setSelectedClassId(first);
      setAssignmentForm((value) => ({ ...value, classId: value.classId || first })); setAnnouncementForm((value) => ({ ...value, classId: value.classId || first }));
      if (canTeach && first) setGradebook(await apiRequest<GradebookRow[]>(`/academic/classes/${first}/gradebook`, { roleCode: session.roleCode }));
    } catch (error) { notify(error instanceof Error ? error.message : "Không tải được dữ liệu học vụ.", "error"); }
  }, [allowed, canTeach, notify, selectedClassId, session.roleCode]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function changeClass(classId: string): Promise<void> {
    setSelectedClassId(classId);
    assignmentPagination.resetPage();
    gradebookPagination.resetPage();
    if (canTeach && classId) try { setGradebook(await apiRequest<GradebookRow[]>(`/academic/classes/${classId}/gradebook`, { roleCode: session.roleCode })); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được sổ điểm.", "error"); }
  }

  async function createAssignment(event: FormEvent): Promise<void> {
    event.preventDefault();
    try { await apiRequest(`/instructor/classes/${assignmentForm.classId}/assignments`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ ...assignmentForm, dueAt: new Date(assignmentForm.dueAt).toISOString() }) }); setCreatingAssignment(false); setAssignmentForm({ ...emptyAssignment, classId: assignmentForm.classId }); notify("Đã tạo bài tập nháp."); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tạo được bài tập.", "error"); }
  }

  async function publish(item: Assignment): Promise<void> {
    try { await apiRequest(`/instructor/assignments/${item.id}/publish`, { method: "POST", roleCode: session.roleCode }); notify("Đã xuất bản bài tập và thông báo cho học viên."); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Không xuất bản được bài tập.", "error"); }
  }

  async function submitAssignment(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!submitting) return;
    const existingCount = submitting.submission?.attachments.length ?? 0;
    if (!submissionContent.trim() && !existingCount && !submissionFiles.length) { setSubmissionError("Cần nhập nội dung hoặc đính kèm ít nhất một tệp."); return; }
    setSubmissionBusy(true); setSubmissionError("");
    const body = new FormData(); body.set("content", submissionContent.trim()); submissionFiles.forEach((file) => body.append("files", file));
    try { await apiRequest(`/learner/assignments/${submitting.id}/submissions`, { method: "POST", roleCode: session.roleCode, body }); setSubmitting(null); setSubmissionContent(""); setSubmissionFiles([]); notify("Đã lưu bài nộp và tệp đính kèm."); await load(); }
    catch (error) { const message = error instanceof Error ? error.message : "Không nộp được bài."; setSubmissionError(message); notify(message, "error"); }
    finally { setSubmissionBusy(false); }
  }

  function chooseSubmissionFiles(files: FileList | null): void {
    if (!files || !submitting) return;
    const next = [...submissionFiles, ...Array.from(files)];
    const existingCount = submitting.submission?.attachments.length ?? 0;
    if (existingCount + next.length > 5) { setSubmissionError("Mỗi bài nộp được đính kèm tối đa 5 tệp."); return; }
    const allowed = /\.(jpe?g|png|webp|pdf|docx?|txt)$/i;
    const invalid = next.find((file) => file.size <= 0 || file.size > 20 * 1024 * 1024 || !allowed.test(file.name));
    if (invalid) { setSubmissionError(`Tệp ${invalid.name} phải đúng định dạng cho phép và không vượt quá 20 MB.`); return; }
    setSubmissionFiles(next); setSubmissionError("");
  }

  async function removeStoredAttachment(attachmentId: string): Promise<void> {
    const submission = submitting?.submission; if (!submission) return;
    setSubmissionBusy(true); setSubmissionError("");
    try {
      const updated = await apiRequest<AssignmentSubmission>(`/learner/assignment-submissions/${submission.id}/attachments/${attachmentId}`, { method: "DELETE", roleCode: session.roleCode });
      setSubmitting((current) => current ? { ...current, submission: updated } : current); notify("Đã xóa tệp khỏi bài nộp.");
    } catch (error) { const message = error instanceof Error ? error.message : "Không xóa được tệp."; setSubmissionError(message); notify(message, "error"); }
    finally { setSubmissionBusy(false); }
  }

  async function openAttachment(submissionId: string, attachmentId: string, preview: boolean): Promise<void> {
    try {
      const path = `/assignment-submissions/${submissionId}/attachments/${attachmentId}${preview ? "?action=preview" : ""}`;
      if (preview) await previewApiFile(path, session.roleCode); else await downloadApiFile(path, session.roleCode);
    } catch (error) { notify(error instanceof Error ? error.message : "Không mở được tệp bài nộp.", "error"); }
  }

  async function openSubmissions(item: Assignment): Promise<void> {
    try { setSubmissions(await apiRequest<AssignmentSubmission[]>(`/instructor/assignments/${item.id}/submissions`, { roleCode: session.roleCode })); setReviewing(item); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được bài nộp.", "error"); }
  }

  async function grade(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!grading || !reviewing) return;
    try { await apiRequest(`/instructor/assignment-submissions/${grading.id}/grade`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ rubricScores: reviewing.rubric.map((criterion) => ({ criterionId: criterion.id, score: rubricScores[criterion.id] ?? 0 })), feedback }) }); setGrading(null); setFeedback(""); await openSubmissions(reviewing); await load(); notify("Đã lưu điểm rubric và phản hồi."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không lưu được điểm.", "error"); }
  }

  async function createAnnouncement(event: FormEvent): Promise<void> {
    event.preventDefault();
    try { await apiRequest(`/academic/classes/${announcementForm.classId}/announcements`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ title: announcementForm.title, body: announcementForm.body }) }); setCreatingAnnouncement(false); setAnnouncementForm({ classId: announcementForm.classId, title: "", body: "" }); await load(); notify("Đã phát thông báo đến thành viên lớp."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không phát được thông báo.", "error"); }
  }

  const filteredAssignments = useMemo(() => selectedClassId ? assignments.filter((item) => item.classId === selectedClassId) : assignments, [assignments, selectedClassId]);
  const upcomingEvents = useMemo(() => events.slice(0, 12), [events]);
  const assignmentPagination = usePagination(filteredAssignments);
  const gradebookPagination = usePagination(gradebook);
  const submissionPagination = usePagination(submissions);

  if (!allowed) return <AccessDenied />;
  return <div className="workspace-enter mx-auto max-w-7xl px-4 py-8 md:px-7 md:py-10">
    <PageHeader eyebrow="Học vụ" title="Lịch, bài tập & sổ điểm" description="Một dòng thời gian chung cho hạn học tập, thông báo lớp và kết quả đánh giá." actions={canTeach ? <div className="flex flex-wrap gap-2"><Button onClick={() => setCreatingAnnouncement(true)} variant="secondary"><Megaphone size={16} />Thông báo</Button><Button onClick={() => setCreatingAssignment(true)}><Plus size={16} />Tạo bài tập</Button></div> : undefined} />
    <div className="mb-7 max-w-md"><Field label="Lớp đang xem"><SearchableSelect aria-label="Tìm và chọn lớp đang xem" onChange={(value) => void changeClass(value)} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={selectedClassId} /></Field></div>

    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
      <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 px-5 py-6"><div className="flex items-center gap-3"><ClipboardPenLine className="text-[#c75b39]" size={21} /><h2 className="section-title">Bài tập</h2></div><div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">{filteredAssignments.length ? assignmentPagination.pageItems.map((item) => <article className="py-5" key={item.id}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{item.title}</h3><StatusBadge status={item.status} /></div><p className="mt-1 text-sm leading-6 text-[#516274]">{item.description}</p><p className="mt-2 text-xs font-semibold text-[#657789]">Hạn {new Date(item.dueAt).toLocaleString("vi-VN")} · {item.maxScore} điểm · {item.rubric.length} tiêu chí</p>{item.submission ? <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[#27685f]"><CheckCircle2 size={14} />{item.submission.status === "GRADED" ? `Đã chấm: ${item.submission.score}/${item.maxScore}` : `Đã nộp · ${item.submission.attachments.length} tệp`}</p> : null}</div><div className="flex shrink-0 flex-wrap gap-2">{canTeach ? <>{item.status === "DRAFT" ? <Button onClick={() => void publish(item)} variant="secondary"><Send size={15} />Xuất bản</Button> : null}<Button onClick={() => void openSubmissions(item)} variant="ghost"><UsersRound size={15} />Bài nộp</Button></> : session.roleCode === "LEARNER" && item.status === "PUBLISHED" ? <Button onClick={() => { setSubmitting(item); setSubmissionContent(item.submission?.content ?? ""); setSubmissionFiles([]); setSubmissionError(""); }} variant="secondary">{item.submission ? "Sửa bài nộp" : "Nộp bài"}</Button> : null}</div></div></article>) : <p className="py-10 text-center text-sm text-[#657789]">Lớp này chưa có bài tập.</p>}</div><Pagination itemLabel="bài tập" onPageChange={assignmentPagination.setPage} onPageSizeChange={assignmentPagination.setPageSize} page={assignmentPagination.page} pageSize={assignmentPagination.pageSize} totalItems={assignmentPagination.totalItems} /></section>
      <div className="space-y-7">
        <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 px-5 py-6"><div className="flex items-center gap-3"><CalendarDays className="text-[#c75b39]" size={21} /><h2 className="section-title">Lịch sắp tới</h2></div><div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">{upcomingEvents.filter((item) => !selectedClassId || item.classId === selectedClassId).slice(0, 7).map((item) => <Link className="flex items-start gap-3 py-3 hover:text-[#963f2a]" href={item.href} key={item.id}><time className="w-24 shrink-0 text-xs font-bold tabular-nums text-[#657789]">{new Date(item.startAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span className="min-w-0"><strong className="block text-sm">{item.title}</strong><small className="text-[#657789]">{item.classCode}</small></span></Link>)}</div></section>
        <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 px-5 py-6"><div className="flex items-center gap-3"><Megaphone className="text-[#c75b39]" size={21} /><h2 className="section-title">Thông báo lớp</h2></div><div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">{announcements.filter((item) => !selectedClassId || item.classId === selectedClassId).slice(0, 5).map((item) => <article className="py-4" key={item.id}><h3 className="text-sm font-bold">{item.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#516274]">{item.body}</p><p className="mt-2 text-xs text-[#657789]">{item.authorName} · {new Date(item.publishedAt).toLocaleString("vi-VN")}</p></article>)}</div></section>
      </div>
    </div>

    {canTeach ? <section className="mt-7 border-y border-[#a9bac1] bg-[#fffdfa]/65 px-5 py-6"><div className="flex items-center gap-3"><BookOpenCheck className="text-[#c75b39]" size={21} /><h2 className="section-title">Sổ điểm tổng hợp</h2></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[46rem] border-collapse text-left text-sm"><thead><tr className="border-y border-[#a9bac1] text-xs text-[#516274]"><th className="px-3 py-3">Học viên</th><th className="px-3 py-3">Đề thi</th><th className="px-3 py-3">Bài tập</th><th className="px-3 py-3">Tổng kết</th></tr></thead><tbody>{gradebookPagination.pageItems.map((row) => <tr className="border-b border-[#d5dfe2]" key={row.learnerId}><td className="px-3 py-4"><strong>{row.learnerName}</strong><small className="mt-0.5 block text-[#657789]">{row.learnerEmail}</small></td><td className="px-3 py-4 tabular-nums">{row.examEarned}/{row.examPossible}</td><td className="px-3 py-4 tabular-nums">{row.assignmentEarned}/{row.assignmentPossible}</td><td className="px-3 py-4 font-bold tabular-nums">{row.totalPercent}%</td></tr>)}</tbody></table>{!gradebook.length ? <p className="py-10 text-center text-sm text-[#657789]">Chưa có học viên hoặc dữ liệu điểm.</p> : null}</div><Pagination itemLabel="học viên" onPageChange={gradebookPagination.setPage} onPageSizeChange={gradebookPagination.setPageSize} page={gradebookPagination.page} pageSize={gradebookPagination.pageSize} totalItems={gradebookPagination.totalItems} /></section> : null}

    <Modal open={creatingAssignment} onClose={() => setCreatingAssignment(false)} title="Tạo bài tập" description="Rubric là nguồn điểm chính thức; tổng điểm các tiêu chí phải bằng điểm tối đa."><form className="space-y-4" onSubmit={(event) => void createAssignment(event)}><Field label="Lớp"><SearchableSelect aria-label="Tìm và chọn lớp nhận bài tập" onChange={(value) => setAssignmentForm({ ...assignmentForm, classId: value })} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={assignmentForm.classId} /></Field><Field label="Tên bài tập"><input className={inputClass} minLength={3} required value={assignmentForm.title} onChange={(event) => setAssignmentForm({ ...assignmentForm, title: event.target.value })} /></Field><Field label="Mô tả"><textarea className={inputClass} minLength={10} required rows={3} value={assignmentForm.description} onChange={(event) => setAssignmentForm({ ...assignmentForm, description: event.target.value })} /></Field><Field label="Hướng dẫn nộp"><textarea className={inputClass} minLength={5} required rows={3} value={assignmentForm.instructions} onChange={(event) => setAssignmentForm({ ...assignmentForm, instructions: event.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Hạn nộp"><input className={inputClass} required type="datetime-local" value={assignmentForm.dueAt} onChange={(event) => setAssignmentForm({ ...assignmentForm, dueAt: event.target.value })} /></Field><Field label="Điểm tối đa"><input className={inputClass} min={0.25} required step="0.25" type="number" value={assignmentForm.maxScore} onChange={(event) => setAssignmentForm({ ...assignmentForm, maxScore: Number(event.target.value) })} /></Field></div><div><div className="flex items-center justify-between"><p className="text-sm font-bold">Tiêu chí rubric</p><Button onClick={() => setAssignmentForm({ ...assignmentForm, rubric: [...assignmentForm.rubric, { title: "", description: "", maxPoints: 0 }] })} variant="ghost"><Plus size={14} />Thêm tiêu chí</Button></div><div className="mt-2 space-y-3">{assignmentForm.rubric.map((criterion, index) => <div className="grid gap-2 border-y border-[#d5dfe2] py-3 sm:grid-cols-[1fr_100px]" key={index}><input aria-label={`Tên tiêu chí ${index + 1}`} className={inputClass} placeholder="Tên tiêu chí" required value={criterion.title} onChange={(event) => { const rubric = [...assignmentForm.rubric]; rubric[index] = { ...criterion, title: event.target.value }; setAssignmentForm({ ...assignmentForm, rubric }); }} /><input aria-label={`Điểm tiêu chí ${index + 1}`} className={inputClass} min={0.25} step="0.25" type="number" value={criterion.maxPoints} onChange={(event) => { const rubric = [...assignmentForm.rubric]; rubric[index] = { ...criterion, maxPoints: Number(event.target.value) }; setAssignmentForm({ ...assignmentForm, rubric }); }} /><textarea aria-label={`Mô tả tiêu chí ${index + 1}`} className={`${inputClass} sm:col-span-2`} placeholder="Mô tả mức đạt yêu cầu" required rows={2} value={criterion.description} onChange={(event) => { const rubric = [...assignmentForm.rubric]; rubric[index] = { ...criterion, description: event.target.value }; setAssignmentForm({ ...assignmentForm, rubric }); }} /></div>)}</div></div><Button disabled={!assignmentForm.classId} type="submit">Lưu bản nháp</Button></form></Modal>
    <Modal open={creatingAnnouncement} onClose={() => setCreatingAnnouncement(false)} title="Phát thông báo lớp"><form className="space-y-4" onSubmit={(event) => void createAnnouncement(event)}><Field label="Lớp"><SearchableSelect aria-label="Tìm và chọn lớp nhận thông báo" onChange={(value) => setAnnouncementForm({ ...announcementForm, classId: value })} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={announcementForm.classId} /></Field><Field label="Tiêu đề"><input className={inputClass} minLength={3} required value={announcementForm.title} onChange={(event) => setAnnouncementForm({ ...announcementForm, title: event.target.value })} /></Field><Field label="Nội dung"><textarea className={inputClass} minLength={5} required rows={5} value={announcementForm.body} onChange={(event) => setAnnouncementForm({ ...announcementForm, body: event.target.value })} /></Field><Button disabled={!announcementForm.classId} type="submit"><Megaphone size={15} />Phát thông báo</Button></form></Modal>
    <Modal open={Boolean(submitting)} onClose={() => { if (!submissionBusy) setSubmitting(null); }} title={submitting?.title ?? "Nộp bài"} description={submitting?.instructions}><form className="space-y-5" onSubmit={(event) => void submitAssignment(event)}><Field label="Nội dung bài làm (không bắt buộc khi có tệp)"><textarea className={inputClass} maxLength={20_000} rows={7} value={submissionContent} onChange={(event) => { setSubmissionContent(event.target.value); setSubmissionError(""); }} /></Field><div><p className="text-sm font-bold text-[#102a43]">Tệp bài làm</p><p className="mt-1 text-xs leading-5 text-[#657789]">Tối đa 5 tệp, 20 MB/tệp · JPG, PNG, WebP, PDF, DOC, DOCX hoặc TXT.</p><label className="mt-3 flex min-h-24 cursor-pointer items-center justify-center gap-2 border border-dashed border-[#a9bac1] bg-[#fffdfa] px-4 py-5 text-sm font-bold text-[#102a43] transition-colors hover:border-[#c75b39] hover:text-[#963f2a] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#c75b39]"><Paperclip size={18} />Chọn tệp từ máy<input accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt" className="sr-only" disabled={submissionBusy || (submitting?.submission?.attachments.length ?? 0) + submissionFiles.length >= 5} multiple onChange={(event) => { chooseSubmissionFiles(event.target.files); event.target.value = ""; }} type="file" /></label></div>{submitting?.submission?.attachments.length || submissionFiles.length ? <div className="divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">{submitting?.submission?.attachments.map((file) => <div className="flex min-w-0 items-center gap-3 py-3" key={file.id}><FileText className="shrink-0 text-[#657789]" size={18} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.originalName}</p><p className="text-xs text-[#657789]">{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · Đã lưu</p></div>{file.canPreview ? <button aria-label={`Xem trước ${file.originalName}`} className="rounded-lg p-2 text-[#516274] hover:bg-[#eee8dc]" onClick={() => void openAttachment(submitting.submission!.id, file.id, true)} type="button"><Eye size={17} /></button> : null}<button aria-label={`Tải ${file.originalName}`} className="rounded-lg p-2 text-[#516274] hover:bg-[#eee8dc]" onClick={() => void openAttachment(submitting.submission!.id, file.id, false)} type="button"><Download size={17} /></button>{submitting.submission?.status !== "GRADED" ? <button aria-label={`Xóa ${file.originalName}`} className="rounded-lg p-2 text-[#963f2a] hover:bg-[#f3e4de]" disabled={submissionBusy} onClick={() => void removeStoredAttachment(file.id)} type="button"><Trash2 size={17} /></button> : null}</div>)}{submissionFiles.map((file, index) => <div className="flex min-w-0 items-center gap-3 py-3" key={`${file.name}-${file.lastModified}-${index}`}><FileText className="shrink-0 text-[#c75b39]" size={18} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="text-xs text-[#657789]">{(file.size / 1024 / 1024).toFixed(2)} MB · Chờ tải lên</p></div><button aria-label={`Bỏ ${file.name}`} className="rounded-lg p-2 text-[#516274] hover:bg-[#eee8dc]" disabled={submissionBusy} onClick={() => setSubmissionFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} type="button"><X size={17} /></button></div>)}</div> : null}{submissionError ? <p aria-live="polite" className="text-sm font-semibold text-[#963f2a]">{submissionError}</p> : null}<Button disabled={submissionBusy || (!submissionContent.trim() && !(submitting?.submission?.attachments.length ?? 0) && !submissionFiles.length)} type="submit"><Send size={15} />{submissionBusy ? "Đang lưu…" : submitting?.submission ? "Lưu thay đổi" : "Nộp bài"}</Button></form></Modal>
    <Modal open={Boolean(reviewing)} onClose={() => setReviewing(null)} title={`Bài nộp · ${reviewing?.title ?? ""}`}><div className="divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">{submissionPagination.pageItems.map((item) => <article className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between" key={item.id}><div className="min-w-0"><p className="font-bold">{item.learnerName}</p><p className="text-xs text-[#657789]">{item.learnerEmail} · {new Date(item.submittedAt).toLocaleString("vi-VN")}</p><p className="mt-2 line-clamp-2 text-sm text-[#516274]">{item.content || "Bài nộp chỉ có tệp đính kèm."}</p>{item.attachments.length ? <div className="mt-2 flex flex-wrap gap-2">{item.attachments.map((file) => <button className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#d5dfe2] bg-[#fffdfa] px-2.5 py-1.5 text-xs font-semibold text-[#102a43] hover:border-[#a9bac1]" key={file.id} onClick={() => void openAttachment(item.id, file.id, file.canPreview)} type="button"><Paperclip size={13} /><span className="max-w-48 truncate">{file.originalName}</span></button>)}</div> : null}</div><Button onClick={() => { setGrading(item); setRubricScores(Object.fromEntries(item.rubricScores.map((score) => [score.criterionId, score.score]))); setFeedback(item.feedback ?? ""); }} variant="secondary">{item.status === "GRADED" ? "Sửa điểm" : "Chấm bài"}</Button></article>)}</div><Pagination itemLabel="bài nộp" onPageChange={submissionPagination.setPage} onPageSizeChange={submissionPagination.setPageSize} page={submissionPagination.page} pageSize={submissionPagination.pageSize} totalItems={submissionPagination.totalItems} /></Modal>
    <Modal open={Boolean(grading)} onClose={() => setGrading(null)} title={`Chấm bài · ${grading?.learnerName ?? ""}`}><form className="space-y-4" onSubmit={(event) => void grade(event)}><div className="max-h-40 overflow-auto border-y border-[#d5dfe2] p-3 text-sm leading-6 whitespace-pre-wrap">{grading?.content || "Bài nộp chỉ có tệp đính kèm."}</div>{grading?.attachments.length ? <div><p className="mb-2 text-sm font-bold">Tệp bài làm</p><div className="flex flex-wrap gap-2">{grading.attachments.map((file) => <Button key={file.id} onClick={() => void openAttachment(grading.id, file.id, file.canPreview)} variant="ghost">{file.canPreview ? <Eye size={15} /> : <Download size={15} />}{file.originalName}</Button>)}</div></div> : null}{reviewing?.rubric.map((criterion) => <Field key={criterion.id} label={`${criterion.title} — tối đa ${criterion.maxPoints}`}><input className={inputClass} max={criterion.maxPoints} min={0} required step="0.25" type="number" value={rubricScores[criterion.id] ?? 0} onChange={(event) => setRubricScores({ ...rubricScores, [criterion.id]: Number(event.target.value) })} /><span className="mt-1 block text-xs font-normal text-[#657789]">{criterion.description}</span></Field>)}<Field label="Phản hồi"><textarea className={inputClass} minLength={3} required rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></Field><Button type="submit">Lưu điểm rubric</Button></form></Modal>
  </div>;
}
