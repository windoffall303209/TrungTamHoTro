"use client";

import { ArrowLeft, Check, ImagePlus, ScanLine, Sparkles, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import { Button, Field, FormattedTextarea, inputClass, RichText } from "@/shared/ui/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import type { Course, Question, QuestionImportResult } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface AiProvider { id: string; provider: string; name: string; model: string; isDefault: boolean; healthStatus: string }
interface ScanDraft extends Omit<Question, "id" | "courseId" | "status" | "version"> { confidence: number; warnings: string[] }
interface ScanResult { providerId: string; provider: string; model: string; sourceName: string; questions: ScanDraft[]; warnings: string[] }

const objectiveTypes = new Set(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"]);

/** Chuyển ảnh đề thành bản nháp câu hỏi bằng AI, cho phép rà soát trước khi lưu/tạo đề. */
export default function ScanQuestionsPage() {
  const router = useRouter();
  const { session, notify } = useApp();
  const allowed = ["SYSTEM_ADMIN", "INSTRUCTOR"].includes(session.roleCode) && hasPermission(session, "question:manage");
  const [courses, setCourses] = useState<Course[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [courseId, setCourseId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [drafts, setDrafts] = useState<ScanDraft[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanRequestId = useRef(0);

  // Vô hiệu kết quả quét đang chờ khi người dùng rời trang.
  useEffect(() => () => { scanRequestId.current += 1; }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    let active = true;
    void Promise.all([
      apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode, signal: controller.signal }),
      apiRequest<AiProvider[]>("/instructor/question-bank/ai-providers", { roleCode: session.roleCode, signal: controller.signal }),
    ]).then(([courseData, providerData]) => {
      if (!active || controller.signal.aborted) return;
      setCourses(courseData);
      setProviders(providerData);
      setProviderId(providerData.find((item) => item.isDefault)?.id ?? providerData[0]?.id ?? "");
    }).catch((error) => {
      if (active && !controller.signal.aborted) notify(error instanceof Error ? error.message : "Không tải được dữ liệu quét đề.", "error");
    });
    return () => { active = false; controller.abort(); };
  }, [allowed, notify, session.roleCode]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const selectedDrafts = useMemo(() => selected.map((index) => drafts[index]).filter((item): item is ScanDraft => Boolean(item)), [drafts, selected]);

  if (!allowed) return <AccessDenied />;
  /** Kiểm tra tệp ảnh đầu vào và tạo URL xem trước chỉ dùng trong trình duyệt. */
  const chooseFile = (next?: File) => {
    if (next && (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size === 0 || next.size > 12 * 1024 * 1024)) {
      notify("Chỉ nhận ảnh PNG, JPEG hoặc WebP có dung lượng từ 1 byte đến 12 MB.", "error");
      return;
    }
    scanRequestId.current += 1;
    setScanning(false);
    setFile(next ?? null); setPreviewUrl(next ? URL.createObjectURL(next) : ""); setDrafts([]); setSelected([]);
  };
  /** Tải ảnh lên dịch vụ quét, nhận các câu hỏi có cấu trúc và đưa vào vùng hiệu đính. */
  const scan = async () => {
    if (!file || !providerId) return;
    const requestId = ++scanRequestId.current;
    setScanning(true);
    try {
      const body = new FormData(); body.append("file", file);
      const result = await apiRequest<ScanResult>("/instructor/question-bank/scan-image", { method: "POST", roleCode: session.roleCode, body });
      if (requestId !== scanRequestId.current) return;
      setDrafts(result.questions); setSelected(result.questions.map((_, index) => index)); notify(`Đã nhận diện ${result.questions.length} câu bằng ${result.model}.`);
    } catch (error) { if (requestId === scanRequestId.current) notify(error instanceof Error ? error.message : "Không quét được ảnh đề.", "error"); }
    finally { if (requestId === scanRequestId.current) setScanning(false); }
  };
  /** Áp dụng bản vá cho đúng câu hỏi quét mà không làm đổi các bản nháp còn lại. */
  const updateDraft = (index: number, patch: Partial<ScanDraft>) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  /** Lưu các bản nháp đã chọn và tùy chọn ghép chúng thành một đề thi mới. */
  const save = async (createExam: boolean) => {
    if (!courseId || !selectedDrafts.length) return;
    setSaving(true);
    try {
      const results = await apiRequest<QuestionImportResult[]>("/instructor/question-bank/questions/import", { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ questions: selectedDrafts.map((question) => ({ courseId, type: question.type, content: question.content, options: question.options, correctAnswers: question.correctAnswers, difficulty: question.difficulty, tags: question.tags })) }) });
      const ids = results.filter((item) => item.status === "IMPORTED" && item.questionId).map((item) => item.questionId!);
      const published = await Promise.allSettled(ids.map((id) => apiRequest<Question>(`/instructor/question-bank/questions/${id}/publish`, { method: "POST", roleCode: session.roleCode })));
      const publishedIds = published.flatMap((result) => result.status === "fulfilled" && result.value.status === "PUBLISHED" ? [result.value.id] : []);
      notify(`Đã lưu ${ids.length}/${selectedDrafts.length} câu và gửi xuất bản.`);
      if (createExam && publishedIds.length) { sessionStorage.setItem("wind-scan-question-ids", JSON.stringify(publishedIds)); router.push("/exams?create=scan"); }
      else router.push("/questions");
    } catch (error) { notify(error instanceof Error ? error.message : "Không lưu được kết quả quét.", "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="w-full space-y-4">
      <button className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs sm:text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] cursor-pointer" onClick={() => router.push("/questions")} type="button"><ArrowLeft size={16} />Quay lại Ngân hàng câu hỏi</button>
      <PageHeader title="Quét ảnh tạo câu hỏi" description="Tải ảnh đề, để AI nhận diện rồi rà soát nội dung, đáp án, Markdown và LaTeX trước khi lưu." />
      <section className="grid gap-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 sm:p-5 shadow-xs lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Field label="Khóa học"><SearchableSelect aria-label="Tìm khóa học cho câu hỏi quét" onChange={setCourseId} options={courses.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, keywords: item.description }))} placeholder="Gõ mã hoặc tên khóa học…" value={courseId} /></Field>
          {!providers.length ? <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-3 text-xs sm:text-sm font-semibold text-amber-800 dark:text-amber-300">Chưa có API key AI đang bật. Quản trị viên cần cấu hình tại Cấu hình → AI và quét đề.</p> : null}
          <label className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-5 text-center hover:border-sky-500 hover:bg-sky-50/30 dark:hover:bg-sky-950/20 transition-all"><input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} type="file" /><span><ImagePlus className="mx-auto text-sky-600 dark:text-sky-400" size={30} /><strong className="mt-3 block text-slate-900 dark:text-slate-100">{file?.name ?? "Chọn ảnh đề thi"}</strong><small className="mt-1 block text-slate-400">PNG, JPEG hoặc WebP · tối đa 12 MB</small></span></label>
          {previewUrl ? <Image alt="Ảnh đề chuẩn bị quét" className="max-h-[420px] w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 object-contain shadow-xs" height={1200} src={previewUrl} unoptimized width={900} /> : null}
          <Button disabled={!file || !providerId} loading={scanning} onClick={() => void scan()}><ScanLine size={17} />Quét và nhận diện</Button>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3"><div><h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Bản nháp cần rà soát</h2><p className="mt-1 text-xs text-slate-400">{drafts.length ? `${selected.length}/${drafts.length} câu được chọn` : "Kết quả quét sẽ xuất hiện ở đây."}</p></div><Sparkles className="text-sky-600 dark:text-sky-400" size={22} /></div>
          <div className="mt-4 max-h-[760px] space-y-4 overflow-y-auto pr-1">
            {!drafts.length ? <div className="grid min-h-56 place-items-center text-center text-sm text-slate-400">Chưa có dữ liệu quét.</div> : drafts.map((draft, index) => (
              <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-4 shadow-2xs" key={index}>
                <div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><input checked={selected.includes(index)} className="size-4 rounded-sm accent-sky-600" onChange={(event) => setSelected((current) => event.target.checked ? [...current, index] : current.filter((value) => value !== index))} type="checkbox" />Câu {index + 1}</label><span className="text-xs font-bold tabular-nums text-sky-600 dark:text-sky-400">Tin cậy {Math.round(draft.confidence * 100)}%</span></div>
                <div className="mt-4 space-y-3"><FormattedTextarea label="Nội dung" onChange={(content) => updateDraft(index, { content })} rows={3} value={draft.content} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Dạng câu hỏi"><select className={inputClass} onChange={(event) => updateDraft(index, { type: event.target.value as ScanDraft["type"] })} value={draft.type}>{["SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER","ESSAY"].map((type) => <option key={type} value={type}>{type}</option>)}</select></Field><Field label="Độ khó"><select className={inputClass} onChange={(event) => updateDraft(index, { difficulty: Number(event.target.value) as 1 | 2 | 3 })} value={draft.difficulty}><option value={1}>Cơ bản</option><option value={2}>Trung bình</option><option value={3}>Nâng cao</option></select></Field></div>{objectiveTypes.has(draft.type) ? <div className="space-y-2">{draft.options.map((option, optionIndex) => <div className="flex gap-2" key={optionIndex}><input className={inputClass} onChange={(event) => updateDraft(index, { options: draft.options.map((item, i) => i === optionIndex ? event.target.value : item) })} value={option} /><button aria-label={`Xóa lựa chọn ${optionIndex + 1}`} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => updateDraft(index, { options: draft.options.filter((_, i) => i !== optionIndex) })} type="button"><Trash2 size={16} /></button></div>)}</div> : null}<Field label="Đáp án đúng / ý tham khảo, mỗi dòng một ý"><textarea className={inputClass} onChange={(event) => updateDraft(index, { correctAnswers: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows={2} value={draft.correctAnswers.join("\n")} /></Field>{draft.warnings.length ? <ul className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-800 dark:text-amber-300">{draft.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : null}<details><summary className="cursor-pointer text-xs font-bold text-sky-600 dark:text-sky-400">Xem bản render Markdown + LaTeX</summary><RichText className="mt-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-3 text-sm">{draft.content}</RichText></details></div>
              </article>
            ))}
          </div>
          {drafts.length ? <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4"><Button disabled={!courseId || !selected.length} loading={saving} onClick={() => void save(false)} variant="secondary"><Check size={16} />Lưu vào ngân hàng</Button><Button disabled={!courseId || !selected.length} loading={saving} onClick={() => void save(true)}><Sparkles size={16} />Lưu và tạo đề</Button></div> : null}
        </div>
      </section>
    </div>
  );
}
