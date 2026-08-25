"use client";

import { Flag, MessageCircle, Pin, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type {
  ContentReport,
  ForumPost,
  ForumTopic,
  LearningClass,
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
  const [selected, setSelected] = useState<ForumTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState("");
  const [replyTo, setReplyTo] = useState<ForumPost | null>(null);
  const [reportTarget, setReportTarget] = useState<ForumTopic | null>(null);
  const [reportForm, setReportForm] = useState({ reason: "Nội dung không phù hợp", details: "" });
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
      const [topicData, classData, reportData] = await Promise.all([
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
      ]);
      setTopics(topicData);
      setClasses(classData);
      setReports(reportData);
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
        body: JSON.stringify({ body: post, parentId: replyTo?.id }),
      });
      setPost("");
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
  const resolve = async (item: ContentReport) => {
    try {
      await apiRequest(`/manager/forum/reports/${item.id}/resolve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          status: "RESOLVED",
          resolution: "Đã rà soát nội dung và xử lý theo quy định diễn đàn.",
        }),
      });
      notify("Đã xử lý báo cáo.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xử lý được.",
        "error",
      );
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
      {manager && reports.length ? (
        <section className="mb-7">
          <h2 className="mb-3 text-xs font-extrabold uppercase tracking-widest text-rose-600">
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
                {item.status === "OPEN" ? (
                  <Button
                    onClick={() => void resolve(item)}
                    variant="secondary"
                  >
                    Xử lý
                  </Button>
                ) : (
                  <StatusBadge status={item.status} />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {learner && reports.length ? <div className="mb-6 flex flex-wrap gap-2 border-y border-slate-200 py-3">{reports.map((item) => <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-600" key={item.id}><Flag size={13} className="text-rose-600" />{item.reason}<StatusBadge status={item.status} /></span>)}</div> : null}
      <SectionState loading={loading} empty={topics.length === 0}>
        <div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
          <div className="space-y-3">
            {topics.map((topic) => (
              <button
                className={`w-full rounded-2xl border bg-white p-5 text-left transition ${selected?.id === topic.id ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-sky-300"}`}
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
          <section className="min-h-80 rounded-2xl border border-slate-200 bg-white p-5">
            {selected ? (
              <>
                <h2 className="font-heading text-xl font-extrabold">
                  {selected.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selected.body}
                </p>
                <div className="my-5 border-t border-slate-100" />
                <div className="space-y-3">
                  {posts.length ? (
                    posts.map((item) => (
                      <div className={`rounded-xl bg-slate-50 p-4 ${item.parentId ? "ml-6 border-l-2 border-sky-200" : ""}`} key={item.id}>
                        <p className="text-sm leading-6">{item.body}</p>
                        <p className="mt-2 text-[10px] font-bold text-slate-400">
                          {new Date(item.createdAt).toLocaleString("vi-VN")}
                        </p>
                        {learner && !selected.isLocked ? <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => setReplyTo(item)} type="button">Trả lời</button> : null}
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
    </div>
  );
}
