"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  History,
  ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Send,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { UserAvatar } from "@/shared/ui/user-avatar";
import {
  FeedAttachmentImage,
  FeedPostFileList,
  FeedPostImageGrid,
  feedAttachmentPath,
  formatFeedFileSize,
} from "./class-feed-attachments";
import type {
  ClassFeedAuthorRole,
  ClassFeedComment,
  ClassFeedCommentsPage,
  ClassFeedLikeToggleResult,
  ClassFeedPost,
  ClassFeedPreferenceResult,
  ClassFeedViewProps,
} from "./class-feed-types";

const MAX_FEED_FILES = 5;
const MAX_FEED_FILE_BYTES = 10 * 1024 * 1024;
const FEED_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const FEED_FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/jpeg,image/png,image/webp,image/gif";

interface PendingUploadItem {
  id: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
}

/** Chuyển mã vai trò tác giả thành nhãn ngắn gọn hiển thị trên thẻ bài viết. */
function authorRoleLabel(role: ClassFeedAuthorRole): string {
  switch (role) {
    case "INSTRUCTOR":
      return "Giáo viên";
    case "CENTER_MANAGER":
      return "Quản lý";
    case "SYSTEM_ADMIN":
      return "Quản trị";
    default:
      return "Học sinh";
  }
}

/** Định dạng thời gian bài viết/bình luận từ mốc ISO thực tế của cơ sở dữ liệu. */
function formatFeedTimestamp(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) return "Vừa xong";
  if (diffMs >= 60_000 && diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)} phút trước`;
  }
  if (diffMs >= 3_600_000 && diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)} giờ trước`;
  }
  return date.toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

/** Tính tổng số bình luận gồm cả cấp 1 và các phản hồi con cấp 2 của bài viết (ưu tiên tổng thực từ DB). */
function countTotalComments(post: ClassFeedPost): number {
  const loadedCount =
    post.comments.length +
    post.comments.reduce((acc, comment) => acc + (comment.replies?.length ?? 0), 0);
  return typeof post.commentCount === "number"
    ? Math.max(post.commentCount, loadedCount)
    : loadedCount;
}

/** Tạo instance độc lập cho từng lớp để bản nháp và modal không rò sang lớp khác. */
export function ClassFeedView(props: ClassFeedViewProps) {
  return <ClassFeedContent key={props.classItem.id} {...props} />;
}

/** Bảng tin lớp dùng dữ liệu PostgreSQL thật: mọi thành viên đăng bài kèm ảnh/tệp, thích, bình luận 2 tầng và lịch sử chỉnh sửa. */
function ClassFeedContent({ classItem, teacherName = "Wind Fall" }: ClassFeedViewProps) {
  const { session, notify } = useApp();
  const { t, locale } = useI18n();
  const roleCode = session?.roleCode;
  const isClassClosed = classItem.status === "CLOSED";
  const canCreatePost =
    !isClassClosed &&
    (roleCode !== "LEARNER" || classItem.allowLearnerFeedPosting !== false);

  const currentUserName = useMemo(() => {
    return (
      session?.user?.name ||
      session?.user?.username ||
      (roleCode === "INSTRUCTOR" ? teacherName : "Học sinh")
    );
  }, [session, roleCode, teacherName]);

  const currentUserAvatarUrl = session?.user?.avatarUrl ?? null;

  const [posts, setPosts] = useState<ClassFeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);

  const [newPostContent, setNewPostContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingUploadItem[]>([]);
  const [posting, setPosting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<PendingUploadItem[]>([]);

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [activePostMenuId, setActivePostMenuId] = useState<string | null>(null);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [historyModalPostId, setHistoryModalPostId] = useState<string | null>(null);

  const [mainCommentText, setMainCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const mainCommentInputRef = useRef<HTMLInputElement>(null);

  const [replyingTo, setReplyingTo] = useState<{
    parentCommentId: string;
    replyToUserId: string;
    authorName: string;
  } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const feedRequestIdRef = useRef(0);
  const feedAbortRef = useRef<AbortController | null>(null);
  const commentsAbortRef = useRef<AbortController | null>(null);
  const likingPostIdsRef = useRef<Set<string>>(new Set());
  const likingCommentIdsRef = useRef<Set<string>>(new Set());
  const [commentsCursorByPost, setCommentsCursorByPost] = useState<Record<string, string | null>>({});
  const [loadingCommentsPostId, setLoadingCommentsPostId] = useState<string | null>(null);

  const selectedPost = useMemo(
    () => (selectedPostId ? posts.find((item) => item.id === selectedPostId) ?? null : null),
    [posts, selectedPostId],
  );
  const historyModalPost = useMemo(
    () => (historyModalPostId ? posts.find((item) => item.id === historyModalPostId) ?? null : null),
    [posts, historyModalPostId],
  );

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      for (const item of pendingFilesRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  /** Nạp danh sách bài viết bảng tin thật từ máy chủ, tự động hủy và bỏ qua phản hồi cũ khi đổi lớp hoặc bộ lọc. */
  const loadFeed = useCallback(
    async (showHidden = includeHidden) => {
      const requestId = ++feedRequestIdRef.current;
      feedAbortRef.current?.abort();
      const controller = new AbortController();
      feedAbortRef.current = controller;
      setLoading(true);
      setLoadError(null);
      try {
        const suffix = showHidden ? "?includeHidden=true" : "";
        const rows = await apiRequest<ClassFeedPost[]>(
          `/classes/${encodeURIComponent(classItem.id)}/feed${suffix}`,
          { roleCode, signal: controller.signal },
        );
        if (requestId !== feedRequestIdRef.current || controller.signal.aborted) return;
        setCommentsCursorByPost({});
        setPosts(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (requestId !== feedRequestIdRef.current || controller.signal.aborted) return;
        setLoadError(
          error instanceof Error ? error.message : "Không tải được bảng tin lớp.",
        );
      } finally {
        if (requestId === feedRequestIdRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [classItem.id, includeHidden, roleCode],
  );

  useEffect(() => {
    void loadFeed(includeHidden);
    return () => {
      feedRequestIdRef.current += 1;
      feedAbortRef.current?.abort();
    };
  }, [includeHidden, loadFeed]);

  /** Tải phân trang bình luận đầy đủ của bài viết khi bài có nhiều hơn số bình luận xem trước. */
  const loadPostComments = useCallback(
    async (postId: string, cursor?: string | null) => {
      commentsAbortRef.current?.abort();
      const controller = new AbortController();
      commentsAbortRef.current = controller;
      setLoadingCommentsPostId(postId);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const page = await apiRequest<ClassFeedCommentsPage>(
          `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}/comments?${params.toString()}`,
          { roleCode, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setCommentsCursorByPost((prev) => ({ ...prev, [postId]: page.nextCursor }));
        setPosts((current) =>
          current.map((item) => {
            if (item.id !== postId) return item;
            if (!cursor) {
              return {
                ...item,
                comments: page.items,
                commentCount: page.totalCount,
                commentsHasMore: Boolean(page.nextCursor),
              };
            }
            const existingIds = new Set(item.comments.map((cmt) => cmt.id));
            const appended = page.items.filter((cmt) => !existingIds.has(cmt.id));
            return {
              ...item,
              comments: [...item.comments, ...appended],
              commentCount: page.totalCount,
              commentsHasMore: Boolean(page.nextCursor),
            };
          }),
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          notify(
            error instanceof Error ? error.message : "Không thể gửi bình luận.",
            "error",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingCommentsPostId((prev) => (prev === postId ? null : prev));
        }
      }
    },
    [classItem.id, notify, roleCode],
  );

  useEffect(() => {
    if (!selectedPost?.id || !selectedPost.commentsHasMore) return;
    if (Object.prototype.hasOwnProperty.call(commentsCursorByPost, selectedPost.id)) return;
    void loadPostComments(selectedPost.id);
    return () => {
      commentsAbortRef.current?.abort();
    };
  }, [commentsCursorByPost, loadPostComments, selectedPost?.commentsHasMore, selectedPost?.id]);

  useEffect(() => {
    if (!selectedPostId && !historyModalPostId) return;
    /** Đóng hộp thoại bài viết hoặc lịch sử chỉnh sửa khi người dùng bấm phím Escape. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyModalPostId) setHistoryModalPostId(null);
      else if (selectedPostId) {
        setSelectedPostId(null);
        setReplyingTo(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyModalPostId, selectedPostId]);

  /** Hiển thị avatar chuẩn với chữ viết tắt dự phòng và ảnh đại diện thật từ API. */
  const renderAvatar = (
    name: string,
    avatarUrl?: string | null,
    sizeClass = "size-8",
    textClass = "text-xs",
  ) => (
    <UserAvatar
      name={name}
      avatarUrl={avatarUrl}
      className={`${sizeClass} ${textClass}`}
    />
  );

  /** Tiếp nhận ảnh hoặc tệp đính kèm người dùng chọn, kiểm tra giới hạn 5 tệp và 10 MB mỗi tệp. */
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;

    const remainingSlots = MAX_FEED_FILES - pendingFiles.length;
    if (remainingSlots <= 0) {
      notify("Mỗi bài viết chỉ được đính kèm tối đa 5 tệp.", "error");
      event.target.value = "";
      return;
    }

    const accepted: PendingUploadItem[] = [];
    for (const file of selected.slice(0, remainingSlots)) {
      if (file.size <= 0 || file.size > MAX_FEED_FILE_BYTES) {
        notify(`Tệp ${file.name} phải có dung lượng từ 1 byte đến 10 MB.`, "error");
        continue;
      }
      const isImage = file.type.startsWith("image/");
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }

    if (selected.length > remainingSlots) {
      notify("Chỉ giữ tối đa 5 tệp đính kèm trong một bài viết.", "info");
    }
    if (accepted.length) {
      setPendingFiles((current) => [...current, ...accepted].slice(0, MAX_FEED_FILES));
    }
    event.target.value = "";
  };

  /** Gỡ một tệp khỏi danh sách chờ đăng và thu hồi object URL nếu là ảnh xem trước. */
  const handleRemovePendingFile = (itemId: string) => {
    setPendingFiles((current) => {
      const target = current.find((item) => item.id === itemId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== itemId);
    });
  };

  /** Gửi bài viết mới kèm tệp đính kèm lên PostgreSQL và chỉ cập nhật danh sách khi máy chủ đã lưu. */
  const handleCreatePost = async () => {
    const trimmed = newPostContent.trim();
    if ((!trimmed && pendingFiles.length === 0) || posting || !canCreatePost) return;

    setPosting(true);
    try {
      const formData = new FormData();
      if (trimmed) formData.append("content", trimmed);
      for (const item of pendingFiles) {
        formData.append("files", item.file, item.file.name);
      }
      const created = await apiRequest<ClassFeedPost>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts`,
        {
          method: "POST",
          roleCode,
          body: formData,
        },
      );
      setPosts((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNewPostContent("");
      setPendingFiles((current) => {
        for (const item of current) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
        return [];
      });
      notify("Đã đăng bài viết mới lên bảng tin!", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không đăng được bài viết.",
        "error",
      );
    } finally {
      setPosting(false);
    }
  };

  /** Xóa bài viết khỏi cơ sở dữ liệu sau khi người dùng xác nhận. */
  const handleDeletePost = async (postId: string) => {
    if (!window.confirm(t("Bạn có chắc chắn muốn xóa bài viết này không?"))) return;
    setActivePostMenuId(null);
    try {
      await apiRequest(`/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        roleCode,
      });
      setPosts((current) => current.filter((item) => item.id !== postId));
      if (selectedPostId === postId) setSelectedPostId(null);
      if (historyModalPostId === postId) setHistoryModalPostId(null);
      notify("Đã xóa bài viết thành công.", "info");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể xóa bài viết.",
        "error",
      );
    }
  };

  /** Mở khung chỉnh sửa trực tiếp cho bài viết được chọn. */
  const handleStartEditPost = (post: ClassFeedPost) => {
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
    setActivePostMenuId(null);
  };

  /** Lưu nội dung chỉnh sửa bài viết lên máy chủ và đồng bộ lịch sử chỉnh sửa mới. */
  const handleSaveEditPost = async (postId: string) => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const updated = await apiRequest<ClassFeedPost>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}`,
        {
          method: "PATCH",
          roleCode,
          body: JSON.stringify({ content: editingPostContent.trim() }),
        },
      );
      setPosts((current) => current.map((item) => (item.id === postId ? updated : item)));
      setEditingPostId(null);
      notify("Đã cập nhật bài viết thành công.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể cập nhật bài viết.",
        "error",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  /** Bật/tắt lượt thích bài viết trên máy chủ và chặn nhấp đúp đồng thời trên cùng bài viết. */
  const handleToggleLikePost = async (postId: string) => {
    if (isClassClosed || likingPostIdsRef.current.has(postId)) return;
    likingPostIdsRef.current.add(postId);
    try {
      const result = await apiRequest<ClassFeedLikeToggleResult>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}/like`,
        { method: "POST", roleCode },
      );
      setPosts((current) =>
        current.map((item) =>
          item.id === postId
            ? { ...item, likes: result.likes, isLiked: result.isLiked }
            : item,
        ),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không cập nhật được lượt thích.",
        "error",
      );
    } finally {
      likingPostIdsRef.current.delete(postId);
    }
  };

  /** Lưu trạng thái ẩn hoặc theo dõi bài viết xuống cơ sở dữ liệu cho tài khoản hiện tại. */
  const handleUpdatePreference = async (
    post: ClassFeedPost,
    changes: { hidden?: boolean; following?: boolean },
  ) => {
    setActivePostMenuId(null);
    try {
      const result = await apiRequest<ClassFeedPreferenceResult>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(post.id)}/preferences`,
        {
          method: "PATCH",
          roleCode,
          body: JSON.stringify(changes),
        },
      );
      setPosts((current) => {
        if (result.isHidden && !includeHidden) {
          return current.filter((item) => item.id !== post.id);
        }
        return current.map((item) =>
          item.id === post.id
            ? { ...item, isHidden: result.isHidden, isFollowing: result.isFollowing }
            : item,
        );
      });
      if (changes.hidden === true) {
        if (selectedPostId === post.id && !includeHidden) setSelectedPostId(null);
        notify("Đã ẩn bài viết khỏi bảng tin.", "info");
      } else if (changes.hidden === false) {
        notify("Đã hiện lại bài viết trên bảng tin.", "info");
      } else if (changes.following !== undefined) {
        notify(
          result.isFollowing
            ? "Đã bật theo dõi bài viết."
            : "Đã tắt thông báo bài viết.",
          "info",
        );
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được tùy chọn bài viết.",
        "error",
      );
    }
  };

  /** Mở khung phản hồi cho bình luận cấp 1 hoặc cấp 2 và tự động focus ô nhập. */
  const handleBeginReply = (
    parentCommentId: string,
    replyToUserId: string,
    authorName: string,
  ) => {
    setReplyingTo({ parentCommentId, replyToUserId, authorName });
    setReplyText("");
    window.setTimeout(() => replyInputRef.current?.focus(), 80);
  };

  /** Gửi bình luận cấp 1 mới lên máy chủ cho bài viết đang mở trong modal. */
  const handleAddMainComment = async () => {
    if (!selectedPost || !mainCommentText.trim() || submittingComment || isClassClosed) return;
    setSubmittingComment(true);
    try {
      const created = await apiRequest<ClassFeedComment>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(selectedPost.id)}/comments`,
        {
          method: "POST",
          roleCode,
          body: JSON.stringify({ content: mainCommentText.trim() }),
        },
      );
      setPosts((current) =>
        current.map((item) =>
          item.id === selectedPost.id
            ? {
                ...item,
                commentCount: countTotalComments(item) + 1,
                comments: [...item.comments, { ...created, replies: created.replies ?? [] }],
              }
            : item,
        ),
      );
      setMainCommentText("");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể gửi bình luận.",
        "error",
      );
    } finally {
      setSubmittingComment(false);
    }
  };

  /** Gửi phản hồi con cấp 2 gắn dưới bình luận cha tương ứng. */
  const handleAddReplyComment = async (parentCommentId: string) => {
    if (!selectedPost || !replyText.trim() || !replyingTo || submittingReply || isClassClosed) {
      return;
    }
    setSubmittingReply(true);
    try {
      const created = await apiRequest<ClassFeedComment>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(selectedPost.id)}/comments`,
        {
          method: "POST",
          roleCode,
          body: JSON.stringify({
            content: replyText.trim(),
            parentId: parentCommentId,
            replyToUserId: replyingTo.replyToUserId,
            replyToName: replyingTo.authorName,
          }),
        },
      );
      setPosts((current) =>
        current.map((item) =>
          item.id === selectedPost.id
            ? {
                ...item,
                commentCount: countTotalComments(item) + 1,
                comments: item.comments.map((comment) =>
                  comment.id === parentCommentId
                    ? {
                        ...comment,
                        replies: [...(comment.replies ?? []), created],
                      }
                    : comment,
                ),
              }
            : item,
        ),
      );
      setReplyText("");
      setReplyingTo(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể gửi phản hồi.",
        "error",
      );
    } finally {
      setSubmittingReply(false);
    }
  };

  /** Bật/tắt lượt thích cho bình luận cấp 1 hoặc phản hồi cấp 2 và chặn nhấp đúp đồng thời. */
  const handleToggleLikeComment = async (
    postId: string,
    commentId: string,
    isReply = false,
    parentId?: string,
  ) => {
    if (isClassClosed || likingCommentIdsRef.current.has(commentId)) return;
    likingCommentIdsRef.current.add(commentId);
    try {
      const result = await apiRequest<ClassFeedLikeToggleResult>(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`,
        { method: "POST", roleCode },
      );
      setPosts((current) =>
        current.map((post) => {
          if (post.id !== postId) return post;
          return {
            ...post,
            comments: post.comments.map((comment) => {
              if (!isReply && comment.id === commentId) {
                return { ...comment, likes: result.likes, isLiked: result.isLiked };
              }
              if (isReply && comment.id === parentId && comment.replies) {
                return {
                  ...comment,
                  replies: comment.replies.map((reply) =>
                    reply.id === commentId
                      ? { ...reply, likes: result.likes, isLiked: result.isLiked }
                      : reply,
                  ),
                };
              }
              return comment;
            }),
          };
        }),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không cập nhật được lượt thích bình luận.",
        "error",
      );
    } finally {
      likingCommentIdsRef.current.delete(commentId);
    }
  };

  /** Xóa bình luận cấp 1 hoặc phản hồi cấp 2 khi tài khoản có quyền. */
  const handleDeleteComment = async (
    postId: string,
    commentId: string,
    isReply = false,
    parentId?: string,
  ) => {
    if (!window.confirm(t("Bạn có chắc chắn muốn xóa bình luận này không?"))) return;
    try {
      await apiRequest(
        `/classes/${encodeURIComponent(classItem.id)}/feed/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE", roleCode },
      );
      setPosts((current) =>
        current.map((post) => {
          if (post.id !== postId) return post;
          if (!isReply) {
            const removedTop = post.comments.find((comment) => comment.id === commentId);
            const removedTotal = 1 + (removedTop?.replies?.length ?? 0);
            return {
              ...post,
              commentCount: Math.max(0, countTotalComments(post) - removedTotal),
              comments: post.comments.filter((comment) => comment.id !== commentId),
            };
          }
          return {
            ...post,
            commentCount: Math.max(0, countTotalComments(post) - 1),
            comments: post.comments.map((comment) =>
              comment.id === parentId
                ? {
                    ...comment,
                    replies: (comment.replies ?? []).filter((reply) => reply.id !== commentId),
                  }
                : comment,
            ),
          };
        }),
      );
      notify("Đã xóa bình luận.", "info");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể xóa bình luận.",
        "error",
      );
    }
  };

  /** Sao chép đường dẫn bài viết/bình luận vào clipboard để chia sẻ cho thành viên cùng lớp. */
  const handleShareCommentLink = async (postId: string, commentId: string, isReply = false) => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/courses/classes/${encodeURIComponent(classItem.id)}?tab=feed&postId=${encodeURIComponent(postId)}#comment-${encodeURIComponent(commentId)}`
        : "";
    try {
      if (url) await copyTextToClipboard(url);
      notify(
        isReply ? "Đã sao chép liên kết phản hồi!" : "Đã sao chép liên kết bình luận!",
        "info",
      );
    } catch {
      notify(
        isReply ? "Đã sao chép liên kết phản hồi!" : "Đã sao chép liên kết bình luận!",
        "info",
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* ================= KHUNG ĐĂNG BÀI VIẾT MỚI ================= */}
      {isClassClosed ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Lớp đã lưu trữ và chỉ cho phép đọc.
        </div>
      ) : !canCreatePost ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-4 py-3 text-xs font-medium text-slate-600 dark:text-slate-300">
          Giảng viên hiện tắt quyền đăng bài của học sinh trên bảng tin.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
          <div className="flex items-start gap-3">
            {renderAvatar(currentUserName, currentUserAvatarUrl, "size-9", "text-xs")}
            <div className="flex-1">
              <textarea
                value={newPostContent}
                onChange={(event) => setNewPostContent(event.target.value)}
                placeholder="Chia sẻ bài viết, câu hỏi hoặc thông báo với lớp học..."
                aria-label="Nội dung bài viết bảng tin"
                rows={2}
                maxLength={10_000}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Danh sách ảnh và tệp đính kèm đang chờ đăng */}
          {pendingFiles.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {pendingFiles.some((item) => item.isImage) && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles
                    .filter((item) => item.isImage)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="relative size-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 group"
                      >
                        {item.previewUrl ? (
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            className="size-full object-cover"
                          />
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Gỡ ${item.file.name}`}
                          onClick={() => handleRemovePendingFile(item.id)}
                          className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] cursor-pointer hover:bg-rose-600 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  {pendingFiles.length < MAX_FEED_FILES && (
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="size-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400 hover:text-blue-500 text-[10px] cursor-pointer"
                    >
                      <span>+ Thêm ảnh</span>
                      <span>
                        ({pendingFiles.length}/{MAX_FEED_FILES})
                      </span>
                    </button>
                  )}
                </div>
              )}

              {pendingFiles.some((item) => !item.isImage) && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles
                    .filter((item) => !item.isImage)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
                      >
                        <FileText size={14} className="text-blue-500 shrink-0" />
                        <span className="max-w-48 truncate font-medium">{item.file.name}</span>
                        <span className="text-[11px] text-slate-400">
                          {formatFeedFileSize(item.file.size)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Gỡ ${item.file.name}`}
                          onClick={() => handleRemovePendingFile(item.id)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <input
              type="file"
              ref={imageInputRef}
              accept={FEED_IMAGE_ACCEPT}
              multiple
              aria-label="Chọn ảnh đính kèm"
              className="hidden"
              onChange={handleFileSelect}
            />
            <input
              type="file"
              ref={fileInputRef}
              accept={FEED_FILE_ACCEPT}
              multiple
              aria-label="Chọn tệp đính kèm"
              className="hidden"
              onChange={handleFileSelect}
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={pendingFiles.length >= MAX_FEED_FILES || posting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <ImageIcon size={15} className="text-emerald-500" />
                <span>
                  Đính kèm ảnh ({pendingFiles.length}/{MAX_FEED_FILES})
                </span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingFiles.length >= MAX_FEED_FILES || posting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Paperclip size={15} className="text-blue-500" />
                <span>Đính kèm tệp</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCreatePost()}
              disabled={(!newPostContent.trim() && pendingFiles.length === 0) || posting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
            >
              {posting ? <Loader2 size={13} className="animate-spin" /> : null}
              <span>Đăng bài</span>
            </button>
          </div>
        </div>
      )}

      {/* Thanh công cụ gọn để làm mới bảng tin hoặc xem lại bài đã ẩn */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setIncludeHidden((current) => !current)}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          {includeHidden ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>{includeHidden ? "Ẩn các bài đã ẩn" : "Hiện bài đã ẩn"}</span>
        </button>
        <button
          type="button"
          onClick={() => void loadFeed(includeHidden)}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw size={13} />
          <span>Làm mới bảng tin</span>
        </button>
      </div>

      {/* ================= DANH SÁCH BÀI ĐĂNG BẢNG TIN ================= */}
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-8 text-center text-xs text-slate-500">
            Đang tải bảng tin...
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900/90 p-6 text-center space-y-2"
          >
            <p className="text-xs font-semibold text-rose-600">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadFeed(includeHidden)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8 text-center text-slate-400">
            <MessageSquare
              className="mx-auto mb-2 text-slate-300 dark:text-slate-600"
              size={32}
            />
            <p className="text-xs font-semibold">Chưa có bài đăng nào trong lớp học này</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Hãy là người đầu tiên chia sẻ bài viết hoặc câu hỏi lên bảng tin lớp!
            </p>
          </div>
        ) : (
          posts.map((post) => {
            const isExpanded = Boolean(expandedPostIds[post.id]);
            const isLongText = post.content.length > 180;
            const displayContent =
              isLongText && !isExpanded ? `${post.content.slice(0, 180)}...` : post.content;
            const totalCommentsCount = countTotalComments(post);
            const imageAttachments = post.attachments.filter((item) => item.isImage);
            const fileAttachments = post.attachments.filter((item) => !item.isImage);

            return (
              <article
                key={post.id}
                className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs space-y-3 ${
                  post.isHidden ? "opacity-75" : ""
                }`}
              >
                {/* Header bài viết */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {renderAvatar(post.authorName, post.authorAvatarUrl, "size-9", "text-xs")}
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <strong className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {post.authorName}
                        </strong>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                          {authorRoleLabel(post.authorRole)}
                        </span>
                        {post.isHidden && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-semibold">
                            Đã ẩn
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {formatFeedTimestamp(post.createdAt, locale)}
                        {post.isEdited ? " · Đã chỉnh sửa" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Menu 3 chấm bài viết */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Tùy chọn bài viết"
                      onClick={() =>
                        setActivePostMenuId(activePostMenuId === post.id ? null : post.id)
                      }
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {activePostMenuId === post.id && (
                      <div
                        className="absolute right-0 top-8 z-30 w-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl py-1 text-xs text-slate-700 dark:text-slate-200"
                        onMouseLeave={() => setActivePostMenuId(null)}
                      >
                        {post.canDelete && !isClassClosed && (
                          <button
                            type="button"
                            onClick={() => void handleDeletePost(post.id)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-left transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                            <span>Xóa bài viết</span>
                          </button>
                        )}

                        {post.canEdit && !isClassClosed && (
                          <button
                            type="button"
                            onClick={() => handleStartEditPost(post)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                          >
                            <Edit3 size={14} />
                            <span>Sửa bài viết</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdatePreference(post, { hidden: !post.isHidden })
                          }
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          {post.isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                          <span>{post.isHidden ? "Hiện lại bài viết" : "Ẩn bài viết"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdatePreference(post, { following: !post.isFollowing })
                          }
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <Bell
                            size={14}
                            className={post.isFollowing ? "text-blue-600" : ""}
                          />
                          <span>
                            {post.isFollowing ? "Tắt thông báo bài viết" : "Theo dõi bài viết"}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setHistoryModalPostId(post.id);
                            setActivePostMenuId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <History size={14} />
                          <span>Lịch sử chỉnh sửa</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Nội dung bài viết hoặc khung chỉnh sửa */}
                {editingPostId === post.id ? (
                  <div className="space-y-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-blue-400">
                    <textarea
                      value={editingPostContent}
                      onChange={(event) => setEditingPostContent(event.target.value)}
                      aria-label="Chỉnh sửa nội dung bài viết"
                      maxLength={10_000}
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden resize-none"
                      rows={3}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingPostId(null)}
                        className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={() => void handleSaveEditPost(post.id)}
                        className="px-3.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        Lưu thay đổi
                      </button>
                    </div>
                  </div>
                ) : post.content ? (
                  <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    <p className="whitespace-pre-wrap">{displayContent}</p>
                    {isLongText && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPostIds((prev) => ({ ...prev, [post.id]: !isExpanded }))
                        }
                        className="text-xs font-bold text-blue-600 hover:underline mt-1 cursor-pointer"
                      >
                        {isExpanded ? "Ẩn bớt" : "Xem thêm"}
                      </button>
                    )}
                  </div>
                ) : null}

                {/* Lưới ảnh đính kèm: bấm vào mở Modal bài viết nổi */}
                <FeedPostImageGrid
                  classId={classItem.id}
                  postId={post.id}
                  images={imageAttachments}
                  roleCode={roleCode}
                  onOpenPost={() => setSelectedPostId(post.id)}
                />

                {/* Tệp tài liệu đính kèm (PDF, DOCX, XLSX, PPTX, TXT) */}
                <FeedPostFileList
                  classId={classItem.id}
                  postId={post.id}
                  files={fileAttachments}
                  roleCode={roleCode}
                  onError={(message) => notify(message, "error")}
                />

                {/* Thống kê Like & Số lượng bình luận */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="size-4 rounded-full bg-blue-600 grid place-items-center text-white text-[9px]">
                      👍
                    </span>
                    <span>{post.likes}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPostId(post.id)}
                    className="hover:underline cursor-pointer"
                  >
                    {totalCommentsCount} bình luận
                  </button>
                </div>

                {/* Nút bấm Thích & Bình luận mở Modal */}
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <button
                    type="button"
                    disabled={isClassClosed}
                    onClick={() => void handleToggleLikePost(post.id)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer ${
                      post.isLiked ? "text-blue-600 dark:text-blue-400" : ""
                    }`}
                  >
                    <ThumbsUp size={15} fill={post.isLiked ? "currentColor" : "none"} />
                    <span>Thích</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPostId(post.id)}
                    className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <MessageCircle size={15} />
                    <span>Bình luận</span>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* ================= MODAL BÀI VIẾT NỔI VỚI BÌNH LUẬN ĐA TẦNG ================= */}
      {selectedPost && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Bài viết của ${selectedPost.authorName}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-5"
        >
          <div className="relative flex flex-col w-full max-w-2xl max-h-[92vh] rounded-2xl bg-[#1c1d22] border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            {/* Header Modal */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#26272e] border-b border-slate-700/80 shrink-0">
              <div className="w-8" />
              <h3 className="text-sm sm:text-base font-bold text-white text-center">
                Bài viết của {selectedPost.authorName}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại bài viết"
                onClick={() => {
                  setSelectedPostId(null);
                  setReplyingTo(null);
                }}
                className="size-8 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Nội dung chi tiết bài viết và Danh sách bình luận 2 tầng */}
            <div className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4">
              {/* Tác giả bài viết */}
              <div className="flex items-center gap-3">
                {renderAvatar(
                  selectedPost.authorName,
                  selectedPost.authorAvatarUrl,
                  "size-10",
                  "text-sm",
                )}
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <strong className="text-sm font-bold text-white">
                      {selectedPost.authorName}
                    </strong>
                    <span className="text-slate-400 text-xs">
                      trong {classItem.name || classItem.code}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {formatFeedTimestamp(selectedPost.createdAt, locale)}
                    {selectedPost.isEdited ? " · Đã chỉnh sửa" : ""}
                  </span>
                </div>
              </div>

              {/* Nội dung văn bản bài viết */}
              {selectedPost.content ? (
                <p className="text-sm text-slate-100 leading-relaxed font-normal whitespace-pre-wrap">
                  {selectedPost.content}
                </p>
              ) : null}

              {/* Toàn bộ hình ảnh trong modal bài viết nổi */}
              {selectedPost.attachments.some((item) => item.isImage) && (
                <div className="space-y-2">
                  {selectedPost.attachments
                    .filter((item) => item.isImage)
                    .map((image) => (
                      <div
                        key={image.id}
                        className="rounded-xl overflow-hidden border border-slate-700 bg-black/40"
                      >
                        <FeedAttachmentImage
                          alt={image.originalName}
                          path={feedAttachmentPath(
                            classItem.id,
                            selectedPost.id,
                            image.id,
                            true,
                          )}
                          roleCode={roleCode}
                          className="w-full max-h-96 object-contain"
                        />
                      </div>
                    ))}
                </div>
              )}

              {/* Tệp tài liệu đính kèm trong modal */}
              <FeedPostFileList
                classId={classItem.id}
                postId={selectedPost.id}
                files={selectedPost.attachments.filter((item) => !item.isImage)}
                roleCode={roleCode}
                dark
                onError={(message) => notify(message, "error")}
              />

              {/* Lượt tương tác bài viết */}
              <div className="pt-3 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
                <button
                  type="button"
                  disabled={isClassClosed}
                  onClick={() => void handleToggleLikePost(selectedPost.id)}
                  className={`inline-flex items-center gap-1.5 font-semibold transition-colors cursor-pointer ${
                    selectedPost.isLiked ? "text-blue-400" : "text-slate-300 hover:text-white"
                  }`}
                >
                  <ThumbsUp
                    size={14}
                    fill={selectedPost.isLiked ? "currentColor" : "none"}
                  />
                  <span>{selectedPost.likes}</span>
                </button>
                <span>{countTotalComments(selectedPost)} bình luận</span>
              </div>

              {/* ================= DANH SÁCH BÌNH LUẬN PHÂN CẤP ĐA TẦNG ================= */}
              <div className="pt-3 border-t border-slate-700/80 space-y-4">
                {selectedPost.comments.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Chưa có bình luận nào. Hãy là người đầu tiên để lại ý kiến của bạn!
                  </div>
                )}

                {selectedPost.comments.map((cmt) => (
                  <div key={cmt.id} className="space-y-3">
                    {/* BÌNH LUẬN CẤP 1 (CHA) */}
                    <div className="flex items-start gap-3 group">
                      {renderAvatar(
                        cmt.authorName,
                        cmt.authorAvatarUrl,
                        "size-8 sm:size-9",
                        "text-xs",
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <strong className="text-xs sm:text-sm font-bold text-white">
                            {cmt.authorName}
                          </strong>
                          <span className="text-[11px] text-slate-400">
                            · {formatFeedTimestamp(cmt.createdAt, locale)}
                          </span>
                          {cmt.isEdited && (
                            <span className="text-[10px] text-slate-400 italic">
                              · Đã chỉnh sửa
                            </span>
                          )}
                        </div>

                        <p className="text-xs sm:text-sm text-slate-100 leading-relaxed mt-0.5 whitespace-pre-wrap">
                          {cmt.content}
                        </p>

                        <div className="flex items-center gap-4 text-xs text-slate-400 mt-1.5">
                          <button
                            type="button"
                            disabled={isClassClosed}
                            onClick={() =>
                              void handleToggleLikeComment(selectedPost.id, cmt.id)
                            }
                            className={`inline-flex items-center gap-1 font-semibold transition-colors cursor-pointer ${
                              cmt.isLiked ? "text-blue-400" : "hover:text-slate-200"
                            }`}
                          >
                            <ThumbsUp
                              size={13}
                              fill={cmt.isLiked ? "currentColor" : "none"}
                            />
                            {cmt.likes > 0 && <span>{cmt.likes}</span>}
                          </button>

                          {!isClassClosed && (
                            <button
                              type="button"
                              onClick={() =>
                                handleBeginReply(cmt.id, cmt.authorId, cmt.authorName)
                              }
                              className="font-semibold text-slate-300 hover:text-white hover:underline transition-colors cursor-pointer"
                            >
                              Trả lời
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              void handleShareCommentLink(selectedPost.id, cmt.id, false)
                            }
                            className="font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                          >
                            Chia sẻ
                          </button>

                          {cmt.canDelete && !isClassClosed && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteComment(selectedPost.id, cmt.id, false)
                              }
                              className="font-semibold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                            >
                              Xóa
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* BÌNH LUẬN CẤP 2 (CÁC PHẢN HỒI CON THỤT LỀ) */}
                    {cmt.replies && cmt.replies.length > 0 && (
                      <div className="pl-8 sm:pl-11 space-y-3 relative before:absolute before:left-4 sm:before:left-5 before:top-1 before:bottom-3 before:w-[1.5px] before:bg-slate-700/60">
                        {cmt.replies.map((reply) => (
                          <div key={reply.id} className="flex items-start gap-2.5 group">
                            {renderAvatar(
                              reply.authorName,
                              reply.authorAvatarUrl,
                              "size-7 sm:size-8",
                              "text-[11px]",
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <strong className="text-xs font-bold text-white">
                                  {reply.authorName}
                                </strong>
                                <span className="text-[11px] text-slate-400">
                                  · {formatFeedTimestamp(reply.createdAt, locale)}
                                </span>
                              </div>

                              <p className="text-xs sm:text-sm text-slate-100 leading-relaxed mt-0.5 whitespace-pre-wrap">
                                {reply.replyToName && (
                                  <span className="font-semibold text-blue-400 mr-1.5">
                                    @{reply.replyToName}
                                  </span>
                                )}
                                <span>{reply.content}</span>
                              </p>

                              <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
                                <button
                                  type="button"
                                  disabled={isClassClosed}
                                  onClick={() =>
                                    void handleToggleLikeComment(
                                      selectedPost.id,
                                      reply.id,
                                      true,
                                      cmt.id,
                                    )
                                  }
                                  className={`inline-flex items-center gap-1 font-semibold transition-colors cursor-pointer ${
                                    reply.isLiked ? "text-blue-400" : "hover:text-slate-200"
                                  }`}
                                >
                                  <ThumbsUp
                                    size={12}
                                    fill={reply.isLiked ? "currentColor" : "none"}
                                  />
                                  {reply.likes > 0 && <span>{reply.likes}</span>}
                                </button>

                                {!isClassClosed && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleBeginReply(
                                        cmt.id,
                                        reply.authorId,
                                        reply.authorName,
                                      )
                                    }
                                    className="font-semibold text-slate-300 hover:text-white hover:underline transition-colors cursor-pointer"
                                  >
                                    Trả lời
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleShareCommentLink(
                                      selectedPost.id,
                                      reply.id,
                                      true,
                                    )
                                  }
                                  className="font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                                >
                                  Chia sẻ
                                </button>

                                {reply.canDelete && !isClassClosed && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteComment(
                                        selectedPost.id,
                                        reply.id,
                                        true,
                                        cmt.id,
                                      )
                                    }
                                    className="font-semibold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                                  >
                                    Xóa
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* KHUNG NHẬP PHẢN HỒI CON INLINE KHI BẤM "TRẢ LỜI" */}
                    {replyingTo?.parentCommentId === cmt.id && !isClassClosed && (
                      <div className="pl-8 sm:pl-11 mt-2">
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleAddReplyComment(cmt.id);
                          }}
                          className="flex items-center gap-2 p-2 rounded-2xl bg-[#26272e] border border-blue-500/50 shadow-md"
                        >
                          {renderAvatar(
                            currentUserName,
                            currentUserAvatarUrl,
                            "size-7 sm:size-8",
                            "text-[10px]",
                          )}
                          <div className="flex-1 flex items-center gap-1.5 min-w-0">
                            <span className="text-[11px] font-bold text-blue-400 whitespace-nowrap">
                              @{replyingTo.authorName}:
                            </span>
                            <input
                              ref={replyInputRef}
                              type="text"
                              value={replyText}
                              onChange={(event) => setReplyText(event.target.value)}
                              placeholder="Viết phản hồi công khai..."
                              aria-label="Viết phản hồi công khai"
                              maxLength={4_000}
                              className="w-full bg-transparent text-xs text-white placeholder:text-slate-400 focus:outline-hidden"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyText("");
                            }}
                            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title="Hủy phản hồi"
                          >
                            <X size={14} />
                          </button>

                          <button
                            type="submit"
                            aria-label="Gửi phản hồi"
                            disabled={!replyText.trim() || submittingReply}
                            className="p-1.5 rounded-full text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors cursor-pointer"
                          >
                            <Send size={15} />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))}

                {selectedPost.commentsHasMore && commentsCursorByPost[selectedPost.id] && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      disabled={loadingCommentsPostId === selectedPost.id}
                      onClick={() =>
                        void loadPostComments(
                          selectedPost.id,
                          commentsCursorByPost[selectedPost.id],
                        )
                      }
                      className="text-xs font-bold text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Xem thêm
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* THANH NHẬP BÌNH LUẬN CHÍNH DƯỚI CÙNG MODAL (CẤP 1) */}
            {!isClassClosed && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddMainComment();
                }}
                className="p-3 bg-[#26272e] border-t border-slate-700 flex items-center gap-2.5 shrink-0"
              >
                {renderAvatar(currentUserName, currentUserAvatarUrl, "size-8", "text-xs")}
                <input
                  ref={mainCommentInputRef}
                  type="text"
                  value={mainCommentText}
                  onChange={(event) => setMainCommentText(event.target.value)}
                  placeholder="Viết câu trả lời..."
                  aria-label="Viết câu trả lời"
                  maxLength={4_000}
                  className="flex-1 py-2 px-3.5 rounded-full bg-[#18191e] border border-slate-700 text-xs text-white placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                />
                <button
                  type="submit"
                  aria-label="Gửi bình luận"
                  disabled={!mainCommentText.trim() || submittingComment}
                  className="p-2 rounded-full text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <Send size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL LỊCH SỬ CHỈNH SỬA ================= */}
      {historyModalPost && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lịch sử chỉnh sửa"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-[#1c1d22] border border-slate-700 p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <History size={16} className="text-blue-400" />
                <span>Lịch sử chỉnh sửa</span>
              </div>
              <button
                type="button"
                aria-label="Đóng lịch sử chỉnh sửa"
                onClick={() => setHistoryModalPostId(null)}
                className="size-7 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto">
              <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                  <span>Phiên bản hiện tại</span>
                  <span className="text-emerald-400">Đang hiển thị</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {historyModalPost.content || "(Chỉ có tệp đính kèm)"}
                </p>
              </div>

              {historyModalPost.editHistories.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-2">
                  Bài viết chưa có lịch sử chỉnh sửa.
                </p>
              ) : (
                historyModalPost.editHistories.map((history) => (
                  <div
                    key={history.id}
                    className="p-3 rounded-xl bg-slate-800/40 border border-slate-700 space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Phiên bản cũ · {history.editorName}</span>
                      <span>{formatFeedTimestamp(history.editedAt, locale)}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {history.previousContent}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
