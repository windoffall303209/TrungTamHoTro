"use client";

import {
  CheckCircle2,
  FileQuestion,
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type {
  Course,
  Question,
  QuestionImportResult,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type QuestionForm = {
  courseId: string;
  type: Question["type"];
  content: string;
  options: string;
  correctAnswers: string;
  difficulty: Question["difficulty"];
  tags: string;
};
const blank: QuestionForm = {
  courseId: "",
  type: "SINGLE_CHOICE",
  content: "",
  options: "",
  correctAnswers: "",
  difficulty: 2,
  tags: "",
};
const toPayload = (form: QuestionForm) => ({
  ...form,
  options: form.options
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean),
  correctAnswers: form.correctAnswers
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean),
  tags: form.tags
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});

export default function QuestionsPage() {
  const { session, notify } = useApp();
  const canView = hasPermission(session, "question:view");
  const canManage = hasPermission(session, "question:manage");
  const canViewCourses = hasPermission(session, "course:view");
  const [items, setItems] = useState<Question[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    courseId: "",
    type: "",
    difficulty: "",
    tag: "",
  });
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<QuestionForm>(blank);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResults, setImportResults] = useState<QuestionImportResult[]>(
    [],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    try {
      const [questions, courseData] = await Promise.all([
        apiRequest<Question[]>(
          `/instructor/question-bank/questions?${params.toString()}`,
          { roleCode: session.roleCode },
        ),
        canViewCourses
          ? apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode })
          : Promise.resolve([]),
      ]);
      setItems(questions);
      setCourses(courseData);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được câu hỏi.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, canViewCourses, filters, notify, query, session.roleCode]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(blank);
    setEditorOpen(true);
  };
  const openEdit = (item: Question) => {
    setEditingId(item.id);
    setForm({
      courseId: item.courseId,
      type: item.type,
      content: item.content,
      options: item.options.join("\n"),
      correctAnswers: item.correctAnswers.join("\n"),
      difficulty: item.difficulty,
      tags: item.tags.join(", "),
    });
    setEditorOpen(true);
  };

  const saveQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest(
        `/instructor/question-bank/questions${editingId ? `/${editingId}` : ""}`,
        {
          method: editingId ? "PATCH" : "POST",
          roleCode: session.roleCode,
          body: JSON.stringify(toPayload(form)),
        },
      );
      notify(
        editingId
          ? "Đã tạo phiên bản câu hỏi mới ở trạng thái nháp."
          : "Đã thêm câu hỏi vào ngân hàng.",
      );
      setEditorOpen(false);
      setEditingId(null);
      setForm(blank);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được câu hỏi.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const publish = async (item: Question) => {
    try {
      await apiRequest(
        `/instructor/question-bank/questions/${item.id}/publish`,
        { method: "POST", roleCode: session.roleCode },
      );
      notify(`Đã xuất bản câu hỏi phiên bản ${item.version}.`);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất bản được câu hỏi.",
        "error",
      );
    }
  };

  const importQuestions = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const questions = importText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
      const results = await apiRequest<QuestionImportResult[]>(
        "/instructor/question-bank/questions/import",
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ questions }),
        },
      );
      setImportResults(results);
      notify(
        `Đã xử lý ${results.length} dòng; ${results.filter((item) => item.status === "IMPORTED").length} dòng thành công.`,
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? `Dữ liệu nhập không hợp lệ: ${error.message}`
          : "Không nhập được câu hỏi.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Assessment Design"
        title="Ngân hàng câu hỏi"
        description="Tìm kiếm, phiên bản hóa và kiểm soát câu hỏi trước khi đưa vào đề."
        actions={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setImportOpen(true)} variant="secondary">
              <Upload size={17} />
              Nhập JSONL
            </Button>
            <Button onClick={openCreate}>
              <Plus size={17} />
              Soạn câu hỏi
            </Button>
          </div>
        ) : undefined}
      />
      <section className="mb-6 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <input
              className={`${inputClass} pl-10`}
              placeholder="Tìm nội dung hoặc thẻ…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="Lọc khóa học"
            className={inputClass}
            value={filters.courseId}
            onChange={(event) =>
              setFilters({ ...filters, courseId: event.target.value })
            }
          >
            <option value="">Mọi khóa học</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code}
              </option>
            ))}
          </select>
          <select
            aria-label="Lọc dạng câu hỏi"
            className={inputClass}
            value={filters.type}
            onChange={(event) =>
              setFilters({ ...filters, type: event.target.value })
            }
          >
            <option value="">Mọi dạng</option>
            <option value="SINGLE_CHOICE">Một đáp án</option>
            <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
            <option value="TRUE_FALSE">Đúng / Sai</option>
            <option value="SHORT_ANSWER">Trả lời ngắn</option>
            <option value="ESSAY">Tự luận</option>
          </select>
          <select
            aria-label="Lọc độ khó"
            className={inputClass}
            value={filters.difficulty}
            onChange={(event) =>
              setFilters({ ...filters, difficulty: event.target.value })
            }
          >
            <option value="">Mọi độ khó</option>
            <option value="1">Dễ</option>
            <option value="2">Trung bình</option>
            <option value="3">Khó</option>
          </select>
        </div>
        <div className="mt-3 max-w-sm">
          <input
            className={inputClass}
            placeholder="Lọc chính xác theo thẻ…"
            value={filters.tag}
            onChange={(event) =>
              setFilters({ ...filters, tag: event.target.value })
            }
          />
        </div>
      </section>
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-3">
          {items.map((item, index) => (
            <article
              className="grid gap-4 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-5 md:grid-cols-[auto_1fr_auto]"
              key={item.id}
            >
              <div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-sm font-extrabold text-violet-700">
                {index + 1}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-xs font-bold text-slate-500">
                    {item.type.replaceAll("_", " ")} · Độ khó {item.difficulty}{" "}
                    · Phiên bản {item.version}
                  </span>
                </div>
                <h2 className="mt-2 font-semibold leading-6">{item.content}</h2>
                <p className="mt-2 text-xs text-slate-500">
                  Đáp án: {item.correctAnswers.join(", ") || "Chấm thủ công"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.tags.length
                    ? item.tags.map((tag) => `#${tag}`).join(" · ")
                    : "Chưa gắn thẻ"}
                </p>
              </div>
              {canManage ? <div className="flex items-start gap-2">
                <Button
                  aria-label="Sửa thành phiên bản mới"
                  onClick={() => openEdit(item)}
                  variant="secondary"
                >
                  <Pencil size={15} />
                  Sửa
                </Button>
                {item.status === "DRAFT" ? (
                  <Button
                    aria-label="Xuất bản câu hỏi"
                    onClick={() => void publish(item)}
                  >
                    <CheckCircle2 size={15} />
                    Xuất bản
                  </Button>
                ) : (
                  <FileQuestion
                    className="ml-2 mt-2 text-emerald-500"
                    size={24}
                  />
                )}
              </div> : null}
            </article>
          ))}
        </div>
      </SectionState>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? "Tạo phiên bản câu hỏi" : "Soạn câu hỏi"}
        description={
          editingId
            ? "Bản hiện tại vẫn bất biến; thay đổi này tạo một phiên bản nháp mới."
            : "Câu hỏi mới cần được xuất bản trước khi dùng trong đề."
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void saveQuestion(event)}
        >
          <Field label="Khóa học">
            <select
              className={inputClass}
              required
              value={form.courseId}
              onChange={(event) =>
                setForm({ ...form, courseId: event.target.value })
              }
            >
              <option value="">Chọn khóa học</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dạng câu hỏi">
              <select
                className={inputClass}
                value={form.type}
                onChange={(event) => {
                  const type = event.target.value as Question["type"];
                  setForm({
                    ...form,
                    type,
                    ...(type === "TRUE_FALSE"
                      ? { options: "Đúng\nSai", correctAnswers: "Đúng" }
                      : {}),
                  });
                }}
              >
                <option value="SINGLE_CHOICE">Một đáp án</option>
                <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
                <option value="TRUE_FALSE">Đúng / Sai</option>
                <option value="SHORT_ANSWER">Trả lời ngắn</option>
                <option value="ESSAY">Tự luận</option>
              </select>
            </Field>
            <Field label="Độ khó">
              <select
                className={inputClass}
                value={form.difficulty}
                onChange={(event) =>
                  setForm({
                    ...form,
                    difficulty: Number(
                      event.target.value,
                    ) as Question["difficulty"],
                  })
                }
              >
                <option value={1}>1 — Dễ</option>
                <option value={2}>2 — Trung bình</option>
                <option value={3}>3 — Khó</option>
              </select>
            </Field>
          </div>
          <Field label="Nội dung">
            <textarea
              className={inputClass}
              minLength={5}
              required
              rows={3}
              value={form.content}
              onChange={(event) =>
                setForm({ ...form, content: event.target.value })
              }
            />
          </Field>
          <Field label="Các lựa chọn — mỗi dòng một lựa chọn">
            <textarea
              className={inputClass}
              disabled={form.type === "TRUE_FALSE"}
              rows={3}
              value={form.options}
              onChange={(event) =>
                setForm({ ...form, options: event.target.value })
              }
            />
          </Field>
          <Field label="Đáp án đúng — mỗi dòng một đáp án">
            <textarea
              className={inputClass}
              rows={2}
              value={form.correctAnswers}
              onChange={(event) =>
                setForm({ ...form, correctAnswers: event.target.value })
              }
            />
          </Field>
          <Field label="Thẻ — phân tách bằng dấu phẩy">
            <input
              className={inputClass}
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
            />
          </Field>
          <Button loading={saving} type="submit">
            {editingId ? "Lưu phiên bản nháp" : "Lưu câu hỏi"}
          </Button>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportResults([]);
        }}
        title="Nhập câu hỏi JSONL"
        description="Mỗi dòng là một đối tượng JSON. Hệ thống kiểm tra độc lập và báo lỗi đúng dòng."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void importQuestions(event)}
        >
          <Field label="Dữ liệu JSONL">
            <textarea
              className={`${inputClass} font-mono text-xs`}
              minLength={2}
              required
              rows={8}
              placeholder={
                '{"courseId":"course-web","type":"TRUE_FALSE","content":"...","options":["Đúng","Sai"],"correctAnswers":["Đúng"],"difficulty":1,"tags":["web"]}'
              }
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
          </Field>
          <Button loading={saving} type="submit">
            <Upload size={15} />
            Kiểm tra và nhập
          </Button>
        </form>
        {importResults.length ? (
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            {importResults.map((result) => (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${result.status === "IMPORTED" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
                key={result.row}
              >
                Dòng {result.row}: {result.message}
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
