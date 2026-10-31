"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  CheckCheck,
  LifeBuoy,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionState } from "@/shared/ui/section-state";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  usePagination,
} from "@/shared/ui/ui";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import type {
  LearningNotification,
  Ticket,
  TicketComment,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

/** Quản lý phiếu hỗ trợ và hội thoại giữa người gửi với bộ phận xử lý. */
export default function SupportPage() {
  const { session, notify } = useApp();
  const admin = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode);
  const [items, setItems] = useState<Ticket[]>([]);
  const pagination = usePagination(items);
  const [alerts, setAlerts] = useState<LearningNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<Ticket | null>(null);
  const [resolution, setResolution] = useState("");
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [clientRequestId, setClientRequestId] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const loadRequestId = useRef(0);
  const conversationRequestId = useRef(0);
  const [uploadRetry, setUploadRetry] = useState<{
    ticketId: string;
    file: File;
  } | null>(null);
  const [form, setForm] = useState({
    category: "TECHNICAL",
    severity: "P2",
    contextId: "",
    description: "",
  });
  /** Mở biểu mẫu bằng khóa idempotency mới và giữ khóa đó cho mọi lần retry của cùng yêu cầu. */
  const beginCreate = () => {
    setClientRequestId(crypto.randomUUID());
    setOpen(true);
  };
  /** Nạp danh sách phiếu theo vai trò và cập nhật hội thoại đang mở nếu cần. */
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    try {
      const [tickets, notifications] = await Promise.all([
        apiRequest<Ticket[]>("/support/tickets", {
          roleCode: session.roleCode,
        }),
        admin
          ? apiRequest<LearningNotification[]>("/notifications", {
              roleCode: session.roleCode,
            })
          : Promise.resolve([]),
      ]);
      if (requestId !== loadRequestId.current) return;
      setItems(tickets);
      setAlerts(notifications.filter((item) => item.type === "SUPPORT_P0"));
    } catch (error) {
      if (requestId === loadRequestId.current) notify(
        error instanceof Error ? error.message : "Không tải được yêu cầu.", "error",
      );
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [admin, notify, session.roleCode]);
  useEffect(() => {
    const loadSequence = loadRequestId;
    const conversationSequence = conversationRequestId;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadSequence.current++;
      conversationSequence.current++;
    };
  }, [load]);
  /** Mở đúng phiếu từ thông báo sau khi kiểm tra phạm vi trả về của API. */
  useEffect(() => {
    if (loading) return;
    const ticketId = new URLSearchParams(window.location.search).get(
      "ticketId",
    );
    if (!ticketId) return;
    const ticket = items.find((item) => item.id === ticketId);
    if (ticket)
      document
        .getElementById(`ticket-${ticketId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    else
      notify(
        "Phiếu hỗ trợ không còn khả dụng hoặc bạn không có quyền xem.",
        "error",
      );
  }, [items, loading, notify]);
  /** Tạo phiếu hỗ trợ mới với loại, mức ưu tiên và nội dung người dùng nhập. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const ticket = await apiRequest<Ticket>("/support/tickets", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          ...form,
          clientRequestId: clientRequestId || crypto.randomUUID(),
        }),
      });
      if (evidence) {
        const body = new FormData();
        body.append("file", evidence);
        try {
          await apiRequest(`/support/tickets/${ticket.id}/attachments`, {
            method: "POST",
            roleCode: session.roleCode,
            body,
          });
        } catch {
          setUploadRetry({ ticketId: ticket.id, file: evidence });
          notify(
            `Phiếu ${ticket.id} đã được tạo nhưng tệp bằng chứng chưa tải lên. Có thể thử lại mà không tạo phiếu mới.`,
            "error",
          );
          setOpen(false);
          setForm({
            category: "TECHNICAL",
            severity: "P2",
            contextId: "",
            description: "",
          });
          setEvidence(null);
          setClientRequestId("");
          await load();
          return;
        }
      }
      notify("Đã gửi yêu cầu hỗ trợ.");
      setOpen(false);
      setForm({
        category: "TECHNICAL",
        severity: "P2",
        contextId: "",
        description: "",
      });
      setEvidence(null);
      setClientRequestId("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được yêu cầu.",
        "error",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };
  /** Thử tải lại đúng tệp vào phiếu đã tạo, không gửi lại lệnh tạo phiếu. */
  const retryEvidenceUpload = async () => {
    if (!uploadRetry) return;
    try {
      const body = new FormData();
      body.append("file", uploadRetry.file);
      await apiRequest(`/support/tickets/${uploadRetry.ticketId}/attachments`, {
        method: "POST",
        roleCode: session.roleCode,
        body,
      });
      notify("Đã bổ sung tệp bằng chứng vào phiếu hiện có.");
      setUploadRetry(null);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Chưa thể tải lại bằng chứng.",
        "error",
      );
    }
  };
  /** Mở hoặc tải bằng chứng hỗ trợ qua endpoint có kiểm tra quyền. */
  const openEvidence = async (
    ticketId: string,
    attachment: Ticket["attachments"][number],
    download = false,
  ) => {
    const path = `/support/tickets/${ticketId}/attachments/${attachment.id}`;
    try {
      if (download) await downloadApiFile(path, session.roleCode);
      else await previewApiFile(path, session.roleCode, attachment.name);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được bằng chứng.",
        "error",
      );
    }
  };
  /** Nhận xử lý phiếu bằng tài khoản hiện tại và khóa phiên bản để tránh nhận trùng. */
  const claim = async (item: Ticket) => {
    try {
      await apiRequest(`/admin/support/tickets/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          status: "IN_PROGRESS",
          assigneeId: session.user.id,
          expectedUpdatedAt: item.updatedAt,
        }),
      });
      notify("Đã nhận xử lý phiếu.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không cập nhật được.",
        "error",
      );
    }
  };
  /** Hoàn tất phiếu đang phụ trách với kết luận cụ thể cho người gửi. */
  const resolve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resolutionTarget) return;
    try {
      await apiRequest(`/admin/support/tickets/${resolutionTarget.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          status: "RESOLVED",
          assigneeId: resolutionTarget.assigneeId ?? session.user.id,
          resolution,
          expectedUpdatedAt: resolutionTarget.updatedAt,
        }),
      });
      setResolutionTarget(null);
      setResolution("");
      notify("Đã gửi kết quả xử lý cho người dùng.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không hoàn tất được phiếu.",
        "error",
      );
    }
  };
  /** Cho phép người gửi đóng phiếu sau khi xác nhận kết quả xử lý. */
  const closeResolved = async (item: Ticket) => {
    try {
      await apiRequest(`/support/tickets/${item.id}/close`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xác nhận kết quả và đóng yêu cầu.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không đóng được yêu cầu.",
        "error",
      );
    }
  };
  /** Chọn phiếu và nạp lịch sử trao đổi đầy đủ của phiếu đó. */
  const openConversation = async (item: Ticket) => {
    const requestId = ++conversationRequestId.current;
    if (selected?.id !== item.id) setComments([]);
    setSelected(item);
    try {
      const rows = await apiRequest<TicketComment[]>(
        `/support/tickets/${item.id}/comments`,
        { roleCode: session.roleCode },
      );
      if (requestId === conversationRequestId.current) setComments(rows);
    } catch (error) {
      if (requestId === conversationRequestId.current) notify(
        error instanceof Error ? error.message : "Không tải được trao đổi.", "error",
      );
    }
  };
  /** Thêm phản hồi vào phiếu đang mở rồi làm mới hội thoại và danh sách. */
  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try {
      await apiRequest(`/support/tickets/${selected.id}/comments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ body: commentBody }),
      });
      setCommentBody("");
      await openConversation(selected);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được trao đổi.",
        "error",
      );
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <PageHeader
        title="Trung tâm hỗ trợ"
        description="Tiếp nhận, phân loại mức độ và theo dõi yêu cầu đến khi có kết quả."
        actions={
          !admin ? (
            <Button onClick={beginCreate}>
              <Plus size={17} />
              Gửi yêu cầu
            </Button>
          ) : undefined
        }
      />
      {admin && alerts.some((item) => !item.readAt) ? (
        <div className="mb-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {alerts.filter((item) => !item.readAt).length} cảnh báo P0 chưa đọc ·{" "}
          {alerts.find((item) => !item.readAt)?.title}
        </div>
      ) : null}
      {uploadRetry ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <strong>Phiếu đã được tạo.</strong> Tệp {uploadRetry.file.name} chưa
            tải lên thành công.
          </p>
          <Button
            onClick={() => void retryEvidenceUpload()}
            variant="secondary"
          >
            Thử tải lại
          </Button>
        </div>
      ) : null}
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-3">
          {pagination.pageItems.map((item) => (
            <article
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center"
              id={`ticket-${item.id}`}
              key={item.id}
            >
              <div
                className={`grid size-11 place-items-center rounded-xl border ${item.severity === "P0" || item.severity === "P1" ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200/80 dark:border-rose-900/50 text-rose-600 dark:text-rose-400" : "bg-sky-50 dark:bg-sky-950/40 border-sky-100 dark:border-sky-900/50 text-sky-600 dark:text-sky-400"}`}
              >
                <LifeBuoy size={21} />
              </div>
              <div>
                <div className="flex flex-wrap gap-2">
                  <p className="text-xs font-extrabold text-sky-700">
                    {item.category} · {item.severity}
                  </p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 text-sm font-semibold leading-6">
                  {item.description}
                </p>
                {item.contextId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Ngữ cảnh: {item.contextId}
                  </p>
                ) : null}
                {item.duplicateOfId ? (
                  <p className="mt-1 text-xs font-bold text-amber-700">
                    Liên kết sự cố trùng: {item.duplicateOfId}
                  </p>
                ) : null}
                {item.attachments.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.attachments.map((attachment) => (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"
                        key={attachment.id}
                      >
                        <Paperclip size={12} />
                        <button
                          className="underline-offset-2 hover:underline"
                          onClick={() => void openEvidence(item.id, attachment)}
                          type="button"
                        >
                          {attachment.name}
                        </button>
                        <span>
                          · {(attachment.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                        <button
                          aria-label={`Tải ${attachment.name}`}
                          className="underline-offset-2 hover:underline"
                          onClick={() =>
                            void openEvidence(item.id, attachment, true)
                          }
                          type="button"
                        >
                          Tải
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.resolution ? (
                  <p className="mt-2 text-xs text-emerald-700">
                    Kết quả: {item.resolution}
                  </p>
                ) : null}
                <p
                  className={`mt-2 text-xs font-bold ${new Date(item.dueAt) < new Date() && !["RESOLVED", "CLOSED"].includes(item.status) ? "text-rose-700" : "text-slate-400"}`}
                >
                  SLA: {new Date(item.dueAt).toLocaleString(activeLocale())}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void openConversation(item)}
                  variant="ghost"
                >
                  <MessageSquare size={15} />
                  Trao đổi
                </Button>
                {admin && item.status === "OPEN" ? (
                  <Button onClick={() => void claim(item)} variant="secondary">
                    <CheckCheck size={16} />
                    Nhận xử lý
                  </Button>
                ) : admin && item.status === "IN_PROGRESS" ? (
                  <Button
                    onClick={() => {
                      setResolutionTarget(item);
                      setResolution("");
                    }}
                    variant="secondary"
                  >
                    <CheckCheck size={16} />
                    Hoàn tất
                  </Button>
                ) : null}
                {!admin && item.status === "RESOLVED" ? (
                  <Button
                    onClick={() => void closeResolved(item)}
                    variant="secondary"
                  >
                    <CheckCheck size={16} />
                    Xác nhận đóng
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionState>
      <Pagination
        itemLabel="yêu cầu hỗ trợ"
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
      />
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setClientRequestId("");
        }}
        title="Gửi yêu cầu hỗ trợ"
      >
        <form className="space-y-4" onSubmit={(e) => void create(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nhóm vấn đề">
              <select
                className={inputClass}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="TECHNICAL">Kỹ thuật</option>
                <option value="ACCOUNT">Tài khoản</option>
                <option value="CONTENT">Học liệu</option>
                <option value="ASSESSMENT">Thi cử</option>
              </select>
            </Field>
            <Field label="Mức độ">
              <select
                className={inputClass}
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                <option value="P3">P3 — Thấp</option>
                <option value="P2">P2 — Bình thường</option>
                <option value="P1">P1 — Cao</option>
                <option value="P0">P0 — Khẩn cấp</option>
              </select>
            </Field>
          </div>
          <Field label="Mã lớp / chức năng liên quan">
            <input
              className={inputClass}
              maxLength={191}
              placeholder="Ví dụ: class-web-01 hoặc exam-mid-web"
              value={form.contextId}
              onChange={(event) =>
                setForm({ ...form, contextId: event.target.value })
              }
            />
          </Field>
          <Field label="Mô tả chi tiết">
            <textarea
              className={inputClass}
              minLength={10}
              required
              rows={5}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <Field label="Bằng chứng (PDF, PNG, JPEG hoặc TXT; tối đa 10 MB)">
            <input
              accept="application/pdf,image/png,image/jpeg,text/plain"
              className={inputClass}
              onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
              type="file"
            />
          </Field>
          <Button loading={creating} type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
      <Modal
        open={Boolean(selected)}
        onClose={() => { conversationRequestId.current++; setSelected(null); setComments([]); }}
        title="Trao đổi yêu cầu hỗ trợ"
        description={
          selected
            ? `${selected.category} · ${selected.severity} · SLA ${new Date(selected.dueAt).toLocaleString(activeLocale())}`
            : undefined
        }
      >
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {comments.length ? (
            comments.map((comment) => (
              <div
                className={`rounded-xl p-3 text-sm ${comment.authorId === "usr-learner" ? "bg-[var(--surface-muted)]" : "bg-[var(--accent-soft)]"}`}
                key={comment.id}
              >
                <p>{comment.body}</p>
                <p className="mt-1 text-[10px] font-bold text-[var(--ink-muted)]">
                  {comment.authorId} ·{" "}
                  {new Date(comment.createdAt).toLocaleString(activeLocale())}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">Chưa có trao đổi.</p>
          )}
        </div>
        {selected?.status !== "CLOSED" ? (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => void addComment(event)}
          >
            <input
              className={inputClass}
              minLength={2}
              required
              placeholder="Nhập nội dung phản hồi…"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <Button aria-label="Gửi trao đổi" type="submit">
              <Send size={16} />
            </Button>
          </form>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(resolutionTarget)}
        onClose={() => setResolutionTarget(null)}
        title="Hoàn tất phiếu hỗ trợ"
        description="Kết luận sẽ được gửi tới người báo và chỉ họ mới có thể xác nhận đóng phiếu."
      >
        <form className="space-y-4" onSubmit={(event) => void resolve(event)}>
          <Field label="Kết quả xử lý">
            <textarea
              className={inputClass}
              minLength={5}
              onChange={(event) => setResolution(event.target.value)}
              required
              rows={5}
              value={resolution}
            />
          </Field>
          <Button type="submit">
            <CheckCheck size={16} />
            Gửi kết quả
          </Button>
        </form>
      </Modal>
    </div>
  );
}
