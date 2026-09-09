"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest, previewApiFile } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type { Guide } from "./material-study-guide";

type Published = { id: string; sourceVersion: number; publishedAt: string; publicationRevision: number; language: "VI" | "EN" | "BILINGUAL" };
type Page = { items: Published[]; nextCursor: string | null };
type Selected = Omit<Published, "language"> & { result: Guide };

/** Đọc bản đã duyệt bằng API học viên; không tải bản nháp riêng hoặc gọi chức năng sinh AI. */
export function LearnerStudyDialog({ material, onClose }: { material: { id: string; name: string }; onClose: () => void }) {
  const { session, notify } = useApp();
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  /** Đọc danh sách hoặc nội dung hiện hành, bỏ phản hồi cũ và cho phép đóng cửa sổ khi mạng chậm. */
  const load = useCallback(async (id?: string, cursor?: string) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    if (id || !cursor) setSelected(null);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const base = `/learner/materials/${encodeURIComponent(material.id)}/study-guides`;
    try {
      if (id) {
        const result = await apiRequest<Selected>(`${base}/${encodeURIComponent(id)}`, { roleCode: session.roleCode, signal: controller.signal });
        if (request.current === controller && !controller.signal.aborted) setSelected(result);
      } else {
        const result = await apiRequest<Page>(`${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { roleCode: session.roleCode, signal: controller.signal });
        if (request.current === controller && !controller.signal.aborted) setPage((previous) => ({ ...result, items: cursor ? [...new Map([...(previous?.items ?? []), ...result.items].map((item) => [item.id, item])).values()] : result.items }));
      }
    } catch (cause) {
      if (request.current === controller) { setSelected(null); setError(controller.signal.aborted ? "Tải bộ ôn tập quá thời gian chờ. Hãy thử tải lại." : cause instanceof Error ? cause.message : "Không tải được bộ ôn tập. Hãy thử lại."); }
    } finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, [material.id, session.roleCode]);

  // Khởi động đồng bộ trạng thái tải của yêu cầu mạng khi mở tài liệu; cleanup hủy đúng yêu cầu đang chạy.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, [load]);
  useEffect(() => { if (selected) { heading.current?.focus(); heading.current?.scrollIntoView?.({ block: "start" }); } }, [selected]);

  /** Xin quyền lại cho đúng phiên bản nguồn trước khi mở file, không dùng URL từ nội dung AI. */
  const openSource = async (source: Guide["summary"][number]["citations"][number]) => {
    try {
      const access = await apiRequest<{ url: string }>(`/materials/${encodeURIComponent(source.materialId)}/versions/${source.version}/access?action=PREVIEW`, { roleCode: session.roleCode });
      await previewApiFile(access.url, session.roleCode, source.name);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Không mở được bản nguồn.", "error"); }
  };

  return <Modal open title="Bộ ôn tập đã phát hành" description={material.name} size="xl" onClose={onClose}>
    <p className="mb-4 max-w-[72ch] text-sm leading-6 text-[var(--ink-soft)]">Nội dung được giảng viên duyệt từ bản AI hỗ trợ. Đọc tóm tắt, tự trả lời thẻ rồi đối chiếu đáp án và nguồn. Mở bộ ôn tập không gọi AI.</p>
    <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>Làm mới bộ ôn tập</Button>{selected ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void load(selected.id)}>Tải lại bản đang xem</Button> : null}</div>
    {busy ? <p role="status" className="mt-4 text-sm">Đang tải bộ ôn tập…</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
    {!busy && page?.items.length === 0 ? <p className="mt-5 text-sm leading-6">Chưa có bộ ôn tập được phép xem trong trang này. Bạn có thể tải tiếp nếu còn trang hoặc quay lại sau khi giảng viên phát hành.</p> : null}
    <ul className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{page?.items.map((item) => <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4">
      <div className="space-y-1 text-sm"><p className="font-semibold"><span>Phiên bản nguồn</span> {item.sourceVersion} · <span>{item.language === "VI" ? "Tiếng Việt" : item.language === "EN" ? "English" : "Song ngữ Việt–Anh"}</span></p><p className="text-[var(--ink-soft)]"><span>Phát hành lúc</span> <time dateTime={item.publishedAt} translate="no">{new Date(item.publishedAt).toLocaleString(activeLocale())}</time></p></div>
      <Button type="button" variant="secondary" disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => void load(item.id)}>Mở bộ ôn tập</Button>
    </li>)}</ul>
    {page?.nextCursor ? <Button className="mt-4" type="button" variant="secondary" disabled={busy} onClick={() => void load(undefined, page.nextCursor!)}>Tải thêm bộ ôn tập</Button> : null}
    {selected ? <section key={`${selected.id}:${selected.publicationRevision}`} className="mt-7" aria-live="polite">
      <h3 ref={heading} tabIndex={-1} className="text-lg font-bold">Tóm tắt và thẻ ôn tập</h3>
      <p className="mt-2 text-sm text-[var(--ink-soft)]"><span>Phiên bản nguồn</span> {selected.sourceVersion} · <span>Lần phát hành</span> {selected.publicationRevision}</p>
      <p className="mt-3 max-w-[72ch] text-sm leading-6">{selected.result.coverage.partial ? "Chỉ bao phủ một phần nội dung đã chọn. Hãy đối chiếu tài liệu gốc để học đầy đủ." : "Đã dùng toàn bộ các đoạn trích xuất trong phạm vi đã chọn; vẫn cần đối chiếu bản gốc."}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{selected.result.warning}</p>
      <h4 className="mb-3 mt-6 font-bold">Ý chính</h4>
      <ul className="space-y-4">{selected.result.summary.map((item, index) => <li key={index}><p className="max-w-[72ch] whitespace-pre-wrap break-words leading-7" translate="no">{item.text}</p><Sources sources={item.citations} openSource={openSource} /></li>)}</ul>
      <h4 className="mb-2 mt-7 font-bold">Thẻ tự ôn tập</h4><p className="mb-3 text-sm text-[var(--ink-soft)]">Tự trả lời trước, sau đó mở thẻ để xem đáp án và nguồn.</p>
      <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{selected.result.flashcards.map((card, index) => <details key={index} className="py-3"><summary className="cursor-pointer break-words py-2 font-semibold" translate="no">{card.front}</summary><p className="my-3 max-w-[72ch] whitespace-pre-wrap break-words leading-7" translate="no">{card.back}</p><Sources sources={card.citations} openSource={openSource} /></details>)}</div>
    </section> : null}
  </Modal>;
}

/** Đặt đoạn trích bên cạnh mục học và mở đúng phiên bản sau khi kiểm tra quyền. */
function Sources({ sources, openSource }: { sources: Guide["summary"][number]["citations"]; openSource: (source: Guide["summary"][number]["citations"][number]) => Promise<void> }) {
  return <details className="mt-2"><summary className="cursor-pointer py-2 text-sm font-semibold">Đối chiếu nguồn</summary>{sources.map((source) => <div key={source.id} className="my-3"><p className="text-sm"><span>Trang</span> {source.page} · <span>Phiên bản</span> {source.version}</p><blockquote className="my-2 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-soft)]" translate="no">{source.text}</blockquote><Button type="button" variant="secondary" onClick={() => void openSource(source)}>Mở bản nguồn</Button></div>)}</details>;
}
