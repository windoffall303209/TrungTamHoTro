"use client";

import { CheckCheck, LifeBuoy, MessageSquare, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { Ticket, TicketComment } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function SupportPage() {
  const { session, notify } = useApp();
  const admin = session.roleCode === "SYSTEM_ADMIN";
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [form, setForm] = useState({
    category: "TECHNICAL",
    severity: "P2",
    description: "",
  });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(
        await apiRequest<Ticket[]>("/support/tickets", {
          roleCode: session.roleCode,
        }),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được yêu cầu.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest("/support/tickets", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(form),
      });
      notify("Đã gửi yêu cầu hỗ trợ.");
      setOpen(false);
      setForm({ ...form, description: "" });
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
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-3">
          {items.map((item) => (
            <article
              className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-[auto_1fr_auto] md:items-center"
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
              ) : null}</div>
            </article>
          ))}
        </div>
      </SectionState>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Gửi yêu cầu hỗ trợ"
      >
        <form className="space-y-4" onSubmit={(e) => void create(e)}>
          <div className="grid grid-cols-2 gap-3">
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
          <Button type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Trao đổi yêu cầu hỗ trợ" description={selected ? `${selected.category} · ${selected.severity} · SLA ${new Date(selected.dueAt).toLocaleString("vi-VN")}` : undefined}>
        <div className="max-h-72 space-y-3 overflow-y-auto">{comments.length ? comments.map((comment) => <div className={`rounded-xl p-3 text-sm ${comment.authorId === "usr-learner" ? "bg-slate-100" : "bg-sky-50"}`} key={comment.id}><p>{comment.body}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{comment.authorId} · {new Date(comment.createdAt).toLocaleString("vi-VN")}</p></div>) : <p className="text-sm text-slate-400">Chưa có trao đổi.</p>}</div>
        {selected?.status !== "CLOSED" ? <form className="mt-4 flex gap-2" onSubmit={(event) => void addComment(event)}><input className={inputClass} minLength={2} required placeholder="Nhập nội dung phản hồi…" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} /><Button aria-label="Gửi trao đổi" type="submit"><Send size={16} /></Button></form> : null}
      </Modal>
    </div>
  );
}
