"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  AlertCircle,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  CornerDownRight,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Lock,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  usePagination,
} from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { MaterialSearchControls, useMaterialSearch } from "@/components/material-search";
import type {
  ContentReport,
  ForumPost,
  ForumTopic,
  LearningClass,
  ModerationContext,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

const AVATAR_PALETTES = [
  "bg-sky-500 text-white",
  "bg-indigo-500 text-white",
  "bg-cyan-600 text-white",
  "bg-emerald-500 text-white",
  "bg-blue-600 text-white",
  "bg-violet-500 text-white",
  "bg-amber-500 text-white",
];

// Trả về màu nền avatar nhất quán theo mã người dùng.
function getAvatarPalette(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index] ?? "bg-sky-500 text-white";
}

// Lấy 1-2 chữ cái viết tắt đại diện cho người dùng từ định danh.
function getInitials(nameOrId: string): string {
  if (!nameOrId) return "?";
  const cleaned = nameOrId.trim();
  const parts = cleaned.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

// Điều phối toàn bộ thảo luận lớp học, phản hồi theo luồng và kiểm duyệt nội dung an toàn.
export default function ForumPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "forum:moderate");

  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [selected, setSelected] = useState<ForumTopic | null>(null);

  // Bộ lọc danh sách chủ đề
  const [classFilter, setClassFilter] = useState<string>("");
  const [topicSearch, setTopicSearch] = useState<string>("");
  const [topicTab, setTopicTab] = useState<"all" | "pinned" | "mine">("all");
  const [showReportsPanel, setShowReportsPanel] = useState(false);

  // Học liệu và phản hồi
  const materialSearch = useMaterialSearch(
    session.roleCode,
    { classId: selected?.classId ?? "", visibility: "PUBLISHED" },
    learner && Boolean(selected),
    session.user.id,
  );
  const materials = materialSearch.items;
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [showAttachDrawer, setShowAttachDrawer] = useState(false);
  const [showMentionDrawer, setShowMentionDrawer] = useState(false);

  // Phản hồi và điều phối
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

  // Form tạo chủ đề
  const [form, setForm] = useState({
    classId: "",
    title: "",
    body: "",
    tags: "",
    isPinned: false,
  });

  // Lọc chủ đề theo lớp, tìm kiếm từ khóa và tab
  const filteredTopics = useMemo(() => {
    return topics.filter((topic) => {
      if (classFilter && topic.classId !== classFilter) return false;
      if (topicTab === "pinned" && !topic.isPinned) return false;
      if (topicTab === "mine" && topic.authorId !== session.user.id) return false;
      if (topicSearch.trim()) {
        const query = topicSearch.trim().toLowerCase();
        const matchTitle = topic.title.toLowerCase().includes(query);
        const matchBody = topic.body.toLowerCase().includes(query);
        const matchTag = topic.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!matchTitle && !matchBody && !matchTag) return false;
      }
      return true;
    });
  }, [topics, classFilter, topicTab, topicSearch, session.user.id]);

  const topicPagination = usePagination(filteredTopics, 8);
  const postPagination = usePagination(posts, 15);

  // Nạp các lớp học, danh sách chủ đề và báo cáo kiểm duyệt từ API.
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setTopics([]);
    setSelected(null);
    setPosts([]);
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
      const requestedClassId = searchParams.get("classId");
      if (requestedClassId && classData.some((item) => item.id === requestedClassId)) {
        setForm((current) => ({ ...current, classId: requestedClassId }));
        setClassFilter(requestedClassId);
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được diễn đàn.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, learner, manager, notify, searchParams, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Chọn một chủ đề và nạp toàn bộ danh sách phản hồi theo luồng.
  const choose = useCallback(async (topic: ForumTopic) => {
    setSelected(topic);
    setAttachmentIds([]);
    setMentionedUserIds([]);
    setReplyTo(null);
    setShowAttachDrawer(false);
    setShowMentionDrawer(false);
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
  }, [notify, session.roleCode]);

  useEffect(() => {
    const requestedClassId = searchParams.get("classId");
    const firstTopic = topics.find((topic) => topic.classId === requestedClassId) ?? topics[0];
    if (!selected && firstTopic) {
      const timer = window.setTimeout(() => void choose(firstTopic), 0);
      return () => window.clearTimeout(timer);
    }
  }, [choose, searchParams, selected, topics]);

  // Tạo chủ đề thảo luận mới và đồng bộ lại danh sách.
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
      setForm({ classId: "", title: "", body: "", tags: "", isPinned: false });
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được chủ đề.",
        "error",
      );
    }
  };

  // Đăng bài viết hoặc phản hồi lồng nhau vào chủ đề đang chọn.
  const createPost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !post.trim()) return;
    try {
      await apiRequest(`/learner/forum/topics/${selected.id}/posts`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          body: post.trim(),
          parentId: replyTo?.id,
          attachmentIds,
          mentionedUserIds,
        }),
      });
      setPost("");
      setAttachmentIds([]);
      setMentionedUserIds([]);
      setReplyTo(null);
      setShowAttachDrawer(false);
      setShowMentionDrawer(false);
      notify(replyTo ? "Đã gửi phản hồi theo luồng." : "Đã gửi bình luận.");
      await choose(selected);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được bình luận.",
        "error",
      );
    }
  };

  // Lưu nội dung chỉnh sửa phản hồi của chính tác giả.
  const updatePost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPost || !selected) return;
    try {
      await apiRequest(`/learner/forum/posts/${editingPost.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ body: editBody }),
      });
      setEditingPost(null);
      setEditBody("");
      notify("Đã sửa phản hồi và lưu lịch sử phiên bản.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không sửa được phản hồi.", "error");
    }
  };

  // Xóa mềm phản hồi khỏi luồng thảo luận.
  const deletePost = async (item: ForumPost) => {
    if (!selected) return;
    try {
      await apiRequest(`/learner/forum/posts/${item.id}/delete`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xóa mềm phản hồi; cấu trúc hội thoại vẫn được giữ.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xóa được phản hồi.", "error");
    }
  };

  // Thực hiện hành động ghim hoặc khóa chủ đề có ghi nhận lý do kiểm duyệt.
  const moderateTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !topicAction) return;
    try {
      const updated = await apiRequest<ForumTopic>(`/instructor/forum/topics/${selected.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ ...topicAction, label: undefined, reason: topicReason }),
      });
      setSelected(updated);
      setTopics((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setTopicAction(null);
      setTopicReason("");
      notify("Đã cập nhật trạng thái chủ đề và lưu audit log.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không điều phối được chủ đề.", "error");
    }
  };

  // Ẩn phản hồi vi phạm nguyên tắc cộng đồng kèm lý do giải trình.
  const hidePost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hideTarget || !selected) return;
    try {
      await apiRequest(`/instructor/forum/posts/${hideTarget.id}/hide`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: hideReason }),
      });
      setHideTarget(null);
      setHideReason("");
      notify("Đã ẩn phản hồi và ghi nhận lý do kiểm duyệt.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không ẩn được phản hồi.", "error");
    }
  };

  // Báo cáo nội dung không phù hợp lên ban quản trị.
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
      notify("Đã gửi báo cáo tới ban quản trị.");
      setReportTarget(null);
      setReportForm({ reason: "Nội dung không phù hợp", details: "" });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được báo cáo.",
        "error",
      );
    }
  };

  // Mở chi tiết hồ sơ kiểm duyệt nội dung của người quản lý.
  const openModeration = async (item: ContentReport) => {
    try {
      setSubmitting(true);
      const claimed =
        item.status === "OPEN"
          ? await apiRequest<ContentReport>(`/manager/forum/reports/${item.id}/claim`, {
              method: "POST",
              roleCode: session.roleCode,
            })
          : item;
      const context = await apiRequest<ModerationContext>(`/manager/forum/reports/${item.id}/context`, {
        roleCode: session.roleCode,
      });
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

  // Ban hành quyết định xử lý báo cáo kiểm duyệt.
  const resolve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!moderationTarget) return;
    try {
      setSubmitting(true);
      await apiRequest(`/manager/forum/reports/${moderationTarget.id}/resolve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(moderationForm),
      });
      notify(
        moderationForm.action === "ESCALATE_ADMIN"
          ? "Đã chuyển cấp quản trị hệ thống."
          : "Đã lưu kết quả kiểm duyệt và gửi thông báo.",
      );
      setModerationTarget(null);
      setModerationContext(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xử lý được báo cáo.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Gửi đơn kháng nghị về quyết định xử phạt nội dung.
  const appeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!appealTarget) return;
    try {
      setSubmitting(true);
      await apiRequest(`/learner/content-reports/${appealTarget.id}/appeal`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: appealReason }),
      });
      notify("Đã gửi kháng nghị để ban quản lý rà soát lại.");
      setAppealTarget(null);
      setAppealReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được kháng nghị.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Bật tắt đính kèm một học liệu vào danh sách tệp đính kèm.
  const toggleAttachment = (id: string) => {
    setAttachmentIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  // Bật tắt nhắc tên một người dùng trong danh sách nhắc.
  const toggleMention = (userId: string) => {
    setMentionedUserIds((prev) => (prev.includes(userId) ? prev.filter((item) => item !== userId) : [...prev, userId]));
  };

  const selectedClass = classes.find((c) => c.id === selected?.classId);
  const classMembers = useMemo(() => {
    if (!selectedClass) return [];
    const members = [...(selectedClass.learnerIds ?? []), ...(selectedClass.instructorIds ?? [])];
    return Array.from(new Set(members)).filter((id) => id !== session.user.id);
  }, [selectedClass, session.user.id]);

  const pendingReportsCount = reports.filter((item) => ["OPEN", "IN_REVIEW"].includes(item.status)).length;
  const pinnedTopicsCount = topics.filter((t) => t.isPinned).length;
  const myTopicsCount = topics.filter((t) => t.authorId === session.user.id).length;

  if (!allowed) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 space-y-6">
      {/* Tiêu đề trang chính */}
      <PageHeader
        eyebrow="Community Learning"
        title="Diễn đàn trao đổi"
        description="Thảo luận theo lớp, trao đổi bài học theo luồng và kiểm duyệt nội dung an toàn."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {manager && reports.length > 0 ? (
              <Button
                onClick={() => setShowReportsPanel(!showReportsPanel)}
                variant={showReportsPanel ? "primary" : "secondary"}
                className="h-10 text-xs sm:text-sm"
              >
                <ShieldAlert size={15} />
                Báo cáo ({pendingReportsCount})
              </Button>
            ) : null}
            {instructor || learner ? (
              <Button onClick={() => setOpen(true)} className="h-10 text-xs sm:text-sm">
                <Plus size={16} />
                Mở chủ đề mới
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Khu vực xử lý báo cáo kiểm duyệt dành cho Quản lý */}
      {manager && reports.length > 0 && showReportsPanel ? (
        <section className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 p-5 shadow-xs transition-all">
          <div className="flex items-center justify-between pb-3 border-b border-rose-200/80 dark:border-rose-900/50 mb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-rose-600 dark:text-rose-400" size={18} />
              <h2 className="text-sm sm:text-base font-bold text-rose-900 dark:text-rose-200">
                Hàng đợi kiểm duyệt báo cáo nội dung ({reports.length})
              </h2>
            </div>
            <button
              onClick={() => setShowReportsPanel(false)}
              className="text-xs text-rose-700 dark:text-rose-300 hover:underline"
              type="button"
            >
              Thu gọn
            </button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {reports.map((item) => (
              <div
                className="flex flex-col justify-between gap-3 rounded-xl bg-white dark:bg-slate-900/90 border border-rose-200/80 dark:border-rose-900/50 p-3.5 shadow-2xs"
                key={item.id}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-rose-700 dark:text-rose-400 truncate">
                      {item.reason}
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                    {item.details || "Không có mô tả chi tiết."}
                  </p>
                </div>
                {["OPEN", "IN_REVIEW"].includes(item.status) ? (
                  <Button
                    disabled={submitting}
                    onClick={() => void openModeration(item)}
                    variant="secondary"
                    className="h-8 text-xs w-full"
                  >
                    <Eye size={13} /> {item.status === "OPEN" ? "Nhận xử lý" : "Mở hồ sơ"}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Thông báo báo cáo dành cho Học viên */}
      {learner && reports.length > 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Flag size={14} className="text-rose-500" />
              Bạn có {reports.length} báo cáo nội dung đã gửi
            </span>
            <div className="flex flex-wrap gap-2">
              {reports.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800"
                >
                  <span className="truncate max-w-[120px]">{item.reason}</span>
                  <StatusBadge status={item.status} />
                  {["RESOLVED", "REJECTED"].includes(item.status) && !item.appealedAt ? (
                    <button
                      className="text-xs font-semibold text-sky-600 hover:underline"
                      onClick={() => setAppealTarget(item)}
                      type="button"
                    >
                      Kháng nghị
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Bố cục chính 2 cột: Danh sách chủ đề bên trái, Luồng thảo luận bên phải */}
      <SectionState loading={loading} empty={topics.length === 0} emptyTitle="Chưa có chủ đề thảo luận" emptyDescription="Hãy mở chủ đề mới để bắt đầu trao đổi với giảng viên và các bạn học trong lớp.">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* CỘT TRÁI: Bộ lọc và danh sách chủ đề */}
          <aside className="lg:col-span-5 xl:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-4">
            {/* Lọc theo lớp học */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Chọn lớp học
              </label>
              <select
                className={`${inputClass} text-xs sm:text-sm`}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  topicPagination.resetPage();
                }}
                value={classFilter}
              >
                <option value="">Tất cả các lớp ({topics.length} chủ đề)</option>
                {classes.map((cls) => {
                  const count = topics.filter((t) => t.classId === cls.id).length;
                  return (
                    <option key={cls.id} value={cls.id}>
                      {cls.code} — {cls.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Ô tìm kiếm chủ đề */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                className={`${inputClass} pl-9 text-xs sm:text-sm`}
                placeholder="Tìm chủ đề, #tag, nội dung…"
                value={topicSearch}
                onChange={(e) => {
                  setTopicSearch(e.target.value);
                  topicPagination.resetPage();
                }}
              />
              {topicSearch ? (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setTopicSearch("")}
                  type="button"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {/* Các tab lọc nhanh */}
            <div className="flex gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => {
                  setTopicTab("all");
                  topicPagination.resetPage();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  topicTab === "all"
                    ? "bg-sky-600 text-white shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                Tất cả ({topics.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopicTab("pinned");
                  topicPagination.resetPage();
                }}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  topicTab === "pinned"
                    ? "bg-sky-600 text-white shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Pin size={12} />
                Ghim ({pinnedTopicsCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopicTab("mine");
                  topicPagination.resetPage();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  topicTab === "mine"
                    ? "bg-sky-600 text-white shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                Của tôi ({myTopicsCount})
              </button>
            </div>

            {/* Danh sách thẻ chủ đề */}
            <div className="space-y-2">
              {topicPagination.pageItems.length ? (
                topicPagination.pageItems.map((topic) => {
                  const isCurrent = selected?.id === topic.id;
                  const topicClass = classes.find((c) => c.id === topic.classId);
                  return (
                    <article
                      key={topic.id}
                      className={`relative rounded-xl border transition-all text-left overflow-hidden ${
                        isCurrent
                          ? "bg-sky-50/70 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-sky-200 dark:hover:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <button
                        aria-pressed={isCurrent}
                        className="w-full p-3.5 text-left block"
                        onClick={() => void choose(topic)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="inline-flex shrink-0 items-center rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                              {topicClass?.code ?? "Lớp"}
                            </span>
                            {topic.isPinned ? (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                <Pin size={10} /> Ghim
                              </span>
                            ) : null}
                            {topic.isLocked ? (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-400">
                                <Lock size={10} /> Khóa
                              </span>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                            {new Date(topic.createdAt).toLocaleDateString(activeLocale())}
                          </span>
                        </div>

                        <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-snug">
                          {topic.title}
                        </h3>

                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {topic.body}
                        </p>

                        <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`grid size-5.5 place-items-center rounded-full text-[10px] font-bold shrink-0 ${getAvatarPalette(
                                topic.authorId,
                              )}`}
                            >
                              {getInitials(topic.authorId)}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {topic.authorId === session.user.id ? "Tôi" : topic.authorId}
                            </span>
                          </div>

                          {topic.tags.length ? (
                            <div className="flex items-center gap-1 overflow-hidden shrink-0">
                              {topic.tags.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.2 rounded"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </button>

                      {learner ? (
                        <button
                          className="absolute bottom-2.5 right-2 text-slate-300 hover:text-rose-500 p-1 rounded transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReportTarget(topic);
                          }}
                          title="Báo cáo chủ đề này"
                          type="button"
                        >
                          <Flag size={12} />
                        </button>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  Không tìm thấy chủ đề nào phù hợp với bộ lọc.
                </div>
              )}
            </div>

            <Pagination
              className="pt-2"
              itemLabel="chủ đề"
              onPageChange={topicPagination.setPage}
              onPageSizeChange={topicPagination.setPageSize}
              page={topicPagination.page}
              pageSize={topicPagination.pageSize}
              totalItems={topicPagination.totalItems}
            />
          </aside>

          {/* CỘT PHẢI: Khối chi tiết chủ đề & luồng thảo luận */}
          <section className="lg:col-span-7 xl:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs min-h-[500px] flex flex-col justify-between">
            {selected ? (
              <div className="space-y-6">
                {/* Header chủ đề đang chọn */}
                <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2.5 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
                          {selectedClass?.code ?? "Lớp học"} — {selectedClass?.name}
                        </span>
                        <StatusBadge status={selected.isLocked ? "LOCKED" : "ACTIVE"} />
                        {selected.isPinned ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                            <Pin size={11} /> Đã ghim
                          </span>
                        ) : null}
                      </div>

                      <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                        {selected.title}
                      </h2>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 pt-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`grid size-6 place-items-center rounded-full text-xs font-bold ${getAvatarPalette(
                              selected.authorId,
                            )}`}
                          >
                            {getInitials(selected.authorId)}
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {selected.authorId === session.user.id ? "Tôi (Tác giả)" : selected.authorId}
                          </span>
                        </div>
                        <span>·</span>
                        <span>Đăng lúc {new Date(selected.createdAt).toLocaleString(activeLocale())}</span>
                      </div>
                    </div>

                    {/* Công cụ điều phối của Giảng viên */}
                    {instructor ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          className="h-8 px-2.5 text-xs font-semibold"
                          onClick={() =>
                            setTopicAction({
                              isLocked: !selected.isLocked,
                              label: selected.isLocked ? "Mở khóa chủ đề" : "Khóa chủ đề",
                            })
                          }
                          variant="secondary"
                        >
                          {selected.isLocked ? <Unlock size={13} /> : <Lock size={13} />}
                          {selected.isLocked ? "Mở khóa" : "Khóa"}
                        </Button>
                        <Button
                          className="h-8 px-2.5 text-xs font-semibold"
                          onClick={() =>
                            setTopicAction({
                              isPinned: !selected.isPinned,
                              label: selected.isPinned ? "Bỏ ghim chủ đề" : "Ghim chủ đề",
                            })
                          }
                          variant="ghost"
                        >
                          <Pin size={13} />
                          {selected.isPinned ? "Bỏ ghim" : "Ghim"}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {/* Nội dung bài viết mở đầu (OP) */}
                  <div className="mt-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-4">
                    <p className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                      {selected.body}
                    </p>
                    {selected.tags.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                        {selected.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300 shadow-2xs"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Danh sách phản hồi & bình luận */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                      <MessageSquare size={15} className="text-sky-600 dark:text-sky-400" />
                      Phản hồi ({posts.length})
                    </h3>
                  </div>

                  {posts.length ? (
                    <div className="space-y-3">
                      {postPagination.pageItems.map((item) => {
                        const isOwn = item.authorId === session.user.id;
                        const isParent = Boolean(item.parentId);
                        const parentPost = isParent ? posts.find((p) => p.id === item.parentId) : null;

                        return (
                          <article
                            className={`rounded-xl border p-4 space-y-2.5 transition-colors ${
                              isParent
                                ? "ml-4 sm:ml-7 border-l-3 border-l-sky-500 bg-sky-50/30 dark:bg-sky-950/20 border-slate-200 dark:border-slate-800"
                                : "bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 shadow-2xs"
                            }`}
                            key={item.id}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`grid size-6 place-items-center rounded-full text-xs font-bold shrink-0 ${getAvatarPalette(
                                    item.authorId,
                                  )}`}
                                >
                                  {getInitials(item.authorId)}
                                </span>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                  {isOwn ? "Tôi" : item.authorId}
                                </span>
                                {item.authorId === selected.authorId ? (
                                  <span className="rounded bg-sky-100 dark:bg-sky-900/60 px-1.5 py-0.2 text-[10px] font-bold text-sky-800 dark:text-sky-300">
                                    Tác giả
                                  </span>
                                ) : null}
                                <span className="text-[11px] text-slate-400">·</span>
                                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                  {new Date(item.createdAt).toLocaleString(activeLocale())}
                                </span>
                                {item.editedAt ? (
                                  <span className="text-[10px] text-slate-400 italic">
                                    (đã sửa {item.editCount ?? 1} lần)
                                  </span>
                                ) : null}
                              </div>

                              {item.deletedAt ? (
                                <span className="text-[11px] text-rose-500 font-semibold italic">
                                  Đã xóa mềm
                                </span>
                              ) : null}
                            </div>

                            {/* Trích dẫn phản hồi cha nếu có */}
                            {parentPost ? (
                              <div className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400 bg-sky-100/50 dark:bg-sky-950/60 px-2.5 py-1 rounded-md">
                                <CornerDownRight size={12} className="shrink-0" />
                                <span className="truncate">
                                  Đang trả lời @{parentPost.authorId}: &quot;{parentPost.body}&quot;
                                </span>
                              </div>
                            ) : null}

                            {/* Nội dung phản hồi */}
                            <p className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                              {item.body}
                            </p>

                            {/* Nhắc tên thành viên */}
                            {item.mentionedUserIds.length ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.mentionedUserIds.map((userId) => (
                                  <span
                                    key={userId}
                                    className="inline-flex items-center gap-1 rounded bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/40"
                                  >
                                    <AtSign size={11} />
                                    {userId}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            {/* Tệp học liệu đính kèm */}
                            {item.attachmentIds.length ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.attachmentIds.map((materialId) => (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs"
                                    key={materialId}
                                  >
                                    <Paperclip size={12} className="text-sky-600" />
                                    {materials.find((m) => m.id === materialId)?.name ?? materialId}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            {/* Thao tác trên phản hồi */}
                            {!item.deletedAt && item.status === "VISIBLE" ? (
                              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                                {learner && !selected.isLocked ? (
                                  <>
                                    <button
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 hover:underline"
                                      onClick={() => setReplyTo(item)}
                                      type="button"
                                    >
                                      <CornerDownRight size={12} />
                                      Trả lời
                                    </button>
                                    {isOwn ? (
                                      <>
                                        <button
                                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-sky-600"
                                          onClick={() => {
                                            setEditingPost(item);
                                            setEditBody(item.body);
                                          }}
                                          type="button"
                                        >
                                          <Pencil size={11} />
                                          Sửa
                                        </button>
                                        <button
                                          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700"
                                          onClick={() => void deletePost(item)}
                                          type="button"
                                        >
                                          <Trash2 size={11} />
                                          Xóa
                                        </button>
                                      </>
                                    ) : null}
                                  </>
                                ) : null}

                                {instructor ? (
                                  <button
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                                    onClick={() => setHideTarget(item)}
                                    type="button"
                                  >
                                    <EyeOff size={11} />
                                    Ẩn có lý do
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 text-xs text-slate-400">
                      Chưa có phản hồi nào trong chủ đề này. Hãy là người đầu tiên trao đổi!
                    </div>
                  )}

                  <Pagination
                    itemLabel="phản hồi"
                    onPageChange={postPagination.setPage}
                    onPageSizeChange={postPagination.setPageSize}
                    page={postPagination.page}
                    pageSize={postPagination.pageSize}
                    totalItems={postPagination.totalItems}
                  />
                </div>

                {/* Khung soạn thảo phản hồi (Composer) */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  {selected.isLocked ? (
                    <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 p-3.5 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">
                      <Lock size={15} />
                      Chủ đề này đã được khóa. Người dùng không thể gửi thêm phản hồi mới.
                    </div>
                  ) : learner ? (
                    <form className="space-y-3" onSubmit={(e) => void createPost(e)}>
                      {/* Chỉ báo đang trả lời theo luồng */}
                      {replyTo ? (
                        <div className="flex items-center justify-between rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-3 py-1.5 text-xs text-sky-800 dark:text-sky-300">
                          <span className="flex items-center gap-1.5 truncate">
                            <CornerDownRight size={13} className="shrink-0 text-sky-600" />
                            Đang trả lời <strong>@{replyTo.authorId}</strong>: &quot;{replyTo.body.slice(0, 50)}...&quot;
                          </span>
                          <button
                            className="text-xs font-semibold text-sky-700 hover:text-sky-900 dark:hover:text-sky-200 underline shrink-0 ml-2"
                            onClick={() => setReplyTo(null)}
                            type="button"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : null}

                      {/* Khối textarea chính */}
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/15 transition-all shadow-2xs overflow-hidden">
                        <textarea
                          className="w-full resize-y p-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none bg-transparent min-h-[75px]"
                          minLength={2}
                          placeholder={replyTo ? "Viết câu trả lời của bạn…" : "Chia sẻ ý kiến hoặc đặt câu hỏi thảo luận…"}
                          required
                          rows={3}
                          value={post}
                          onChange={(e) => setPost(e.target.value)}
                        />

                        {/* Các chip đính kèm và nhắc tên đã chọn */}
                        {(attachmentIds.length > 0 || mentionedUserIds.length > 0) ? (
                          <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2">
                            {attachmentIds.map((id) => (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300"
                              >
                                <Paperclip size={11} />
                                {materials.find((m) => m.id === id)?.name ?? id}
                                <button
                                  type="button"
                                  onClick={() => toggleAttachment(id)}
                                  className="text-sky-600 hover:text-rose-500"
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}

                            {mentionedUserIds.map((userId) => (
                              <span
                                key={userId}
                                className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
                              >
                                <AtSign size={11} />
                                {userId}
                                <button
                                  type="button"
                                  onClick={() => toggleMention(userId)}
                                  className="text-slate-500 hover:text-rose-500"
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {/* Thanh công cụ đính kèm và gửi */}
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setShowAttachDrawer(!showAttachDrawer);
                                setShowMentionDrawer(false);
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                showAttachDrawer || attachmentIds.length > 0
                                  ? "bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300"
                                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                              }`}
                            >
                              <Paperclip size={13} />
                              Học liệu {attachmentIds.length ? `(${attachmentIds.length})` : ""}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setShowMentionDrawer(!showMentionDrawer);
                                setShowAttachDrawer(false);
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                showMentionDrawer || mentionedUserIds.length > 0
                                  ? "bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300"
                                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                              }`}
                            >
                              <AtSign size={13} />
                              Nhắc bạn học {mentionedUserIds.length ? `(${mentionedUserIds.length})` : ""}
                            </button>
                          </div>

                          <Button type="submit" className="h-8.5 px-3.5 text-xs font-semibold">
                            <Send size={13} />
                            Gửi phản hồi
                          </Button>
                        </div>
                      </div>

                      {/* Khối chọn học liệu đính kèm (Drawer) */}
                      {showAttachDrawer ? (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-sm space-y-2">
                          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                              <Paperclip size={13} className="text-sky-600" />
                              Chọn học liệu đính kèm từ lớp
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowAttachDrawer(false)}
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              Đóng
                            </button>
                          </div>
                          <MaterialSearchControls search={materialSearch} />
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {materials.filter((m) => m.classId === selected.classId).length ? (
                              materials
                                .filter((m) => m.classId === selected.classId)
                                .map((m) => {
                                  const isChecked = attachmentIds.includes(m.id);
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      onClick={() => toggleAttachment(m.id)}
                                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors ${
                                        isChecked
                                          ? "bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300"
                                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                                      }`}
                                    >
                                      <span className="truncate">{m.name}</span>
                                      {isChecked ? <Check size={14} className="text-sky-600 shrink-0" /> : null}
                                    </button>
                                  );
                                })
                            ) : (
                              <p className="text-xs text-slate-400 py-2 text-center">
                                Chưa có học liệu nào được phát hành trong lớp này.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null}

                      {/* Khối chọn thành viên cần nhắc tên (Drawer) */}
                      {showMentionDrawer ? (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-sm space-y-2">
                          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                              <AtSign size={13} className="text-sky-600" />
                              Nhắc thành viên trong lớp
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowMentionDrawer(false)}
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              Đóng
                            </button>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {classMembers.length ? (
                              classMembers.map((userId) => {
                                const isChecked = mentionedUserIds.includes(userId);
                                return (
                                  <button
                                    key={userId}
                                    type="button"
                                    onClick={() => toggleMention(userId)}
                                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors ${
                                      isChecked
                                        ? "bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300"
                                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${getAvatarPalette(
                                          userId,
                                        )}`}
                                      >
                                        {getInitials(userId)}
                                      </span>
                                      <span>{userId}</span>
                                    </div>
                                    {isChecked ? <Check size={14} className="text-sky-600 shrink-0" /> : null}
                                  </button>
                                );
                              })
                            ) : (
                              <p className="text-xs text-slate-400 py-2 text-center">
                                Không tìm thấy thành viên khác trong lớp này.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </form>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-[350px] place-items-center text-center p-8">
                <div className="max-w-sm space-y-3">
                  <div className="grid size-14 place-items-center rounded-2xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 mx-auto border border-sky-100 dark:border-sky-900/50 shadow-xs">
                    <MessageSquareText size={26} />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Chọn một chủ đề để đọc thảo luận
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    Chọn chủ đề từ danh sách bên trái hoặc nhấn &quot;Mở chủ đề mới&quot; để trao đổi cùng giảng viên và các bạn học.
                  </p>
                  {(instructor || learner) && (
                    <Button onClick={() => setOpen(true)} className="h-9 px-4 text-xs font-semibold mx-auto">
                      <Plus size={15} />
                      Mở chủ đề mới
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </SectionState>

      {/* Modal: Mở chủ đề mới */}
      <Modal open={open} onClose={() => setOpen(false)} title="Mở chủ đề thảo luận">
        <form className="space-y-4" onSubmit={(e) => void createTopic(e)}>
          <Field label="Lớp học thảo luận">
            <SearchableSelect
              aria-label="Tìm và chọn lớp mở chủ đề"
              onChange={(value) => setForm({ ...form, classId: value })}
              options={classes.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
                description: item.term,
                keywords: item.id,
              }))}
              placeholder="Gõ mã hoặc tên lớp để lọc…"
              value={form.classId}
            />
          </Field>
          <Field label="Tiêu đề chủ đề">
            <input
              className={inputClass}
              placeholder="Ví dụ: Thắc mắc bài tập tuần 3..."
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Nội dung thảo luận">
            <textarea
              className={inputClass}
              minLength={5}
              placeholder="Nêu rõ câu hỏi, thắc mắc hoặc chủ đề muốn trao đổi cùng lớp..."
              required
              rows={4}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>
          <Field label="Thẻ phân loại (ngăn cách bằng dấu phẩy)">
            <input
              className={inputClass}
              placeholder="DevOps, Docker, HỏiĐáp..."
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </Field>
          {instructor ? (
            <label className="flex min-h-10 items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
              <input
                className="size-4 accent-sky-600"
                type="checkbox"
                checked={form.isPinned}
                onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
              />
              Ghim chủ đề này lên đầu danh sách lớp
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button disabled={!form.classId || !form.title.trim()} type="submit">
              Tạo chủ đề
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Báo cáo nội dung */}
      <Modal open={Boolean(reportTarget)} onClose={() => setReportTarget(null)} title="Báo cáo nội dung vi phạm" description="Ban quản lý sẽ nhận đúng chủ đề, lý do và mô tả để đối soát và xử lý an toàn.">
        <form className="space-y-4" onSubmit={(event) => void report(event)}>
          <Field label="Lý do báo cáo">
            <select
              className={inputClass}
              value={reportForm.reason}
              onChange={(event) => setReportForm({ ...reportForm, reason: event.target.value })}
            >
              <option>Nội dung không phù hợp</option>
              <option>Spam</option>
              <option>Quấy rối hoặc ngôn từ thù địch</option>
              <option>Thông tin sai lệch hoặc vi phạm bản quyền</option>
            </select>
          </Field>
          <Field label="Mô tả chi tiết / Bằng chứng">
            <textarea
              className={inputClass}
              minLength={3}
              placeholder="Mô tả cụ thể nội dung vi phạm..."
              required
              rows={4}
              value={reportForm.details}
              onChange={(event) => setReportForm({ ...reportForm, details: event.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setReportTarget(null)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button type="submit">
              <Flag size={14} /> Gửi báo cáo
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Hồ sơ kiểm duyệt nội dung của Quản trị viên */}
      <Modal open={Boolean(moderationTarget)} onClose={() => { setModerationTarget(null); setModerationContext(null); }} title="Hồ sơ kiểm duyệt nội dung" description="Đọc kỹ nội dung trong ngữ cảnh hội thoại trước khi ban hành biện pháp xử lý.">
        {moderationContext ? (
          <form className="space-y-4" onSubmit={(event) => void resolve(event)}>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 text-xs sm:text-sm leading-relaxed space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="font-bold text-slate-900 dark:text-slate-100">{moderationContext.topicTitle}</strong>
                <StatusBadge status={moderationTarget?.status ?? "IN_REVIEW"} />
              </div>
              <p className="text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                {moderationContext.targetBody}
              </p>
              <p className="text-[11px] text-slate-400">
                Người đăng: {moderationContext.targetAuthorId} · Lớp: {moderationContext.classId} · {moderationContext.surroundingPosts.length} phản hồi ngữ cảnh
              </p>
            </div>

            {moderationTarget?.appealReason ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
                <strong>Kháng nghị từ người dùng:</strong> {moderationTarget.appealReason}
              </div>
            ) : null}

            <Field label="Quyết định kiểm duyệt">
              <select
                className={inputClass}
                value={moderationForm.action}
                onChange={(event) => setModerationForm({ ...moderationForm, action: event.target.value })}
              >
                <option value="HIDE_CONTENT">Ẩn nội dung vi phạm</option>
                <option value="KEEP_CONTENT">Giữ nội dung / Bác bỏ báo cáo</option>
                <option value="ESCALATE_ADMIN">Chuyển cấp quản trị hệ thống</option>
              </select>
            </Field>

            <Field label="Kết luận và căn cứ xử lý">
              <textarea
                className={inputClass}
                minLength={3}
                placeholder="Ghi rõ lý do quyết định kiểm duyệt..."
                required
                rows={3}
                value={moderationForm.resolution}
                onChange={(event) => setModerationForm({ ...moderationForm, resolution: event.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => { setModerationTarget(null); setModerationContext(null); }} type="button" variant="secondary">
                Đóng
              </Button>
              <Button loading={submitting} type="submit">
                <ShieldCheck size={15} /> Lưu kết quả
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs sm:text-sm text-slate-400 py-6 text-center">Đang tải ngữ cảnh báo cáo…</p>
        )}
      </Modal>

      {/* Modal: Kháng nghị kết quả */}
      <Modal open={Boolean(appealTarget)} onClose={() => setAppealTarget(null)} title="Kháng nghị quyết định kiểm duyệt" description="Mỗi báo cáo chỉ được kháng nghị một lần; ban quản lý sẽ xem xét lại hồ sơ khách quan.">
        <form className="space-y-4" onSubmit={(event) => void appeal(event)}>
          <Field label="Lý do kháng nghị">
            <textarea
              className={inputClass}
              minLength={10}
              placeholder="Trình bày căn cứ hoặc giải thích lý do nội dung của bạn không vi phạm..."
              required
              rows={4}
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAppealTarget(null)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button loading={submitting} type="submit">
              Gửi kháng nghị
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Chỉnh sửa phản hồi */}
      <Modal open={Boolean(editingPost)} onClose={() => setEditingPost(null)} title="Chỉnh sửa phản hồi">
        <form className="space-y-4" onSubmit={(event) => void updatePost(event)}>
          <Field label="Nội dung phản hồi">
            <textarea
              className={inputClass}
              minLength={2}
              required
              rows={4}
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setEditingPost(null)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button type="submit">
              <Pencil size={14} /> Lưu chỉnh sửa
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Điều phối chủ đề (Khóa / Ghim) */}
      <Modal open={Boolean(topicAction)} onClose={() => setTopicAction(null)} title={topicAction?.label ?? "Điều phối chủ đề"} description="Hành động này được lưu trữ trong nhật ký kiểm soát của hệ thống.">
        <form className="space-y-4" onSubmit={(event) => void moderateTopic(event)}>
          <Field label="Lý do điều phối">
            <textarea
              className={inputClass}
              minLength={5}
              placeholder="Ghi rõ lý do thực hiện thao tác này..."
              required
              rows={3}
              value={topicReason}
              onChange={(event) => setTopicReason(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setTopicAction(null)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button type="submit">
              <ShieldCheck size={14} /> Xác nhận
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Ẩn phản hồi vi phạm */}
      <Modal open={Boolean(hideTarget)} onClose={() => setHideTarget(null)} title="Ẩn phản hồi vi phạm" description="Nội dung sẽ bị ẩn khỏi các thành viên khác nhưng cấu trúc thảo luận vẫn được bảo toàn.">
        <form className="space-y-4" onSubmit={(event) => void hidePost(event)}>
          <Field label="Lý do kiểm duyệt">
            <textarea
              className={inputClass}
              minLength={5}
              placeholder="Ghi nhận lý do ẩn phản hồi..."
              required
              rows={3}
              value={hideReason}
              onChange={(event) => setHideReason(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setHideTarget(null)} type="button" variant="secondary">
              Hủy
            </Button>
            <Button variant="danger" type="submit">
              <EyeOff size={14} /> Ẩn phản hồi
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
