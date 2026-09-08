"use client";

import { useRef, useState } from "react";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest, previewApiFile } from "@/lib/api-client";
import type { Material } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { MaterialStudyGuide } from "@/components/material-study-guide";

type Answer = {
  answer: string;
  insufficientContext: boolean;
  version: number;
  warning: string;
  citations: Array<{ id: string; materialId: string; version: number; name: string; page: number; text: string }>;
};

/** Giữ câu hỏi và nguồn trong cùng vùng đọc; chỉ gọi AI sau khi người dùng chủ động gửi. */
export function MaterialAiDialog({ material, onClose }: { material: Material; onClose: () => void }) {
  const { session, notify } = useApp();
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"VI" | "EN" | "BILINGUAL">(activeLocale() === "en-US" ? "EN" : "VI");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"QA" | "STUDY">("QA");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ question: string; answer: Answer } | null>(null);
  const inFlight = useRef(false);

  /** Khóa gửi lặp tức thời và giữ câu hỏi khi API lỗi; không tự động retry yêu cầu trả phí. */
  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const text = question.trim();
    if (text.length < 2 || text.length > 2000) { setError("Câu hỏi cần từ 2 đến 2.000 ký tự."); return; }
    inFlight.current = true;
    setBusy(true); setError(""); setResult(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const answer = await apiRequest<Answer>(`/instructor/materials/${encodeURIComponent(material.id)}/ai-question`, { method: "POST", roleCode: session.roleCode, signal: controller.signal, body: JSON.stringify({ question: text, language }) });
      setResult({ question: text, answer });
    } catch (cause) { setError(controller.signal.aborted ? "Đã hết thời gian chờ. Bạn có thể đóng cửa sổ. Máy chủ có thể vẫn đang xử lý; gửi lại có thể phát sinh phí mới." : cause instanceof Error ? cause.message : "Không lấy được câu trả lời. Hãy kiểm tra cấu hình AI và thử lại."); }
    finally { window.clearTimeout(timeout); inFlight.current = false; setBusy(false); }
  };

  /** Xin quyền xem lại đúng phiên bản nguồn; không mở URL do model tự sinh. */
  const openSource = async (source: Answer["citations"][number]) => {
    try {
      const access = await apiRequest<{ url: string }>(`/materials/${encodeURIComponent(source.materialId)}/versions/${source.version}/access?action=PREVIEW`, { roleCode: session.roleCode });
      await previewApiFile(access.url, session.roleCode, source.name);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Không mở được bản nguồn.", "error"); }
  };

  return <Modal open title="Hỏi đáp tài liệu" description={material.name} size="xl" onClose={() => { if (!inFlight.current) onClose(); }}>
    <div role="group" aria-label="Công cụ AI tài liệu" className="mb-5 flex flex-wrap gap-2"><Button disabled={busy} aria-pressed={mode === "QA"} variant={mode === "QA" ? "primary" : "secondary"} onClick={() => setMode("QA")}>Hỏi đáp</Button><Button disabled={busy} aria-pressed={mode === "STUDY"} variant={mode === "STUDY" ? "primary" : "secondary"} onClick={() => setMode("STUDY")}>Bộ ôn tập</Button></div>
    <div hidden={mode !== "STUDY"}><MaterialStudyGuide materialId={material.id} openSource={openSource} onBusyChange={(value) => { inFlight.current = value; setBusy(value); }} /></div>
    <div hidden={mode !== "QA"}>
    <p className="mb-5 text-sm leading-6 text-[var(--ink-soft)]">AI chỉ trả lời từ tài liệu này, không tìm trên internet. Việc gửi câu hỏi có thể phát sinh phí trích xuất và trả lời theo cấu hình của quản trị viên.</p>
    <form onSubmit={(event) => void ask(event)} className="space-y-4">
      <Field label="Câu hỏi về tài liệu"><textarea className={inputClass} rows={3} required minLength={2} maxLength={2000} disabled={busy} value={question} onChange={(event) => setQuestion(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "material-ai-error" : undefined} /></Field>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Field label="Ngôn ngữ trả lời"><select className={inputClass} disabled={busy} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="VI">Tiếng Việt</option><option value="EN">English</option><option value="BILINGUAL">Song ngữ Việt–Anh</option></select></Field>
        <Button type="submit" loading={busy} disabled={busy || question.trim().length < 2}>{busy ? "Đang đọc và trả lời…" : "Gửi câu hỏi"}</Button>
      </div>
      {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Lần đầu có thể lâu hơn vì cần trích xuất tài liệu. Vui lòng giữ cửa sổ này mở.</p> : null}
      {error ? <p role="alert" id="material-ai-error" className="text-sm text-[var(--danger)]">{error}</p> : null}
    </form>
    {result ? <section className="mt-7 border-t border-[var(--rule)] pt-5" aria-live="polite">
      <h3 className="font-bold">{result.answer.insufficientContext ? "Chưa đủ ngữ cảnh" : "Câu trả lời từ tài liệu"}</h3>
      <p className="mt-2 break-words text-sm text-[var(--ink-soft)]" translate="no">{result.question}</p>
      <p className="mt-4 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-7" translate="no">{result.answer.answer}</p>
      <p className="mt-4 text-sm text-[var(--ink-soft)]">{result.answer.warning}</p>
      {result.answer.citations.length ? <div className="mt-6"><h4 className="font-semibold">Đoạn nguồn để đối chiếu</h4><div className="mt-2 divide-y divide-[var(--rule)]">
        {result.answer.citations.map((source, index) => <details key={source.id} className="py-3" open={index === 0}>
          <summary className="cursor-pointer break-words py-2 text-sm font-semibold"><span translate="no">{source.name}</span> · <span>Trang</span> {source.page} · <span>Phiên bản</span> {source.version}</summary>
          <blockquote className="my-3 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-soft)]" translate="no">{source.text}</blockquote>
          <Button type="button" variant="secondary" onClick={() => void openSource(source)}>Mở bản nguồn</Button>
        </details>)}
      </div></div> : null}
    </section> : null}
    </div>
  </Modal>;
}
