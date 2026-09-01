"use client";

import { Check, CheckCircle2, CirclePlus, FileQuestion, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, FormattedTextarea, inputClass, Modal, Pagination, RichText, StatusBadge, usePagination } from "@/components/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import type { Course, Question, QuestionImportResult } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type QuestionType = Question["type"];
type QuestionForm = { courseId: string; type: QuestionType; content: string; options: string[]; correctAnswers: string[]; difficulty: Question["difficulty"]; tags: string };
type FormErrors = Partial<Record<"courseId" | "content" | "options" | "correctAnswers", string>>;

const typeMeta: Record<QuestionType, { label: string; description: string }> = {
  SINGLE_CHOICE: { label: "Một đáp án", description: "Người học chọn đúng một lựa chọn." },
  MULTIPLE_CHOICE: { label: "Nhiều đáp án", description: "Người học có thể chọn nhiều lựa chọn đúng." },
  TRUE_FALSE: { label: "Đúng / Sai", description: "Hai lựa chọn cố định, chọn một đáp án đúng." },
  SHORT_ANSWER: { label: "Trả lời ngắn", description: "Người học nhập câu trả lời; giảng viên chấm thủ công." },
  ESSAY: { label: "Tự luận", description: "Người học viết bài; giảng viên chấm thủ công." },
};
const objectiveTypes: QuestionType[] = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"];
const createBlankForm = (): QuestionForm => ({ courseId: "", type: "SINGLE_CHOICE", content: "", options: ["", ""], correctAnswers: [], difficulty: 2, tags: "" });
const toPayload = (form: QuestionForm) => ({ ...form, content: form.content.trim(), options: form.options.map((value) => value.trim()).filter(Boolean), correctAnswers: form.correctAnswers.map((value) => value.trim()).filter(Boolean), tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean) });

const validateForm = (form: QuestionForm): FormErrors => {
  const errors: FormErrors = {};
  const options = form.options.map((value) => value.trim()).filter(Boolean);
  if (!form.courseId) errors.courseId = "Chọn khóa học để phân loại và tái sử dụng câu hỏi.";
  if (form.content.trim().length < 5) errors.content = "Nội dung cần ít nhất 5 ký tự.";
  if (objectiveTypes.includes(form.type)) {
    if (options.length < 2) errors.options = "Câu trắc nghiệm cần ít nhất hai lựa chọn có nội dung.";
    else if (new Set(options).size !== options.length) errors.options = "Các lựa chọn không được trùng nhau.";
    if (form.type === "MULTIPLE_CHOICE" && form.correctAnswers.length < 1) errors.correctAnswers = "Chọn ít nhất một đáp án đúng.";
    if ((form.type === "SINGLE_CHOICE" || form.type === "TRUE_FALSE") && form.correctAnswers.length !== 1) errors.correctAnswers = "Chọn đúng một đáp án đúng.";
  }
  return errors;
};

function QuestionPreview({ form }: { form: QuestionForm }) {
  const visibleOptions = objectiveTypes.includes(form.type) ? form.options.filter((option) => option.trim()) : [];
  return (
    <aside className="lg:sticky lg:top-0 lg:self-start">
      <div className="border-y border-[var(--rule-strong)] bg-[var(--canvas)] px-5 py-5">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] pb-3"><h3 className="font-bold text-[var(--ink)]">Xem trước khi lưu</h3><span className="text-xs font-bold text-[var(--ink-soft)]">{typeMeta[form.type].label}</span></div>
        <div className="py-5">
          {form.content.trim() ? <RichText className="font-semibold">{form.content}</RichText> : <p className="text-sm text-[var(--ink-soft)]">Nội dung câu hỏi sẽ xuất hiện tại đây.</p>}
          {visibleOptions.length ? <ol className="mt-5 space-y-2">{visibleOptions.map((option, index) => <li className="flex gap-3 border-b border-[var(--rule)] py-2.5 last:border-b-0" key={`${index}-${option}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg border border-[var(--rule-strong)] text-xs font-bold text-[var(--ink-soft)]">{String.fromCharCode(65 + index)}</span><RichText className="min-w-0 text-sm">{option}</RichText></li>)}</ol>
            : form.type === "SHORT_ANSWER" ? <div className="mt-5 min-h-11 border-b border-[var(--rule-strong)] text-sm text-[var(--ink-soft)]">Câu trả lời ngắn của học viên</div>
              : form.type === "ESSAY" ? <div className="mt-5 min-h-28 rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-soft)]">Bài làm tự luận của học viên</div> : null}
        </div>
        <p className="border-t border-[var(--rule)] pt-3 text-xs leading-5 text-[var(--ink-soft)]">Hỗ trợ Markdown cho chữ đậm/nghiêng và LaTeX cho công thức trong nội dung lẫn lựa chọn.</p>
      </div>
    </aside>
  );
}

export default function QuestionsPage() {
  const { session, notify } = useApp();
  const canView = ["SYSTEM_ADMIN", "INSTRUCTOR"].includes(session.roleCode) && hasPermission(session, "question:view");
  const canManage = ["SYSTEM_ADMIN", "INSTRUCTOR"].includes(session.roleCode) && hasPermission(session, "question:manage");
  const canViewCourses = hasPermission(session, "course:view");
  const [items, setItems] = useState<Question[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ courseId: "", type: "", difficulty: "", tag: "" });
  const [loading, setLoading] = useState(true);
  const pagination = usePagination(items);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<QuestionForm>(createBlankForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResults, setImportResults] = useState<QuestionImportResult[]>([]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const [questions, courseData] = await Promise.all([
        apiRequest<Question[]>(`/instructor/question-bank/questions?${params.toString()}`, { roleCode: session.roleCode }),
        canViewCourses ? apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode }) : Promise.resolve([]),
      ]);
      setItems(questions);
      setCourses(courseData);
    } catch (error) { notify(error instanceof Error ? error.message : "Không tải được câu hỏi.", "error"); }
    finally { setLoading(false); }
  }, [canView, canViewCourses, filters, notify, query, session.roleCode]);

  useEffect(() => { const timer = setTimeout(() => void load(), 180); return () => clearTimeout(timer); }, [load]);

  const openCreate = () => { setEditingId(null); setForm(createBlankForm()); setErrors({}); setEditorOpen(true); };
  const openEdit = (item: Question) => {
    setEditingId(item.id); setErrors({});
    setForm({ courseId: item.courseId, type: item.type, content: item.content, options: item.options.length ? [...item.options] : ["", ""], correctAnswers: [...item.correctAnswers], difficulty: item.difficulty, tags: item.tags.join(", ") });
    setEditorOpen(true);
  };
  const saveQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateForm(form); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { notify("Câu hỏi còn nội dung cần kiểm tra. Các lỗi đã được đánh dấu trong biểu mẫu.", "error"); return; }
    setSaving(true);
    try {
      await apiRequest(`/instructor/question-bank/questions${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", roleCode: session.roleCode, body: JSON.stringify(toPayload(form)) });
      notify(editingId ? "Đã tạo phiên bản câu hỏi mới ở trạng thái nháp." : "Đã thêm câu hỏi vào ngân hàng.");
      setEditorOpen(false); setEditingId(null); setForm(createBlankForm()); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Không lưu được câu hỏi.", "error"); }
    finally { setSaving(false); }
  };
  const publish = async (item: Question) => {
    try { await apiRequest(`/instructor/question-bank/questions/${item.id}/publish`, { method: "POST", roleCode: session.roleCode }); notify(`Đã xuất bản câu hỏi phiên bản ${item.version}.`); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Không xuất bản được câu hỏi.", "error"); }
  };
  const importQuestions = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const questions = importText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown);
      const results = await apiRequest<QuestionImportResult[]>("/instructor/question-bank/questions/import", { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ questions }) });
      setImportResults(results); notify(`Đã xử lý ${results.length} dòng; ${results.filter((item) => item.status === "IMPORTED").length} dòng thành công.`); await load();
    } catch (error) { notify(error instanceof Error ? `Dữ liệu nhập không hợp lệ: ${error.message}` : "Không nhập được câu hỏi.", "error"); }
    finally { setSaving(false); }
  };
  const changeType = (type: QuestionType) => {
    setErrors({});
    setForm((current) => {
      const reusableOptions = current.options.filter((option) => !["Đúng", "Sai"].includes(option));
      return { ...current, type, options: type === "TRUE_FALSE" ? ["Đúng", "Sai"] : objectiveTypes.includes(type) ? (reusableOptions.length >= 2 ? reusableOptions : ["", ""]) : [], correctAnswers: [] };
    });
  };
  const updateOption = (index: number, value: string) => {
    setForm((current) => { const previous = current.options[index] ?? ""; return { ...current, options: current.options.map((option, optionIndex) => optionIndex === index ? value : option), correctAnswers: current.correctAnswers.map((answer) => answer === previous ? value : answer) }; });
    setErrors((current) => ({ ...current, options: undefined }));
  };
  const toggleCorrect = (option: string) => {
    if (!option.trim()) return;
    setForm((current) => ({ ...current, correctAnswers: current.type === "MULTIPLE_CHOICE" ? current.correctAnswers.includes(option) ? current.correctAnswers.filter((answer) => answer !== option) : [...current.correctAnswers, option] : [option] }));
    setErrors((current) => ({ ...current, correctAnswers: undefined }));
  };
  const removeOption = (index: number) => setForm((current) => { const removed = current.options[index]; return { ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index), correctAnswers: current.correctAnswers.filter((answer) => answer !== removed) }; });

  if (!canView) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow="Assessment Design" title="Ngân hàng câu hỏi" description="Soạn câu hỏi đa môn, định dạng chữ và công thức, kiểm tra trước khi đưa vào đề." actions={canManage ? <><Button onClick={() => setImportOpen(true)} variant="secondary"><Upload size={17} />Nhập JSONL</Button><Button onClick={openCreate}><Plus size={17} />Soạn câu hỏi</Button></> : undefined} />
      <section className="my-6 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2"><Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} /><input aria-label="Tìm câu hỏi" className={`${inputClass} pl-10`} placeholder="Tìm nội dung hoặc thẻ…" value={query} onChange={(event) => { setQuery(event.target.value); pagination.resetPage(); }} /></div>
          <SearchableSelect aria-label="Tìm và lọc khóa học" onChange={(value) => { setFilters({ ...filters, courseId: value }); pagination.resetPage(); }} options={courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name}`, description: `Phiên bản ${course.version}`, keywords: course.id }))} placeholder="Mọi khóa học" value={filters.courseId} />
          <select aria-label="Lọc dạng câu hỏi" className={inputClass} value={filters.type} onChange={(event) => { setFilters({ ...filters, type: event.target.value }); pagination.resetPage(); }}><option value="">Mọi dạng</option>{Object.entries(typeMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
          <select aria-label="Lọc độ khó" className={inputClass} value={filters.difficulty} onChange={(event) => { setFilters({ ...filters, difficulty: event.target.value }); pagination.resetPage(); }}><option value="">Mọi độ khó</option><option value="1">Dễ</option><option value="2">Trung bình</option><option value="3">Khó</option></select>
          <input aria-label="Lọc chính xác theo thẻ" className={inputClass} placeholder="Lọc chính xác theo thẻ…" value={filters.tag} onChange={(event) => { setFilters({ ...filters, tag: event.target.value }); pagination.resetPage(); }} />
        </div>
      </section>
      <SectionState loading={loading} empty={items.length === 0}><div><div className="flex items-center justify-between border-t border-[var(--rule-strong)] px-1 py-3 text-xs font-bold text-[var(--ink-soft)]"><span>{items.length} câu hỏi phù hợp</span><span>Trang {pagination.page}/{pagination.totalPages}</span></div><div className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">{pagination.pageItems.map((item, index) => <article className="grid gap-4 border-b border-[var(--rule)] p-5 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto]" key={item.id}>
        <div className="grid size-10 place-items-center rounded-xl border border-[var(--rule)] bg-[var(--canvas)] text-sm font-bold text-[var(--ink-soft)]">{index + 1}</div>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={item.status} /><span className="text-xs font-bold text-[var(--ink-soft)]">{typeMeta[item.type].label} · {item.difficulty === 1 ? "Dễ" : item.difficulty === 2 ? "Trung bình" : "Khó"} · Phiên bản {item.version}</span></div><RichText className="mt-2 font-semibold">{item.content}</RichText>
          {item.correctAnswers.length ? <div className="mt-3 flex items-start gap-2 text-xs text-[var(--ink-soft)]"><Check aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--success)]" size={14} /><div><span className="font-bold">{item.type === "ESSAY" ? "Hướng dẫn chấm:" : item.type === "SHORT_ANSWER" ? "Ý trả lời tham khảo:" : "Đáp án:"}</span>{item.correctAnswers.map((answer, answerIndex) => <RichText className="ml-1 inline-block" key={`${answerIndex}-${answer}`}>{answer}</RichText>)}</div></div> : <p className="mt-3 text-xs text-[var(--ink-soft)]">Chấm thủ công</p>}
          <p className="mt-2 text-xs text-[var(--ink-muted)]">{item.tags.length ? item.tags.map((tag) => `#${tag}`).join(" · ") : "Chưa gắn thẻ"}</p></div>
        {canManage ? <div className="flex items-start gap-2"><Button aria-label="Sửa thành phiên bản mới" onClick={() => openEdit(item)} variant="secondary"><Pencil size={15} />Sửa</Button>{item.status === "DRAFT" ? <Button aria-label="Xuất bản câu hỏi" onClick={() => void publish(item)}><CheckCircle2 size={15} />Xuất bản</Button> : <FileQuestion aria-label="Đã xuất bản" className="ml-2 mt-2 text-[var(--success)]" size={24} />}</div> : null}
      </article>)}</div><Pagination itemLabel="câu hỏi" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} /></div></SectionState>

      <Modal description={editingId ? "Bản hiện tại không thay đổi; lần lưu này tạo một phiên bản nháp mới." : "Chọn dạng câu hỏi, nhập nội dung rồi kiểm tra bản xem trước trước khi lưu."} onClose={() => setEditorOpen(false)} open={editorOpen} size="xl" title={editingId ? "Tạo phiên bản câu hỏi" : "Soạn câu hỏi"}>
        <form className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]" onSubmit={(event) => void saveQuestion(event)}>
          <div className="min-w-0 space-y-6">
            <section className="space-y-4"><div><h3 className="font-bold">Phân loại câu hỏi</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Thông tin này quyết định cách học viên trả lời và cách hệ thống chấm.</p></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><Field label="Khóa học"><SearchableSelect aria-label="Tìm và chọn khóa học" onChange={(value) => { setForm({ ...form, courseId: value }); setErrors({ ...errors, courseId: undefined }); }} options={courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name}`, description: `Phiên bản ${course.version}`, keywords: course.id }))} placeholder="Gõ mã hoặc tên khóa học…" value={form.courseId} /></Field>{errors.courseId ? <p className="mt-1 text-xs font-semibold text-[var(--danger)]">{errors.courseId}</p> : null}</div><Field label="Độ khó"><select className={inputClass} value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: Number(event.target.value) as Question["difficulty"] })}><option value={1}>Dễ</option><option value={2}>Trung bình</option><option value={3}>Khó</option></select></Field></div>
              <fieldset><legend className="text-sm font-bold">Dạng câu hỏi</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(typeMeta).map(([value, meta]) => { const selected = form.type === value; return <button aria-pressed={selected} className={`min-h-16 rounded-xl border p-3 text-left transition-colors ${selected ? "border-[var(--action)] bg-[var(--action)] text-[var(--action-ink)]" : "border-[var(--rule-strong)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--accent)]"}`} key={value} onClick={() => changeType(value as QuestionType)} type="button"><span className="block text-sm font-bold">{meta.label}</span><span className={`mt-1 block text-xs leading-5 ${selected ? "text-[var(--rule)]" : "text-[var(--ink-soft)]"}`}>{meta.description}</span></button>; })}</div></fieldset>
            </section>
            <section className="space-y-4 border-t border-[var(--rule)] pt-6"><div><h3 className="font-bold">Nội dung hiển thị</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Dùng thanh công cụ cho chữ đậm, chữ nghiêng và công thức LaTeX.</p></div><FormattedTextarea error={errors.content} label="Nội dung câu hỏi" minLength={5} onChange={(content) => { setForm({ ...form, content }); setErrors({ ...errors, content: undefined }); }} placeholder={"Ví dụ: Tính **giá trị** của $x$ khi $2x + 4 = 10$."} required rows={5} value={form.content} /></section>
            {objectiveTypes.includes(form.type) ? <section className="space-y-4 border-t border-[var(--rule)] pt-6"><div><h3 className="font-bold">Lựa chọn và đáp án đúng</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Mỗi lựa chọn là một mục riêng. Chọn đáp án đúng ngay bên cạnh, không cần gõ lại.</p></div>
              <div className="space-y-3">{form.options.map((option, index) => <div className="grid gap-2 rounded-xl border border-[var(--rule)] bg-[var(--canvas)] p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start" key={index}><button aria-label={`Đánh dấu lựa chọn ${String.fromCharCode(65 + index)} là đáp án đúng`} aria-pressed={form.correctAnswers.includes(option) && Boolean(option.trim())} className={`mt-7 grid size-10 place-items-center rounded-lg border text-xs font-bold ${form.correctAnswers.includes(option) && option.trim() ? "border-[var(--success)] bg-[var(--success-fill)] text-[var(--status-on-fill)]" : "border-[var(--rule-strong)] bg-[var(--surface)] text-[var(--ink-soft)]"}`} disabled={!option.trim()} onClick={() => toggleCorrect(option)} title="Đánh dấu đáp án đúng" type="button">{form.correctAnswers.includes(option) && option.trim() ? <Check size={17} /> : String.fromCharCode(65 + index)}</button><FormattedTextarea compact disabled={form.type === "TRUE_FALSE"} label={`Lựa chọn ${String.fromCharCode(65 + index)}`} onChange={(value) => updateOption(index, value)} rows={2} value={option} />{form.type !== "TRUE_FALSE" && form.options.length > 2 ? <button aria-label={`Xóa lựa chọn ${String.fromCharCode(65 + index)}`} className="mt-7 grid size-10 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" onClick={() => removeOption(index)} type="button"><Trash2 size={16} /></button> : <span />}</div>)}</div>
              {errors.options ? <p className="text-xs font-semibold text-[var(--danger)]">{errors.options}</p> : null}{errors.correctAnswers ? <p className="text-xs font-semibold text-[var(--danger)]">{errors.correctAnswers}</p> : null}{form.type !== "TRUE_FALSE" ? <Button onClick={() => setForm({ ...form, options: [...form.options, ""] })} type="button" variant="secondary"><CirclePlus size={16} />Thêm lựa chọn</Button> : null}
            </section> : null}
            {form.type === "SHORT_ANSWER" ? <section className="space-y-4 border-t border-[var(--rule)] pt-6"><div><h3 className="font-bold">Ý trả lời tham khảo</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Không bắt buộc. Giảng viên vẫn là người chấm câu trả lời ngắn.</p></div>{form.correctAnswers.map((answer, index) => <div className="flex gap-2" key={index}><input aria-label={`Ý trả lời tham khảo ${index + 1}`} className={inputClass} onChange={(event) => setForm({ ...form, correctAnswers: form.correctAnswers.map((item, answerIndex) => answerIndex === index ? event.target.value : item) })} value={answer} /><button aria-label={`Xóa ý trả lời ${index + 1}`} className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" onClick={() => setForm({ ...form, correctAnswers: form.correctAnswers.filter((_, answerIndex) => answerIndex !== index) })} type="button"><Trash2 size={16} /></button></div>)}<Button onClick={() => setForm({ ...form, correctAnswers: [...form.correctAnswers, ""] })} type="button" variant="secondary"><CirclePlus size={16} />Thêm ý tham khảo</Button></section> : null}
            {form.type === "ESSAY" ? <section className="space-y-4 border-t border-[var(--rule)] pt-6"><div><h3 className="font-bold">Hướng dẫn chấm</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Không hiển thị cho học viên trong lúc làm bài. Có thể dùng định dạng và công thức.</p></div><FormattedTextarea label="Đáp án tham khảo hoặc tiêu chí chấm" onChange={(value) => setForm({ ...form, correctAnswers: value.trim() ? [value] : [] })} placeholder="Nêu các ý chính, tiêu chí hoặc công thức cần có trong bài làm…" rows={4} value={form.correctAnswers[0] ?? ""} /></section> : null}
            <section className="space-y-4 border-t border-[var(--rule)] pt-6"><Field label="Thẻ phân loại — phân tách bằng dấu phẩy"><input className={inputClass} placeholder="ngữ pháp, chương-2, ôn-tập" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field><div className="flex flex-wrap items-center gap-3"><Button loading={saving} type="submit">{editingId ? "Lưu phiên bản nháp" : "Lưu câu hỏi"}</Button><p className="text-xs text-[var(--ink-soft)]">Câu hỏi được lưu ở trạng thái nháp và cần xuất bản trước khi dùng trong đề.</p></div></section>
          </div><QuestionPreview form={form} />
        </form>
      </Modal>
      <Modal open={importOpen} onClose={() => { setImportOpen(false); setImportResults([]); }} title="Nhập câu hỏi JSONL" description="Mỗi dòng là một đối tượng JSON. Trường content, options và correctAnswers chấp nhận Markdown + LaTeX."><form className="space-y-4" onSubmit={(event) => void importQuestions(event)}><Field label="Dữ liệu JSONL"><textarea className={`${inputClass} font-mono text-xs`} minLength={2} placeholder={'{"courseId":"course-web","type":"TRUE_FALSE","content":"**Mệnh đề:** $2 + 2 = 4$","options":["Đúng","Sai"],"correctAnswers":["Đúng"],"difficulty":1,"tags":["toán"]}'} required rows={8} value={importText} onChange={(event) => setImportText(event.target.value)} /></Field><Button loading={saving} type="submit"><Upload size={15} />Kiểm tra và nhập</Button></form>{importResults.length ? <div className="mt-5 space-y-2 border-t border-[var(--rule)] pt-4">{importResults.map((result) => <div className={`rounded-lg px-3 py-2 text-sm ${result.status === "IMPORTED" ? "bg-[var(--success-soft)] text-[var(--success-deep)]" : "bg-[var(--danger-soft)] text-[var(--danger-dark)]"}`} key={result.row}>Dòng {result.row}: {result.message}</div>)}</div> : null}</Modal>
    </div>
  );
}
