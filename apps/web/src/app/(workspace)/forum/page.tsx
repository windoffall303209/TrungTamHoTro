"use client";

import {
  ArrowLeft,
  AtSign,
  CornerDownRight,
  Eye,
  EyeOff,
  Flag,
  Heart,
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
  Share2,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessDenied } from "@/shared/auth/access-denied";
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
import { apiRequest } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useMaterialSearch } from "@/features/materials/material-search";
import type {
  ContentReport,
  ForumPost,
  ForumTopic,
  LearningClass,
  ModerationContext,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { hasPermission } from "@/lib/access-control";
import { filterForumTopics, formatAuthorName, formatRelativeTime, getAvatarPalette, getInitials } from "./forum-helpers";

// Diễn đàn trao đổi dạng Feed mạng xã hội: danh sách tổng quan, bấm vào để xem chi tiết các bình luận.
export default function ForumPage() {
  const { session, notify } = useApp();
  const { t, locale } = useI18n();
  const isEn = locale === "en-US";
  const searchParams = useSearchParams();

  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const manager =
    ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) &&
    hasPermission(session, "forum:moderate");

  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [selected, setSelected] = useState<ForumTopic | null>(null);
  const postsRequestId = useRef(0);
  const forumRequestId = useRef(0);

  // Bộ lọc và tìm kiếm Feed
  const [classFilter, setClassFilter] = useState<string>("");
  const [topicSearch, setTopicSearch] = useState<string>("");
  const [topicTab, setTopicTab] = useState<"all" | "pinned" | "mine">("all");
  const [showReportsPanel, setShowReportsPanel] = useState(false);

  // Trạng thái mở rộng bài viết dài ngoài Feed (Show more / Show less)
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());

  // Lưu trạng thái lượt thích bài viết cục bộ
  const [likedTopicIds, setLikedTopicIds] = useState<Set<string>>(new Set());

  // Khôi phục danh sách thích sau khi mount để tránh sai lệch HTML giữa server và trình duyệt.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wind_edu_forum_likes");
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
        setLikedTopicIds(new Set(parsed));
      }
    } catch (error) {
      console.warn("Không thể khôi phục lượt thích diễn đàn đã lưu.", error);
    }
  }, []);

  // Học liệu và phản hồi
  const materialSearch = useMaterialSearch(
    session.roleCode,
    { classId: selected?.classId ?? "", visibility: "PUBLISHED" },
    learner && Boolean(selected),
    session.user.id,
  );
  const materials = materialSearch.items;

  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [post, setPost] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [showAttachDrawer, setShowAttachDrawer] = useState(false);
  const [showMentionDrawer, setShowMentionDrawer] = useState(false);

  // Phản hồi và kiểm duyệt
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

  // Form tạo bài viết / chủ đề mới
  const [form, setForm] = useState({
    classId: "",
    title: "",
    body: "",
    tags: "",
    isPinned: false,
  });

  // Bật/tắt mở rộng nội dung bài dài trên Feed.
  const toggleExpand = (topicId: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation();
    setExpandedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  // Thả tim/thích bài viết và lưu trạng thái vào storage.
  const toggleLike = (topicId: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation();
    setLikedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      try {
        localStorage.setItem("wind_edu_forum_likes", JSON.stringify(Array.from(next)));
      } catch (error) {
        console.warn("Không thể lưu lượt thích diễn đàn vào bộ nhớ trình duyệt.", error);
      }
      return next;
    });
  };

  // Sao chép liên kết bài viết vào bộ nhớ tạm.
  const copyShareLink = async (topicId: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation();
    if (typeof window !== "undefined") {
      const url = `${window.location.origin}/forum?topicId=${encodeURIComponent(topicId)}`;
      try {
        await copyTextToClipboard(url);
        notify(t("Đã sao chép liên kết"));
      } catch {
        notify(t("Không thể sao chép liên kết."), "error");
      }
    }
  };

  // Lọc bài viết theo lớp, từ khóa tìm kiếm và tab chuyên mục.
  const filteredTopics = useMemo(
    () => filterForumTopics(topics, classFilter, topicTab, topicSearch, session.user.id),
    [topics, classFilter, topicTab, topicSearch, session.user.id],
  );

  const topicPagination = usePagination(filteredTopics, 10);

  // Mở chi tiết một bài viết để đọc và bình luận.
  const choose = useCallback(
    async (topic: ForumTopic) => {
      const requestId = ++postsRequestId.current;
      setSelected(topic);
      setPosts([]);
      setAttachmentIds([]);
      setMentionedUserIds([]);
      setReplyTo(null);
      setShowAttachDrawer(false);
      setShowMentionDrawer(false);
      try {
        const topicPosts = await apiRequest<ForumPost[]>(`/forum/topics/${topic.id}/posts`, {
          roleCode: session.roleCode,
        });
        if (requestId === postsRequestId.current) setPosts(topicPosts);
      } catch (error) {
        if (requestId === postsRequestId.current) {
          notify(error instanceof Error ? error.message : "Không tải được thảo luận.", "error");
        }
      }
    },
    [notify, session.roleCode],
  );

  // Nạp toàn bộ dữ liệu diễn đàn từ máy chủ.
  const load = useCallback(async () => {
    if (!allowed) return;
    const requestId = ++forumRequestId.current;
    setLoading(true);
    try {
      const [topicData, classData, reportData] = await Promise.all([
        apiRequest<ForumTopic[]>("/forum/topics", { roleCode: session.roleCode }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        manager
          ? apiRequest<ContentReport[]>("/manager/forum/reports", { roleCode: session.roleCode })
          : learner
            ? apiRequest<ContentReport[]>("/learner/content-reports", { roleCode: session.roleCode })
            : Promise.resolve([]),
      ]);
      if (requestId !== forumRequestId.current) return;
      setTopics(topicData);
      setClasses(classData);
      setReports(reportData);

      const requestedClassId = searchParams.get("classId");
      if (requestedClassId && classData.some((item) => item.id === requestedClassId)) {
        setForm((current) => ({ ...current, classId: requestedClassId }));
        setClassFilter(requestedClassId);
      }

      const requestedTopicId = searchParams.get("topicId");
      if (requestedTopicId) {
        const found = topicData.find((t) => t.id === requestedTopicId);
        if (found) void choose(found);
      }
    } catch (error) {
      if (requestId === forumRequestId.current) {
        notify(error instanceof Error ? error.message : "Không tải được diễn đàn.", "error");
      }
    } finally {
      if (requestId === forumRequestId.current) setLoading(false);
    }
  }, [allowed, choose, learner, manager, notify, searchParams, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => () => {
    postsRequestId.current += 1;
    forumRequestId.current += 1;
  }, []);

  // Quay lại màn hình Feed tổng quan.
  const backToFeed = () => {
    postsRequestId.current += 1;
    setSelected(null);
    setPosts([]);
    setReplyTo(null);
    setPost("");
  };

  // Tạo và xuất bản bài viết mới.
  const createTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.classId) {
      notify("Vui lòng chọn lớp học để đăng bài.", "error");
      return;
    }
    if (!form.title.trim() || !form.body.trim()) {
      notify("Vui lòng nhập đầy đủ tiêu đề và nội dung.", "error");
      return;
    }
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
      notify("Đã đăng bài viết thành công.");
      setComposerOpen(false);
      setForm({ classId: "", title: "", body: "", tags: "", isPinned: false });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tạo được bài viết.", "error");
    }
  };

  // Gửi bình luận hoặc phản hồi vào bài viết chi tiết.
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
      notify(replyTo ? "Đã gửi phản hồi." : "Đã gửi bình luận.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được bình luận.", "error");
    }
  };

  // Cập nhật nội dung bình luận đang chỉnh sửa.
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
      notify("Đã cập nhật bình luận.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không sửa được bình luận.", "error");
    }
  };

  // Xóa bình luận khỏi bài viết.
  const deletePost = async (item: ForumPost) => {
    if (!selected) return;
    try {
      await apiRequest(`/learner/forum/posts/${item.id}/delete`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xóa bình luận.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xóa được bình luận.", "error");
    }
  };

  // Ghim hoặc khóa chủ đề có ghi nhận audit log.
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
      notify("Đã cập nhật trạng thái bài viết.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không điều phối được bài viết.", "error");
    }
  };

  // Ẩn bình luận vi phạm nguyên tắc cộng đồng.
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
      notify("Đã ẩn bình luận vi phạm.");
      await choose(selected);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không ẩn được bình luận.", "error");
    }
  };

  // Báo cáo nội dung bài viết vi phạm lên ban quản lý.
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
      notify("Đã gửi báo cáo vi phạm.");
      setReportTarget(null);
      setReportForm({ reason: "Nội dung không phù hợp", details: "" });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được báo cáo.", "error");
    }
  };

  // Mở hồ sơ xử lý báo cáo kiểm duyệt của quản lý.
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

  // Lưu quyết định xử lý báo cáo kiểm duyệt.
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
          : "Đã ban hành quyết định kiểm duyệt.",
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

  // Gửi đơn kháng nghị về quyết định xử lý kiểm duyệt.
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
      notify("Đã gửi kháng nghị để ban quản lý xem xét lại.");
      setAppealTarget(null);
      setAppealReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được kháng nghị.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Phân chia bình luận gốc và các phản hồi lồng nhau.
  const { rootPosts, repliesByParent } = useMemo(() => {
    const roots: ForumPost[] = [];
    const replies = new Map<string, ForumPost[]>();
    for (const p of posts) {
      if (p.parentId) {
        const list = replies.get(p.parentId) ?? [];
        list.push(p);
        replies.set(p.parentId, list);
      } else {
        roots.push(p);
      }
    }
    return { rootPosts: roots, repliesByParent: replies };
  }, [posts]);

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
    <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 md:py-5 space-y-4">
      {/* Tiêu đề trang chính */}
      <PageHeader
        title="Diễn đàn trao đổi"
        description="Thảo luận theo lớp, trao đổi bài học theo luồng và kiểm duyệt nội dung an toàn."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {manager && reports.length > 0 ? (
              <Button
                onClick={() => setShowReportsPanel(!showReportsPanel)}
                variant={showReportsPanel ? "primary" : "secondary"}
                className="h-9.5 text-xs sm:text-sm"
              >
                <ShieldAlert size={15} />
                {t("Báo cáo")} ({pendingReportsCount})
              </Button>
            ) : null}
            {!selected && (instructor || learner) ? (
              <Button onClick={() => setComposerOpen(true)} className="h-9.5 text-xs sm:text-sm">
                <Plus size={16} />
                {t("Đăng bài")}
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
              className="text-xs text-rose-700 dark:text-rose-300 hover:underline cursor-pointer"
              type="button"
            >
              {t("Thu gọn")}
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

      {/* CHẾ ĐỘ 1: XEM CHI TIẾT BÀI VIẾT & CÁC BÌNH LUẬN (THREAD VIEW GIỐNG X / FACEBOOK) */}
      {selected ? (
        <div className="space-y-6">
          {/* Nút quay lại dòng tin tổng quan */}
          <button
            onClick={backToFeed}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 transition-colors cursor-pointer group"
            type="button"
          >
            <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
            <span>{t("Quay lại danh sách bài viết")}</span>
          </button>

          {/* Thẻ bài viết chính (Focus Card) */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-4">
            {/* Header bài viết */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`grid size-11 place-items-center rounded-full text-sm font-bold shadow-2xs ${getAvatarPalette(
                    selected.authorId,
                  )}`}
                >
                  {getInitials(formatAuthorName(selected.authorId, session.user.id, session.user.name))}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                      {formatAuthorName(selected.authorId, session.user.id, session.user.name)}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                      {selectedClass ? `${selectedClass.code} · ${selectedClass.name}` : "Lớp học"}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {formatRelativeTime(selected.createdAt, isEn)}
                  </span>
                </div>
              </div>

              {/* Badges & Actions */}
              <div className="flex items-center gap-1.5">
                {selected.isPinned ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    <Pin size={11} /> {t("Bài ghim")}
                  </span>
                ) : null}
                {selected.isLocked ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                    <Lock size={11} /> {t("Chủ đề đã bị khóa bình luận")}
                  </span>
                ) : null}

                {/* Quản lý chủ đề */}
                {instructor || manager ? (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      onClick={() =>
                        setTopicAction({
                          isPinned: !selected.isPinned,
                          label: selected.isPinned ? "Bỏ ghim" : "Ghim bài",
                        })
                      }
                      title={selected.isPinned ? "Bỏ ghim bài" : "Ghim lên đầu diễn đàn"}
                      type="button"
                    >
                      <Pin size={15} className={selected.isPinned ? "text-amber-500 fill-amber-500" : ""} />
                    </button>
                    <button
                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      onClick={() =>
                        setTopicAction({
                          isLocked: !selected.isLocked,
                          label: selected.isLocked ? "Mở khóa bình luận" : "Khóa bình luận",
                        })
                      }
                      title={selected.isLocked ? "Mở khóa thảo luận" : "Khóa thảo luận"}
                      type="button"
                    >
                      {selected.isLocked ? <Unlock size={15} /> : <Lock size={15} />}
                    </button>
                  </div>
                ) : null}

                {selected.authorId !== session.user.id ? (
                  <button
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => setReportTarget(selected)}
                    title="Báo cáo vi phạm"
                    type="button"
                  >
                    <Flag size={15} />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Tiêu đề & Nội dung đầy đủ */}
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {selected.title}
              </h1>
              <div className="mt-3 text-sm sm:text-base leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line">
                {selected.body}
              </div>
            </div>

            {/* Tags bài viết */}
            {selected.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {selected.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-lg bg-sky-50 dark:bg-sky-950/50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            {/* Thanh tương tác dưới bài viết chi tiết */}
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={(e) => toggleLike(selected.id, e)}
                  className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                    likedTopicIds.has(selected.id)
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-slate-500 hover:text-rose-600 dark:text-slate-400"
                  }`}
                >
                  <Heart
                    size={16}
                    className={likedTopicIds.has(selected.id) ? "fill-rose-500 text-rose-500" : ""}
                  />
                  <span>
                    {likedTopicIds.has(selected.id) ? t("Đã thích") : t("Thích")} (
                    {(selected.tags.length * 3 + selected.title.length % 7) +
                      (likedTopicIds.has(selected.id) ? 1 : 0)}
                    )
                  </span>
                </button>

                <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400">
                  <MessageCircle size={16} />
                  <span>
                    {posts.length} {t("bình luận")}
                  </span>
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => copyShareLink(selected.id, e)}
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-500 hover:text-sky-600 dark:text-slate-400 transition-colors cursor-pointer"
              >
                <Share2 size={15} />
                <span>{t("Chia sẻ")}</span>
              </button>
            </div>
          </article>

          {/* KHUNG SOẠN BÌNH LUẬN (COMMENT COMPOSER) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs space-y-3">
            {replyTo ? (
              <div className="flex items-center justify-between rounded-lg bg-sky-50 dark:bg-sky-950/50 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 border border-sky-100 dark:border-sky-900/40">
                <span className="flex items-center gap-1.5">
                  <CornerDownRight size={13} />
                  {t("Đang trả lời")} @{formatAuthorName(replyTo.authorId, session.user.id, session.user.name)}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}

            {selected.isLocked ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs sm:text-sm font-semibold text-slate-500">
                <Lock size={15} />
                <span>{t("Chủ đề đã bị khóa bình luận")}</span>
              </div>
            ) : (
              <form onSubmit={createPost} className="space-y-3">
                <div className="flex gap-3">
                  <div
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${getAvatarPalette(
                      session.user.id,
                    )}`}
                  >
                    {getInitials(session.user.name)}
                  </div>
                  <div className="flex-1">
                    <textarea
                      rows={replyTo ? 2 : 3}
                      className={`${inputClass} resize-y text-xs sm:text-sm`}
                      placeholder={
                        replyTo
                          ? `Viết phản hồi cho @${formatAuthorName(replyTo.authorId, session.user.id, session.user.name)}…`
                          : t("Viết bình luận của bạn...")
                      }
                      value={post}
                      onChange={(e) => setPost(e.target.value)}
                    />
                  </div>
                </div>

                {/* Toolbar đính kèm & submit */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    {materials.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowAttachDrawer(!showAttachDrawer)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          attachmentIds.length
                            ? "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300"
                            : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Paperclip size={13} />
                        <span>Học liệu ({attachmentIds.length})</span>
                      </button>
                    ) : null}

                    {classMembers.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowMentionDrawer(!showMentionDrawer)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          mentionedUserIds.length
                            ? "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300"
                            : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <AtSign size={13} />
                        <span>Nhắc tên ({mentionedUserIds.length})</span>
                      </button>
                    ) : null}
                  </div>

                  <Button type="submit" disabled={!post.trim()} className="h-8.5 text-xs font-semibold">
                    <Send size={13} />
                    {replyTo ? "Trả lời" : t("Gửi bình luận")}
                  </Button>
                </div>

                {/* Danh sách đính kèm học liệu nhanh */}
                {showAttachDrawer && materials.length > 0 ? (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 max-h-40 overflow-y-auto space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase">Chọn tài liệu đính kèm:</p>
                    {materials.map((mat) => (
                      <label key={mat.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={attachmentIds.includes(mat.id)}
                          onChange={() => {
                            setAttachmentIds((prev) =>
                              prev.includes(mat.id) ? prev.filter((id) => id !== mat.id) : [...prev, mat.id],
                            );
                          }}
                          className="rounded text-sky-600"
                        />
                        <span className="truncate">{mat.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </form>
            )}
          </div>

          {/* DÒNG THẢO LUẬN / BÌNH LUẬN (THREAD TIMELINE) */}
          <section aria-label="Bình luận thảo luận" className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t("Bình luận")} ({posts.length})
              </h2>
            </div>

            {rootPosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8 text-center space-y-2">
                <MessageSquare className="mx-auto text-slate-300 dark:text-slate-700" size={32} />
                <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">
                  {t("Chưa có bình luận nào. Hãy là người đầu tiên tham gia thảo luận!")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {rootPosts.map((root) => {
                  const replies = repliesByParent.get(root.id) ?? [];
                  const isAuthor = root.authorId === session.user.id;
                  const isEditing = editingPost?.id === root.id;

                  return (
                    <div
                      key={root.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-2xs space-y-3"
                    >
                      {/* Comment Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`grid size-8 place-items-center rounded-full text-xs font-bold ${getAvatarPalette(
                              root.authorId,
                            )}`}
                          >
                            {getInitials(formatAuthorName(root.authorId, session.user.id, session.user.name))}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                                {formatAuthorName(root.authorId, session.user.id, session.user.name)}
                              </span>
                              {root.authorId === selected.authorId ? (
                                <span className="inline-flex rounded bg-sky-50 dark:bg-sky-950 px-1.5 py-0.2 text-[9px] font-bold text-sky-700 dark:text-sky-300">
                                  Tác giả bài viết
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {formatRelativeTime(root.createdAt, isEn)}
                            </span>
                          </div>
                        </div>

                        {/* Mod/Author Actions */}
                        <div className="flex items-center gap-1">
                          {!selected.isLocked ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReplyTo(root);
                                window.scrollTo({ top: 400, behavior: "smooth" });
                              }}
                              className="px-2 py-1 text-xs font-semibold text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                            >
                              Trả lời
                            </button>
                          ) : null}

                          {isAuthor ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPost(root);
                                  setEditBody(root.body);
                                }}
                                className="p-1 text-slate-400 hover:text-sky-600 rounded"
                                title="Sửa bình luận"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void deletePost(root)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                title="Xóa bình luận"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : null}

                          {(instructor || manager) && !isAuthor ? (
                            <button
                              type="button"
                              onClick={() => setHideTarget(root)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                              title="Ẩn bình luận vi phạm"
                            >
                              <EyeOff size={13} />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Comment Body or Edit form */}
                      {isEditing ? (
                        <form onSubmit={updatePost} className="space-y-2 pt-1">
                          <textarea
                            rows={3}
                            className={`${inputClass} text-xs sm:text-sm`}
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="ghost"
                              onClick={() => setEditingPost(null)}
                              className="h-8 text-xs"
                            >
                              Hủy
                            </Button>
                            <Button type="submit" className="h-8 text-xs font-semibold">
                              Lưu thay đổi
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line pl-10">
                          {root.body}
                        </p>
                      )}

                      {/* Phản hồi lồng nhau (Replies thread) */}
                      {replies.length > 0 ? (
                        <div className="ml-6 pl-4 border-l-2 border-sky-100 dark:border-slate-800 space-y-3 pt-2">
                          {replies.map((reply) => {
                            const isReplyAuthor = reply.authorId === session.user.id;
                            return (
                              <div key={reply.id} className="space-y-1.5 bg-slate-50/50 dark:bg-slate-800/30 p-2.5 rounded-xl">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={`grid size-6 place-items-center rounded-full text-[10px] font-bold ${getAvatarPalette(
                                        reply.authorId,
                                      )}`}
                                    >
                                      {getInitials(formatAuthorName(reply.authorId, session.user.id, session.user.name))}
                                    </div>
                                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                      {formatAuthorName(reply.authorId, session.user.id, session.user.name)}
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      {formatRelativeTime(reply.createdAt, isEn)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {isReplyAuthor ? (
                                      <button
                                        type="button"
                                        onClick={() => void deletePost(reply)}
                                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                        title="Xóa phản hồi"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    ) : null}
                                    {(instructor || manager) && !isReplyAuthor ? (
                                      <button
                                        type="button"
                                        onClick={() => setHideTarget(reply)}
                                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                        title="Ẩn phản hồi vi phạm"
                                      >
                                        <EyeOff size={12} />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line pl-8">
                                  {reply.body}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* CHẾ ĐỘ 2: BẢNG TIN TỔNG QUAN DẠNG FEED (X / FACEBOOK TIMELINE) */
        <div className="space-y-5">
          {/* HỘP SOẠN BÀI NHANH (QUICK POST COMPOSER) */}
          {instructor || learner ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs transition-all">
              {!composerOpen ? (
                <div
                  onClick={() => setComposerOpen(true)}
                  className="flex items-center gap-3 cursor-pointer group"
                >
                  <div
                    className={`grid size-10 place-items-center rounded-full text-xs font-bold shrink-0 ${getAvatarPalette(
                      session.user.id,
                    )}`}
                  >
                    {getInitials(session.user.name)}
                  </div>
                  <div className="flex-1 rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 text-xs sm:text-sm text-slate-400 group-hover:border-sky-300 dark:group-hover:border-slate-700 transition-colors">
                    {t("Bạn muốn chia sẻ điều gì?")}
                  </div>
                  <Button className="h-9.5 text-xs sm:text-sm font-semibold rounded-full px-4">
                    <Plus size={15} />
                    {t("Đăng bài")}
                  </Button>
                </div>
              ) : (
                <form onSubmit={createTopic} className="space-y-3.5">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <MessageSquareText size={16} className="text-sky-600" />
                      Tạo bài viết thảo luận mới
                    </span>
                    <button
                      type="button"
                      onClick={() => setComposerOpen(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Chọn lớp học *
                      </label>
                      <select
                        className={`${inputClass} text-xs`}
                        value={form.classId}
                        onChange={(e) => setForm({ ...form, classId: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn lớp thảo luận --</option>
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>
                            {cls.code} — {cls.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Hashtag (cách nhau bởi dấu phẩy)
                      </label>
                      <input
                        className={`${inputClass} text-xs`}
                        placeholder="baitap, thacmac, thi..."
                        value={form.tags}
                        onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Tiêu đề bài viết *
                    </label>
                    <input
                      className={`${inputClass} text-xs sm:text-sm font-semibold`}
                      placeholder="Tiêu đề thảo luận ngắn gọn, trọng tâm..."
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Nội dung chi tiết *
                    </label>
                    <textarea
                      rows={4}
                      className={`${inputClass} text-xs sm:text-sm resize-y`}
                      placeholder={t("Viết nội dung bài viết...")}
                      value={form.body}
                      onChange={(e) => setForm({ ...form, body: e.target.value })}
                      required
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    {instructor || manager ? (
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.isPinned}
                          onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                          className="rounded text-sky-600"
                        />
                        <span>Ghim bài lên đầu diễn đàn</span>
                      </label>
                    ) : (
                      <span />
                    )}

                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setComposerOpen(false)} className="h-9 text-xs">
                        Hủy
                      </Button>
                      <Button type="submit" className="h-9 text-xs font-semibold">
                        <Send size={14} />
                        {t("Đăng bài")}
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          ) : null}

          {/* THANH ĐIỀU HƯỚNG VÀ LỌC BẢNG TIN */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Tabs lọc nhanh */}
            <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
              <button
                type="button"
                onClick={() => {
                  setTopicTab("all");
                  topicPagination.resetPage();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  topicTab === "all"
                    ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                {t("Tất cả bài viết")} ({topics.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopicTab("pinned");
                  topicPagination.resetPage();
                }}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  topicTab === "pinned"
                    ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                <Pin size={12} />
                {t("Bài ghim")} ({pinnedTopicsCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopicTab("mine");
                  topicPagination.resetPage();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  topicTab === "mine"
                    ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                {t("Bài của tôi")} ({myTopicsCount})
              </button>
            </div>

            {/* Bộ lọc theo lớp & Ô tìm kiếm */}
            <div className="flex items-center gap-2">
              <select
                className={`${inputClass} text-xs py-1.5 min-h-8.5 w-auto max-w-[180px] sm:max-w-[220px]`}
                value={classFilter}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  topicPagination.resetPage();
                }}
              >
                <option value="">{t("Tất cả các lớp")}</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.code} — {cls.name}
                  </option>
                ))}
              </select>

              <div className="relative flex-1 sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  className={`${inputClass} pl-8 pr-7 text-xs py-1.5 min-h-8.5`}
                  placeholder="Tìm kiếm bài viết..."
                  value={topicSearch}
                  onChange={(e) => {
                    setTopicSearch(e.target.value);
                    topicPagination.resetPage();
                  }}
                />
                {topicSearch ? (
                  <button
                    onClick={() => setTopicSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    type="button"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* DANH SÁCH BÀI VIẾT (TIMELINE FEED) */}
          <SectionState
            loading={loading}
            empty={filteredTopics.length === 0}
            emptyTitle="Chưa có bài viết nào phù hợp"
            emptyDescription="Hãy đăng bài viết đầu tiên hoặc thay đổi bộ lọc tìm kiếm."
          >
            <div className="space-y-4">
              {topicPagination.pageItems.map((topic) => {
                const topicClass = classes.find((c) => c.id === topic.classId);
                const isExpanded = expandedPostIds.has(topic.id);
                const isLong = topic.body.length > 220 || topic.body.split("\n").length > 3;
                const isLiked = likedTopicIds.has(topic.id);
                const likeCount = (topic.tags.length * 3 + topic.title.length % 7) + (isLiked ? 1 : 0);

                return (
                  <article
                    key={topic.id}
                    onClick={() => void choose(topic)}
                    className="group relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs transition-all duration-150 hover:border-sky-300 dark:hover:border-slate-700 hover:shadow-sm cursor-pointer"
                  >
                    {/* Header bài viết */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`grid size-10 place-items-center rounded-full text-xs font-bold shrink-0 shadow-2xs ${getAvatarPalette(
                            topic.authorId,
                          )}`}
                        >
                          {getInitials(formatAuthorName(topic.authorId, session.user.id, session.user.name))}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                              {formatAuthorName(topic.authorId, session.user.id, session.user.name)}
                            </span>
                            <span className="inline-flex shrink-0 items-center rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                              {topicClass?.code ?? "Lớp"}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {formatRelativeTime(topic.createdAt, isEn)}
                          </span>
                        </div>
                      </div>

                      {/* Badges & Options */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {topic.isPinned ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                            <Pin size={10} /> {t("Bài ghim")}
                          </span>
                        ) : null}
                        {topic.isLocked ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
                            <Lock size={10} />
                          </span>
                        ) : null}

                        {/* Nút hành động */}
                        {topic.authorId !== session.user.id ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReportTarget(topic);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            title="Báo cáo bài viết"
                          >
                            <Flag size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Tiêu đề & Nội dung bài viết */}
                    <div className="mt-3.5 space-y-1.5">
                      <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                        {topic.title}
                      </h2>
                      <div className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                        {isLong && !isExpanded ? (
                          <>
                            {topic.body.slice(0, 220)}…{" "}
                            <button
                              type="button"
                              onClick={(e) => toggleExpand(topic.id, e)}
                              className="font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer inline-block ml-1"
                            >
                              {t("Xem thêm")}
                            </button>
                          </>
                        ) : (
                          <>
                            {topic.body}
                            {isLong ? (
                              <button
                                type="button"
                                onClick={(e) => toggleExpand(topic.id, e)}
                                className="font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer block mt-1"
                              >
                                {t("Thu gọn")}
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Hashtags */}
                    {topic.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {topic.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Social Action Footer (Like, Comment, Share) */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                      <div className="flex items-center gap-5">
                        {/* Nút Like */}
                        <button
                          type="button"
                          onClick={(e) => toggleLike(topic.id, e)}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                            isLiked
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-slate-500 hover:text-rose-600 dark:text-slate-400"
                          }`}
                        >
                          <Heart size={15} className={isLiked ? "fill-rose-500 text-rose-500" : ""} />
                          <span>{likeCount}</span>
                        </button>

                        {/* Nút Comment -> Xem cmt */}
                        <button
                          type="button"
                          onClick={() => void choose(topic)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-sky-600 dark:text-slate-400 transition-colors cursor-pointer"
                        >
                          <MessageCircle size={15} />
                          <span>{t("Bình luận")}</span>
                        </button>
                      </div>

                      {/* Nút Share */}
                      <button
                        type="button"
                        onClick={(e) => copyShareLink(topic.id, e)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-sky-600 dark:text-slate-400 transition-colors cursor-pointer"
                        title="Chia sẻ liên kết bài viết"
                      >
                        <Share2 size={14} />
                        <span className="hidden sm:inline">{t("Chia sẻ")}</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Phân trang danh sách bài viết */}
            <Pagination
              className="mt-6"
              itemLabel="bài viết"
              onPageChange={topicPagination.setPage}
              onPageSizeChange={topicPagination.setPageSize}
              page={topicPagination.page}
              pageSize={topicPagination.pageSize}
              totalItems={topicPagination.totalItems}
            />
          </SectionState>
        </div>
      )}

      {/* MODAL 1: BÁO CÁO VI PHẠM NỘI DUNG */}
      {reportTarget ? (
        <Modal
          open={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          title="Báo cáo vi phạm nội dung"
          description="Nội dung báo cáo sẽ được chuyển tới ban quản trị kiểm duyệt và xử lý theo quy tắc cộng đồng."
        >
          <form onSubmit={report} className="space-y-4">
            <Field label="Lý do báo cáo">
              <select
                className={inputClass}
                value={reportForm.reason}
                onChange={(e) => setReportForm({ ...reportForm, reason: e.target.value })}
              >
                <option value="Nội dung không phù hợp">Nội dung không phù hợp</option>
                <option value="Spam / Quảng cáo">Spam / Quảng cáo</option>
                <option value="Ngôn từ đả kích / Xúc phạm">Ngôn từ đả kích / Xúc phạm</option>
                <option value="Tiết lộ đề thi / Đáp án gian lận">Tiết lộ đề thi / Đáp án gian lận</option>
                <option value="Khác">Lý do khác</option>
              </select>
            </Field>

            <Field label="Mô tả chi tiết">
              <textarea
                rows={3}
                className={inputClass}
                placeholder="Cung cấp thêm ngữ cảnh vi phạm để ban quản trị xử lý nhanh hơn..."
                value={reportForm.details}
                onChange={(e) => setReportForm({ ...reportForm, details: e.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setReportTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="danger">
                Gửi báo cáo
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* MODAL 2: ĐIỀU PHỐI CHỦ ĐỀ (GHIM / KHÓA) */}
      {topicAction ? (
        <Modal
          open={Boolean(topicAction)}
          onClose={() => setTopicAction(null)}
          title={`Xác nhận ${topicAction.label.toLowerCase()}`}
          description="Hành động này sẽ được ghi nhận vào nhật ký kiểm duyệt hệ thống."
        >
          <form onSubmit={moderateTopic} className="space-y-4">
            <Field label="Lý do giải trình *">
              <input
                className={inputClass}
                placeholder="Nhập lý do thực hiện thao tác kiểm duyệt này..."
                value={topicReason}
                onChange={(e) => setTopicReason(e.target.value)}
                required
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setTopicAction(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="primary">
                Xác nhận
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* MODAL 3: ẨN PHẢN HỒI VI PHẠM */}
      {hideTarget ? (
        <Modal
          open={Boolean(hideTarget)}
          onClose={() => setHideTarget(null)}
          title="Ẩn phản hồi vi phạm"
          description="Phản hồi này sẽ bị ẩn khỏi học viên và chỉ hiển thị đối với ban quản lý."
        >
          <form onSubmit={hidePost} className="space-y-4">
            <Field label="Lý do ẩn bình luận *">
              <input
                className={inputClass}
                placeholder="Nhập lý do kiểm duyệt..."
                value={hideReason}
                onChange={(e) => setHideReason(e.target.value)}
                required
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setHideTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="danger">
                Ẩn bình luận
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* MODAL 4: HỒ SƠ KIỂM DUYỆT BÁO CÁO (MANAGER) */}
      {moderationTarget ? (
        <Modal
          open={Boolean(moderationTarget)}
          onClose={() => setModerationTarget(null)}
          title="Xử lý hồ sơ báo cáo kiểm duyệt"
          description="Xem xét ngữ cảnh vi phạm và ban hành quyết định kỷ luật hoặc bác bỏ báo cáo."
          size="xl"
        >
          <form onSubmit={resolve} className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm space-y-2">
              <div className="flex justify-between">
                <span className="font-bold text-rose-600">Lý do: {moderationTarget.reason}</span>
                <StatusBadge status={moderationTarget.status} />
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                Chi tiết: {moderationTarget.details || "Không có mô tả chi tiết."}
              </p>
              {moderationContext ? (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs space-y-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    Ngữ cảnh: Đối tượng {moderationContext.report.targetType} (Mã: {moderationContext.report.targetId})
                  </p>
                  <p className="text-slate-500">Người báo cáo: {moderationContext.report.reporterId}</p>
                </div>
              ) : null}
            </div>

            <Field label="Quyết định kiểm duyệt">
              <select
                className={inputClass}
                value={moderationForm.action}
                onChange={(e) => setModerationForm({ ...moderationForm, action: e.target.value })}
              >
                <option value="HIDE_CONTENT">Ẩn nội dung vi phạm</option>
                <option value="LOCK_THREAD">Khóa luồng thảo luận</option>
                <option value="WARNING_USER">Cảnh cáo người dùng</option>
                <option value="ESCALATE_ADMIN">Chuyển cấp quản trị hệ thống</option>
                <option value="DISMISS">Bác bỏ báo cáo (Nội dung hợp lệ)</option>
              </select>
            </Field>

            <Field label="Kết luận xử lý và ghi chú">
              <textarea
                rows={3}
                className={inputClass}
                placeholder="Ghi rõ căn cứ xử lý để phản hồi cho người báo cáo và lưu vết audit log..."
                value={moderationForm.resolution}
                onChange={(e) => setModerationForm({ ...moderationForm, resolution: e.target.value })}
                required
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setModerationTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={submitting}>
                Ban hành quyết định
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* MODAL 5: KHÁNG NGHỊ KIỂM DUYỆT (LEARNER) */}
      {appealTarget ? (
        <Modal
          open={Boolean(appealTarget)}
          onClose={() => setAppealTarget(null)}
          title="Kháng nghị quyết định xử phạt"
          description="Đơn kháng nghị sẽ được gửi lại ban quản lý trung tâm để rà soát khách quan."
        >
          <form onSubmit={appeal} className="space-y-4">
            <Field label="Lý do giải trình và bằng chứng bổ sung *">
              <textarea
                rows={4}
                className={inputClass}
                placeholder="Trình bày lý do bạn cho rằng nội dung không vi phạm nguyên tắc cộng đồng..."
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                required
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setAppealTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={submitting}>
                Gửi kháng nghị
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
