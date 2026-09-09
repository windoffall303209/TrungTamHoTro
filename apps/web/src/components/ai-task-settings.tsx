"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { SearchableSelect } from "@/components/searchable-select";

type Task = "SCAN_IMAGE" | "GENERATE_EXAM" | "DOCUMENT_CONTEXT" | "DOCUMENT_QA" | "GRADING_ASSIST";
type Selection = { providerId: string; model: string; contextProviderId?: string };
type Provider = { id: string; name: string; provider: string; enabled: boolean; hasApiKey: boolean; model: string };
type Model = { value: string; label: string; description: string };

/** Hiển thị các phân công AI độc lập do quản trị viên quản lý. */
export function AiTaskSettings({ providers, catalog }: { providers: Provider[]; catalog: Record<string, Model[]> }) {
  const { session, notify } = useApp();
  const [saved, setSaved] = useState<Partial<Record<Task, Selection>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void apiRequest<Partial<Record<Task, Selection>>>("/system/ai-tasks", { roleCode: session.roleCode }).then((value) => { if (!cancelled) setSaved(value); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Không tải được cấu hình AI."); });
    return () => { cancelled = true; };
  }, [session.roleCode]);
  return <div className="border-t border-[var(--rule)] px-5 py-5 md:px-6"><h3 className="font-bold">AI theo chức năng</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">Áp dụng cho toàn hệ thống. Giảng viên không chọn hoặc thay đổi model.</p>{error ? <p role="alert">{error}</p> : !saved ? <p role="status">Đang tải cấu hình…</p> : (["SCAN_IMAGE", "GENERATE_EXAM", "DOCUMENT_CONTEXT", "DOCUMENT_QA", "GRADING_ASSIST"] as const).map((task) => <TaskEditor key={task} task={task} initial={saved[task]} providers={providers} catalog={catalog} roleCode={session.roleCode} notify={notify} />)}</div>;
}

/** Chỉnh và lưu một tác vụ, xóa lựa chọn model khi đổi provider. */
function TaskEditor({ task, initial, providers, catalog, roleCode, notify }: { task: Task; initial?: Selection; providers: Provider[]; catalog: Record<string, Model[]>; roleCode: NonNullable<Parameters<typeof apiRequest>[1]>["roleCode"]; notify: ReturnType<typeof useApp>["notify"] }) {
  const [value, setValue] = useState<Selection>(initial ?? { providerId: "", model: "" });
  const [saving, setSaving] = useState(false);
  const provider = providers.find((item) => item.id === value.providerId);
  const label = task === "SCAN_IMAGE" ? "Quét ảnh câu hỏi" : task === "DOCUMENT_CONTEXT" ? "Trích xuất tài liệu" : task === "DOCUMENT_QA" ? "Hỏi đáp tài liệu" : task === "GRADING_ASSIST" ? "Gợi ý chấm bài" : "Sinh đề thi";
  /** Lưu cấu hình và giữ nguyên form khi máy chủ từ chối. */
  const save = async () => {
    setSaving(true);
    try { await apiRequest("/system/ai-tasks", { method: "POST", roleCode, body: JSON.stringify({ task, ...value }) }); notify("Đã lưu cấu hình AI cho tác vụ."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không lưu được cấu hình AI.", "error"); }
    finally { setSaving(false); }
  };
  return <fieldset disabled={saving} className="mt-5 grid min-w-0 gap-3 border-t border-[var(--rule)] pt-4 sm:grid-cols-2"><legend className="font-semibold">{label}</legend>{task === "GRADING_ASSIST" ? <p className="text-sm text-[var(--ink-soft)] sm:col-span-2">AI đề xuất điểm và phản hồi theo rubric từ văn bản, TXT, PDF và ảnh. PDF/ảnh được model Trích xuất tài liệu đọc trước; giảng viên phải kiểm tra bản OCR và gợi ý trước khi lưu điểm. Word chưa được hỗ trợ.</p> : null}<label className="min-w-0 text-sm">Nhà cung cấp<SearchableSelect aria-label={`Nhà cung cấp ${label}`} value={value.providerId} onChange={(providerId) => setValue({ providerId, model: "" })} options={providers.filter((item) => item.enabled && item.hasApiKey && (task === "DOCUMENT_CONTEXT" ? item.provider === "GEMINI" : task === "SCAN_IMAGE" || task === "DOCUMENT_QA" || task === "GRADING_ASSIST" || ["GEMINI", "OPENAI", "CUSTOM"].includes(item.provider))).map((item) => ({ value: item.id, label: item.name }))} placeholder="Chọn nhà cung cấp đang bật" /></label><label className="min-w-0 text-sm">Model{provider?.provider === "CUSTOM" ? <input className="mt-1 w-full rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3" aria-label={`Model ${label}`} maxLength={200} value={value.model} onChange={(event) => setValue({ ...value, model: event.target.value })} placeholder={task === "SCAN_IMAGE" ? "Nhập model hỗ trợ ảnh" : "Nhập tên model Custom"} /> : <SearchableSelect aria-label={`Model ${label}`} disabled={!provider} value={value.model} onChange={(model) => setValue({ ...value, model })} options={catalog[provider?.provider ?? ""] ?? []} placeholder="Chọn model" />}</label>{task === "GENERATE_EXAM" && provider?.provider === "CUSTOM" ? <div className="sm:col-span-2"><label className="text-sm">Gemini hỗ trợ ngữ cảnh<SearchableSelect aria-label="Gemini hỗ trợ ngữ cảnh" value={value.contextProviderId ?? ""} onChange={(contextProviderId) => setValue({ ...value, contextProviderId })} options={providers.filter((item) => item.provider === "GEMINI" && item.enabled && item.hasApiKey).map((item) => ({ value: item.id, label: item.name, description: item.model }))} placeholder="Chọn Gemini để đọc tài liệu và tìm web" /></label><p className="mt-2 text-sm text-[var(--ink-soft)]">Gemini lấy ngữ cảnh; Custom sinh câu hỏi từ văn bản. Cả hai provider đều có thể phát sinh phí. Tài liệu hỗ trợ PDF và ảnh.</p></div> : null}<button type="button" disabled={saving || !value.providerId || !value.model.trim()} onClick={() => void save()} className="min-h-11 justify-self-start rounded-xl bg-[var(--ink)] px-4 py-2 text-[var(--surface)] disabled:opacity-50">{saving ? "Đang lưu…" : `Lưu ${label.toLowerCase()}`}</button></fieldset>;
}
