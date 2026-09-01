"use client";

import { CheckCheck, LifeBuoy, MessageSquare, Paperclip, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LearningNotification, Ticket, TicketComment } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function SupportPage() {
  const { session, notify } = useApp();
  const admin = session.roleCode === "SYSTEM_ADMIN";
  const [items, setItems] = useState<Ticket[]>([]);
  const pagination = usePagination(items);
  const [alerts, setAlerts] = useState<LearningNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [form, setForm] = useState({
    category: "TECHNICAL",
    severity: "P2",
    contextId: "",
    description: "",
  });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tickets, notifications] = await Promise.all([
        apiRequest<Ticket[]>("/support/tickets", {
          roleCode: session.roleCode,
        }),
        admin ? apiRequest<LearningNotification[]>("/notifications", { roleCode: session.roleCode }) : Promise.resolve([]),
      ]);
      setItems(tickets);
      setAlerts(notifications.filter((item) => item.type === "SUPPORT_P0"));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được yêu cầu.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [admin, notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const ticket = await apiRequest<Ticket>("/support/tickets", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(form),
      });
      if (evidence) {
        const body = new FormData();
        body.append("file", evidence);
        await apiRequest(`/support/tickets/${ticket.id}/attachments`, {
          method: "POST",
          roleCode: session.roleCode,
          body,
        });
      }
      notify("Đã gửi yêu cầu hỗ trợ.");
      setOpen(false);
      setForm({ category: "TECHNICAL", severity: "P2", contextId: "", description: "" });
      setEvidence(null);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được yêu cầu.",
        "error",
      );
    }
  };
  const resolve = async (item: Ticket) => {
    try {
      await apiRequest(`/admin/support/tickets/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          status: "RESOLVED",
          assigneeId: "usr-admin",
          resolution:
            "Đã kiểm tra, xử lý và xác nhận dịch vụ hoạt động bình thường.",
        }),
      });
      notify("Đã hoàn tất yêu cầu.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không cập nhật được.",
        "error",
      );
    }
  };
  const closeResolved = async (item: Ticket) => {
    try {
      await apiRequest(`/support/tickets/${item.id}/close`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xác nhận kết quả và đóng yêu cầu.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không đóng được yêu cầu.", "error");
    }
  };
  const openConversation = async (item: Ticket) => {
    try {
      setSelected(item);
      setComments(await apiRequest<TicketComment[]>(`/support/tickets/${item.id}/comments`, { roleCode: session.roleCode }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được trao đổi.", "error");
    }
  };
  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try {
      await apiRequest(`/support/tickets/${selected.id}/comments`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ body: commentBody }) });
      setCommentBody("");
      await openConversation(selected);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được trao đổi.", "error");
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Service Desk"
        title="Trung tâm hỗ trợ"
        description="Tiếp nhận, phân loại mức độ và theo dõi yêu cầu đến khi có kết quả."
        actions={
          !admin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={17} />
              Gửi yêu cầu
            </Button>
          ) : undefined
        }
      />
      {admin && alerts.some((item) => !item.readAt) ? (
        <div className="mb-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {alerts.filter((item) => !item.readAt).length} cảnh báo P0 chưa đọc · {alerts.find((item) => !item.readAt)?.title}
        </div>
      ) : null}
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-3">
          {pagination.pageItems.map((item) => (
            <article
              className="grid gap-4 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-5 md:grid-cols-[auto_1fr_auto] md:items-center"
              key={item.id}
            >
              <div
                className={`grid size-11 place-items-center rounded-xl ${item.severity === "P0" || item.severity === "P1" ? "bg-rose-100 text-rose-700" : "bg-sky-50 text-sky-700"}`}
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
                {item.contextId ? <p className="mt-1 text-xs text-slate-500">Ngữ cảnh: {item.contextId}</p> : null}
                {item.duplicateOfId ? <p className="mt-1 text-xs font-bold text-amber-700">Liên kết sự cố trùng: {item.duplicateOfId}</p> : null}
                {item.attachments.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.attachments.map((attachment) => (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600" key={attachment.id}>
                        <Paperclip size={12} />{attachment.name} · {(attachment.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.resolution ? (
                  <p className="mt-2 text-xs text-emerald-700">
                    Kết quả: {item.resolution}
                  </p>
                ) : null}
                <p className={`mt-2 text-xs font-bold ${new Date(item.dueAt) < new Date() && !["RESOLVED", "CLOSED"].includes(item.status) ? "text-rose-700" : "text-slate-400"}`}>SLA: {new Date(item.dueAt).toLocaleString("vi-VN")}</p>
              </div>
              <div className="flex flex-wrap gap-2"><Button onClick={() => void openConversation(item)} variant="ghost"><MessageSquare size={15} />Trao đổi</Button>{admin &&
              item.status !== "RESOLVED" &&
              item.status !== "CLOSED" ? (
                <Button onClick={() => void resolve(item)} variant="secondary">
                  <CheckCheck size={16} />
                  Hoàn tất
                </Button>
              ) : null}{!admin && item.status === "RESOLVED" ? (
                <Button onClick={() => void closeResolved(item)} variant="secondary">
                  <CheckCheck size={16} />
                  Xác nhận đóng
                </Button>
              ) : null}</div>
            </article>
          ))}
        </div>
      </SectionState>
      <Pagination itemLabel="yêu cầu hỗ trợ" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
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
              onChange={(event) => setForm({ ...form, contextId: event.target.value })}
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
          <Button type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Trao đổi yêu cầu hỗ trợ" description={selected ? `${selected.category} · ${selected.severity} · SLA ${new Date(selected.dueAt).toLocaleString("vi-VN")}` : undefined}>
        <div className="max-h-72 space-y-3 overflow-y-auto">{comments.length ? comments.map((comment) => <div className={`rounded-xl p-3 text-sm ${comment.authorId === "usr-learner" ? "bg-[#eee8dc]" : "bg-[#f8ece6]"}`} key={comment.id}><p>{comment.body}</p><p className="mt-1 text-[10px] font-bold text-[#657789]">{comment.authorId} · {new Date(comment.createdAt).toLocaleString("vi-VN")}</p></div>) : <p className="text-sm text-[#657789]">Chưa có trao đổi.</p>}</div>
        {selected?.status !== "CLOSED" ? <form className="mt-4 flex gap-2" onSubmit={(event) => void addComment(event)}><input className={inputClass} minLength={2} required placeholder="Nhập nội dung phản hồi…" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} /><Button aria-label="Gửi trao đổi" type="submit"><Send size={16} /></Button></form> : null}
      </Modal>
    </div>
  );
}
