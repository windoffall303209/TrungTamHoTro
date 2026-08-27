"use client";

import { Bell, Eye, EyeOff, Flag, Lock, MessageCircle, Paperclip, Pencil, Pin, Plus, Send, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type {
  ContentReport,
  ForumPost,
  ForumTopic,
  LearningNotification,
  LearningClass,
  Material,
  ModerationContext,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function ForumPage() {
  const { session, notify } = useApp();
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const manager = session.roleCode === "CENTER_MANAGER";
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [notifications, setNotifications] = useState<LearningNotification[]>([]);
  const [selected, setSelected] = useState<ForumTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<ForumPost | null>(null);
  const [editingPost, setEditingPost] = useState<ForumPost | null>(null);
  const [editBody, setEditBody] = useState("");
  const [topicAction, setTopicAction] = useState<{ isLocked?: boolean; isPinned?: boolean; label: string } | null>(null);
  const [topicReason, setTopicReason] = useState("");
  const [hideTarget, setHideTarget] = useState<ForumPost | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [reportTarget, setReportTarget] = useState<ForumTopic | null>(null);
  const [reportForm, setReportForm] = useState({ reason: "Nội dung không phù hợp", details: "" });
  const [moderationTarget, setModerationTarget] = useState<ContentReport | null>(null);
  const [moderationContext, setModerationContext] = useState<ModerationContext | null>(null);
  const [moderationForm, setModerationForm] = useState({ action: "HIDE_CONTENT", resolution: "" });
  const [appealTarget, setAppealTarget] = useState<ContentReport | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    classId: "",
    title: "",
    body: "",
    tags: "",
    isPinned: false,
  });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [topicData, classData, reportData, materialData, notificationData] = await Promise.all([
        apiRequest<ForumTopic[]>("/forum/topics", {
          roleCode: session.roleCode,
        }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        manager
          ? apiRequest<ContentReport[]>("/manager/forum/reports", {
              roleCode: session.roleCode,
            })
          : learner
            ? apiRequest<ContentReport[]>("/learner/content-reports", { roleCode: session.roleCode })
            : Promise.resolve([]),
        learner
          ? apiRequest<Material[]>("/materials", { roleCode: session.roleCode })
          : Promise.resolve([]),
        learner
          ? apiRequest<LearningNotification[]>("/learner/notifications", { roleCode: session.roleCode })
          : Promise.resolve([]),
      ]);
      setTopics(topicData);
      setClasses(classData);
      setReports(reportData);
      setMaterials(materialData);
      setNotifications(notificationData);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được diễn đàn.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [learner, manager, notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const choose = async (topic: ForumTopic) => {
    setSelected(topic);
    setAttachmentIds([]);
    setMentionedUserIds([]);
    setReplyTo(null);
    try {
      setPosts(
        await apiRequest<ForumPost[]>(`/forum/topics/${topic.id}/posts`, {
          roleCode: session.roleCode,
        }),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được thảo luận.",
        "error",
      );
    }
  };
  const createTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const actorPath = learner ? "learner" : "instructor";
      await apiRequest(`/${actorPath}/classes/${form.classId}/forum/topics`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          ...form,
          classId: undefined,
          tags: form.tags
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      });
      notify("Đã mở chủ đề thảo luận.");
      setOpen(false);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được chủ đề.",
        "error",
      );
    }
  };
  const createPost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try {
      await apiRequest(`/learner/forum/topics/${selected.id}/posts`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          body: post,
          parentId: replyTo?.id,
          attachmentIds,
          mentionedUserIds,
        }),
      });
      setPost("");
      setAttachmentIds([]);
      setMentionedUserIds([]);
      setReplyTo(null);
      notify(replyTo ? "Đã gửi phản hồi theo luồng." : "Đã gửi bình luận.");
      await choose(selected);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được bình luận.",
        "error",
      );
    }
  };
  const updatePost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPost || !selected) return;
    try {
      await apiRequest(`/learner/forum/posts/${editingPost.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ body: editBody }) });
      setEditingPost(null); setEditBody(""); notify("Đã sửa phản hồi và lưu lịch sử phiên bản."); await choose(selected);
    } catch (error) { notify(error instanceof Error ? error.message : "Không sửa được phản hồi.", "error"); }
  };
  const deletePost = async (item: ForumPost) => {
    if (!selected) return;
    try {
      await apiRequest(`/learner/forum/posts/${item.id}/delete`, { method: "POST", roleCode: session.roleCode });
      notify("Đã xóa mềm phản hồi; cấu trúc hội thoại vẫn được giữ."); await choose(selected);
    } catch (error) { notify(error instanceof Error ? error.message : "Không xóa được phản hồi.", "error"); }
  };
  const moderateTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !topicAction) return;
    try {
      const updated = await apiRequest<ForumTopic>(`/instructor/forum/topics/${selected.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ ...topicAction, label: undefined, reason: topicReason }) });
      setSelected(updated); setTopics((current) => current.map((item) => item.id === updated.id ? updated : item)); setTopicAction(null); setTopicReason(""); notify("Đã cập nhật trạng thái chủ đề và ghi audit.");
    } catch (error) { notify(error instanceof Error ? error.message : "Không điều phối được chủ đề.", "error"); }
  };
  const hidePost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hideTarget || !selected) return;
    try {
      await apiRequest(`/instructor/forum/posts/${hideTarget.id}/hide`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ reason: hideReason }) });
      setHideTarget(null); setHideReason(""); notify("Đã ẩn phản hồi và ghi lý do kiểm duyệt."); await choose(selected);
    } catch (error) { notify(error instanceof Error ? error.message : "Không ẩn được phản hồi.", "error"); }
  };
  const markNotificationRead = async (item: LearningNotification) => {
    if (item.readAt) return;
    try {
      const updated = await apiRequest<LearningNotification>(
        `/learner/notifications/${item.id}/read`,
        { method: "PATCH", roleCode: session.roleCode },
      );
      setNotifications((current) =>
        current.map((candidate) => candidate.id === item.id ? updated : candidate),
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được thông báo.", "error");
    }
  };
  const report = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reportTarget) return;
    try {
      await apiRequest("/learner/content-reports", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          targetType: "TOPIC",
          targetId: reportTarget.id,
          reason: reportForm.reason,
          details: reportForm.details,
        }),
      });
      notify("Đã gửi báo cáo tới quản lý.");
      setReportTarget(null);
      setReportForm({ reason: "Nội dung không phù hợp", details: "" });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được báo cáo.",
        "error",
      );
    }
  };
  const openModeration = async (item: ContentReport) => {
    try {
      setSubmitting(true);
      const claimed = item.status === "OPEN"
        ? await apiRequest<ContentReport>(`/manager/forum/reports/${item.id}/claim`, { method: "POST", roleCode: session.roleCode })
        : item;
      const context = await apiRequest<ModerationContext>(`/manager/forum/reports/${item.id}/context`, { roleCode: session.roleCode });
      setModerationTarget(claimed);
      setModerationContext(context);
      setModerationForm({ action: "HIDE_CONTENT", resolution: "" });
      if (item.status === "OPEN") await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không mở được hồ sơ kiểm duyệt.", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const resolve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!moderationTarget) return;
    try {
      setSubmitting(true);
      await apiRequest(`/manager/forum/reports/${moderationTarget.id}/resolve`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify(moderationForm) });
      notify(moderationForm.action === "ESCALATE_ADMIN" ? "Đã chuyển hồ sơ tới quản trị hệ thống." : "Đã lưu kết quả kiểm duyệt và gửi thông báo.");
      setModerationTarget(null);
      setModerationContext(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xử lý được báo cáo.", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const appeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!appealTarget) return;
    try {
      setSubmitting(true);
      await apiRequest(`/learner/content-reports/${appealTarget.id}/appeal`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ reason: appealReason }) });
      notify("Đã gửi kháng nghị để quản lý rà soát lại.");
      setAppealTarget(null);
      setAppealReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được kháng nghị.", "error");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Community Learning"
        title="Diễn đàn trao đổi"
        description="Thảo luận theo lớp, phản hồi theo luồng và kiểm duyệt nội dung có truy vết."
        actions={
          instructor || learner ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={17} />
              Mở chủ đề
            </Button>
          ) : undefined
        }
      />
      {learner && notifications.length ? (
        <section className="mb-6 border-y border-slate-200 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-sky-700">
            <Bell size={14} /> Thông báo diễn đàn
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {notifications.map((item) => (
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${item.readAt ? "bg-slate-100 text-slate-500" : "bg-sky-100 text-sky-800"}`}
                key={item.id}
                onClick={() => void markNotificationRead(item)}
                type="button"
              >
                {item.title}{item.readAt ? " · Đã đọc" : " · Mới"}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {manager && reports.length ? (
        <section className="mb-7">
          <h2 className="mb-3 text-lg font-extrabold tracking-tight text-rose-700">
            Báo cáo cần xử lý
          </h2>
          <div className="space-y-2">
            {reports.map((item) => (
              <div
                className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50 p-4"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold">{item.reason}</p>
                  <p className="text-xs text-slate-500">{item.details}</p>
                </div>
                {["OPEN", "IN_REVIEW"].includes(item.status) ? (
                  <Button
                    disabled={submitting}
                    onClick={() => void openModeration(item)}
                    variant="secondary"
                  >
                    <Eye size={15} /> {item.status === "OPEN" ? "Nhận xử lý" : "Mở hồ sơ"}
                  </Button>
                ) : (
                  <StatusBadge status={item.status} />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {learner && reports.length ? <div className="mb-6 space-y-2 border-y border-slate-200 py-3">{reports.map((item) => <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600" key={item.id}><span className="inline-flex items-center gap-2"><Flag size={13} className="text-rose-600" />{item.reason}<StatusBadge status={item.status} /></span>{(["RESOLVED", "REJECTED"].includes(item.status) && !item.appealedAt) ? <Button className="min-h-8 px-3 text-xs" onClick={() => setAppealTarget(item)} variant="ghost">Kháng nghị</Button> : null}</div>)}</div> : null}
      <SectionState loading={loading} empty={topics.length === 0}>
        <div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
          <div className="overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/65">
            {topics.map((topic) => (
              <button
                className={`data-row w-full border-b border-[#d5dfe2] p-5 text-left transition-colors last:border-b-0 ${selected?.id === topic.id ? "bg-[#f8ece6]" : "bg-transparent"}`}
                key={topic.id}
                onClick={() => void choose(topic)}
              >
                <div className="flex items-center gap-2 text-xs font-bold text-sky-700">
                  {topic.isPinned ? (
                    <Pin size={13} />
                  ) : (
                    <MessageCircle size={13} />
                  )}{" "}
                  {classes.find((c) => c.id === topic.classId)?.code ??
                    "Lớp học"}
                </div>
                <h2 className="mt-2 text-lg font-extrabold">{topic.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                  {topic.body}
                </p>
                {learner ? (
                  <span
                    className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-rose-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReportTarget(topic);
                    }}
                  >
                    <Flag size={13} />
                    Báo cáo
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <section className="min-h-80 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-5">
            {selected ? (
              <>
                <h2 className="font-heading text-xl font-extrabold">
                  {selected.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.isLocked ? "LOCKED" : "ACTIVE"} />
                  {selected.isPinned ? <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-700"><Pin size={13} />Đã ghim</span> : null}
                  {instructor ? <><Button className="min-h-8 px-3 text-xs" onClick={() => setTopicAction({ isLocked: !selected.isLocked, label: selected.isLocked ? "Mở khóa chủ đề" : "Khóa chủ đề" })} variant="secondary">{selected.isLocked ? <Unlock size={14} /> : <Lock size={14} />}{selected.isLocked ? "Mở khóa" : "Khóa"}</Button><Button className="min-h-8 px-3 text-xs" onClick={() => setTopicAction({ isPinned: !selected.isPinned, label: selected.isPinned ? "Bỏ ghim chủ đề" : "Ghim chủ đề" })} variant="ghost"><Pin size={14} />{selected.isPinned ? "Bỏ ghim" : "Ghim"}</Button></> : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selected.body}
                </p>
                <div className="my-5 border-t border-slate-100" />
                <div className="space-y-3">
                  {posts.length ? (
                    posts.map((item) => (
                      <div className={`rounded-xl bg-slate-50 p-4 ${item.parentId ? "ml-6 border-t border-sky-200" : ""}`} key={item.id}>
                        <p className="text-sm leading-6">{item.body}</p>
                        {item.mentionedUserIds.length ? (
                          <p className="mt-2 text-xs font-bold text-violet-700">
                            Nhắc: {item.mentionedUserIds.map((userId) => `@${userId}`).join(", ")}
                          </p>
                        ) : null}
                        {item.attachmentIds.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.attachmentIds.map((materialId) => (
                              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-700" key={materialId}>
                                <Paperclip size={12} />
                                {materials.find((material) => material.id === materialId)?.name ?? materialId}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <p className="mt-2 text-[10px] font-bold text-slate-400">
                          {new Date(item.createdAt).toLocaleString("vi-VN")}{item.editedAt ? ` · đã sửa ${item.editCount ?? 1} lần` : ""}{item.deletedAt ? " · đã xóa mềm" : ""}
                        </p>
                        {!item.deletedAt && item.status === "VISIBLE" ? <div className="mt-2 flex flex-wrap gap-3">{learner && !selected.isLocked ? <><button className="text-xs font-bold text-sky-700" onClick={() => setReplyTo(item)} type="button">Trả lời</button>{item.authorId === "usr-learner" ? <><button className="inline-flex items-center gap-1 text-xs font-bold text-amber-700" onClick={() => { setEditingPost(item); setEditBody(item.body); }} type="button"><Pencil size={12} />Sửa</button><button className="inline-flex items-center gap-1 text-xs font-bold text-rose-700" onClick={() => void deletePost(item)} type="button"><Trash2 size={12} />Xóa</button></> : null}</> : null}{instructor ? <button className="inline-flex items-center gap-1 text-xs font-bold text-rose-700" onClick={() => setHideTarget(item)} type="button"><EyeOff size={12} />Ẩn có lý do</button> : null}</div> : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">Chưa có phản hồi.</p>
                  )}
                </div>
                {learner ? (
                  <form className="mt-5" onSubmit={(e) => void createPost(e)}>
                    {replyTo ? <div className="mb-2 flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800"><span>Đang trả lời: {replyTo.body.slice(0, 60)}</span><button className="font-bold" onClick={() => setReplyTo(null)} type="button">Hủy</button></div> : null}
                    <div className="flex gap-2">
                    <input
                      className={inputClass}
                      minLength={2}
                      required
                      placeholder={replyTo ? "Viết câu trả lời…" : "Viết phản hồi…"}
                      value={post}
                      onChange={(e) => setPost(e.target.value)}
                    />
                    <Button aria-label="Gửi phản hồi" type="submit">
                      <Send size={16} />
                    </Button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Đính kèm học liệu đã phát hành">
                        <select
                          className={inputClass}
                          multiple
                          size={Math.min(4, Math.max(2, materials.filter((item) => item.classId === selected.classId).length))}
                          value={attachmentIds}
                          onChange={(event) => setAttachmentIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                        >
                          {materials.filter((item) => item.classId === selected.classId).map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Nhắc thành viên trong lớp">
                        <select
                          className={inputClass}
                          multiple
                          size={Math.min(4, Math.max(2, (classes.find((item) => item.id === selected.classId)?.learnerIds.length ?? 0) + (classes.find((item) => item.id === selected.classId)?.instructorIds.length ?? 0)))}
                          value={mentionedUserIds}
                          onChange={(event) => setMentionedUserIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                        >
                          {[...(classes.find((item) => item.id === selected.classId)?.learnerIds ?? []), ...(classes.find((item) => item.id === selected.classId)?.instructorIds ?? [])]
                            .filter((userId) => userId !== "usr-learner")
                            .map((userId) => <option key={userId} value={userId}>{userId}</option>)}
                        </select>
                      </Field>
                    </div>
                  </form>
                ) : null}
              </>
            ) : (
              <div className="grid h-full min-h-64 place-items-center text-center text-sm text-slate-400">
                Chọn một chủ đề để đọc thảo luận.
              </div>
            )}
          </section>
        </div>
      </SectionState>
      <Modal open={open} onClose={() => setOpen(false)} title="Mở chủ đề">
        <form className="space-y-4" onSubmit={(e) => void createTopic(e)}>
          <Field label="Lớp học">
            <select
              className={inputClass}
              required
              value={form.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
            >
              <option value="">Chọn lớp</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tiêu đề">
            <input
              className={inputClass}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Nội dung">
            <textarea
              className={inputClass}
              minLength={5}
              required
              rows={4}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>
          <Field label="Thẻ">
            <input
              className={inputClass}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </Field>
          {instructor ? (
            <label className="flex gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={form.isPinned}
                onChange={(e) =>
                  setForm({ ...form, isPinned: e.target.checked })
                }
              />
              Ghim chủ đề
            </label>
          ) : null}
          <Button type="submit">Tạo chủ đề</Button>
        </form>
      </Modal>
      <Modal open={Boolean(reportTarget)} onClose={() => setReportTarget(null)} title="Báo cáo nội dung" description="Quản lý sẽ nhận đúng chủ đề, lý do và mô tả; báo cáo trùng đang mở sẽ bị chặn.">
        <form className="space-y-4" onSubmit={(event) => void report(event)}>
          <Field label="Lý do"><select className={inputClass} value={reportForm.reason} onChange={(event) => setReportForm({ ...reportForm, reason: event.target.value })}><option>Nội dung không phù hợp</option><option>Spam</option><option>Quấy rối</option><option>Thông tin sai lệch</option></select></Field>
          <Field label="Mô tả / bằng chứng"><textarea className={inputClass} minLength={3} required rows={4} value={reportForm.details} onChange={(event) => setReportForm({ ...reportForm, details: event.target.value })} /></Field>
          <Button type="submit"><Flag size={15} />Gửi báo cáo</Button>
        </form>
      </Modal>
      <Modal open={Boolean(moderationTarget)} onClose={() => { setModerationTarget(null); setModerationContext(null); }} title="Hồ sơ kiểm duyệt" description="Đọc nội dung trong ngữ cảnh trước khi quyết định; mọi hành động đều được lưu lịch sử.">
        {moderationContext ? <form className="space-y-5" onSubmit={(event) => void resolve(event)}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{moderationContext.topicTitle}</strong><StatusBadge status={moderationTarget?.status ?? "IN_REVIEW"} /></div>
            <p className="mt-2 text-slate-700">{moderationContext.targetBody}</p>
            <p className="mt-3 text-xs text-slate-500">Người đăng: {moderationContext.targetAuthorId} · Lớp: {moderationContext.classId} · {moderationContext.surroundingPosts.length} phản hồi trong ngữ cảnh</p>
          </div>
          {moderationTarget?.appealReason ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><strong>Kháng nghị:</strong> {moderationTarget.appealReason}</div> : null}
          <Field label="Hành động"><select className={inputClass} value={moderationForm.action} onChange={(event) => setModerationForm({ ...moderationForm, action: event.target.value })}><option value="HIDE_CONTENT">Ẩn nội dung vi phạm</option><option value="KEEP_CONTENT">Giữ nội dung / bác báo cáo</option><option value="ESCALATE_ADMIN">Chuyển cấp quản trị hệ thống</option></select></Field>
          <Field label="Kết luận và căn cứ"><textarea className={inputClass} minLength={3} required rows={4} value={moderationForm.resolution} onChange={(event) => setModerationForm({ ...moderationForm, resolution: event.target.value })} /></Field>
          <Button loading={submitting} type="submit"><ShieldCheck size={16} />Lưu kết quả</Button>
          {moderationTarget?.actions.length ? <div><p className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Lịch sử hồ sơ</p><div className="mt-2 space-y-2">{moderationTarget.actions.map((action) => <p className="text-xs text-slate-600" key={action.id}>{action.action} · {action.previousStatus} → {action.nextStatus} · {action.reason}</p>)}</div></div> : null}
        </form> : <p className="text-sm text-slate-500">Đang tải ngữ cảnh báo cáo…</p>}
      </Modal>
      <Modal open={Boolean(appealTarget)} onClose={() => setAppealTarget(null)} title="Kháng nghị kết quả" description="Mỗi báo cáo chỉ được kháng nghị một lần; quản lý sẽ xem lại toàn bộ ngữ cảnh và lịch sử.">
        <form className="space-y-4" onSubmit={(event) => void appeal(event)}><Field label="Lý do kháng nghị"><textarea className={inputClass} minLength={10} required rows={4} value={appealReason} onChange={(event) => setAppealReason(event.target.value)} /></Field><Button loading={submitting} type="submit">Gửi kháng nghị</Button></form>
      </Modal>
      <Modal open={Boolean(editingPost)} onClose={() => setEditingPost(null)} title="Sửa phản hồi" description="Bản nội dung trước được giữ trong lịch sử chỉnh sửa.">
        <form className="space-y-4" onSubmit={(event) => void updatePost(event)}><Field label="Nội dung mới"><textarea className={inputClass} minLength={2} required rows={4} value={editBody} onChange={(event) => setEditBody(event.target.value)} /></Field><Button type="submit"><Pencil size={14} />Lưu chỉnh sửa</Button></form>
      </Modal>
      <Modal open={Boolean(topicAction)} onClose={() => setTopicAction(null)} title={topicAction?.label ?? "Điều phối chủ đề"} description="Khóa chỉ ngăn thao tác mới, không xóa các phản hồi hiện có.">
        <form className="space-y-4" onSubmit={(event) => void moderateTopic(event)}><Field label="Lý do điều phối"><textarea className={inputClass} minLength={5} required rows={3} value={topicReason} onChange={(event) => setTopicReason(event.target.value)} /></Field><Button type="submit"><ShieldCheck size={14} />Xác nhận</Button></form>
      </Modal>
      <Modal open={Boolean(hideTarget)} onClose={() => setHideTarget(null)} title="Ẩn phản hồi" description="Nội dung được ẩn nhưng vị trí trong luồng thảo luận vẫn được giữ.">
        <form className="space-y-4" onSubmit={(event) => void hidePost(event)}><Field label="Lý do kiểm duyệt"><textarea className={inputClass} minLength={5} required rows={3} value={hideReason} onChange={(event) => setHideReason(event.target.value)} /></Field><Button variant="danger" type="submit"><EyeOff size={14} />Ẩn phản hồi</Button></form>
      </Modal>
    </div>
  );
}
