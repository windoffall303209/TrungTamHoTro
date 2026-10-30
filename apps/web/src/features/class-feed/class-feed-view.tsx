"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  MessageSquare,
  ThumbsUp,
  MessageCircle,
  Share2,
  Send,
  X,
  ImageIcon,
  MoreHorizontal,
  Trash2,
  Edit3,
  EyeOff,
  Bell,
  History,
  Flag,
  Smile,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import type { ClassPost, PostComment, ClassFeedViewProps } from "./class-feed-types";
import { loadClassFeedPosts, saveClassFeedPosts } from "./class-feed-storage";
import { UserAvatar } from "@/shared/ui/user-avatar";

/**
 * Component Bảng tin & Diễn đàn lớp học dùng chung cho cả Học sinh và Giáo viên
 * Hỗ trợ tạo bài viết kèm hình ảnh, tương tác Like, và hệ thống Bình luận phân cấp đa tầng (Nested Comments)
 * Dữ liệu được lưu trữ bền vững vào localStorage theo từng lớp học, giữ nguyên vẹn qua các lần F5 reload.
 */
export function ClassFeedView({ classItem, courseName, teacherName = "Wind Fall" }: ClassFeedViewProps) {
  const { session, notify } = useApp();

  // Xác định thông tin người dùng hiện tại đang đăng nhập
  const currentUserName = useMemo(() => {
    return session?.user?.name || session?.user?.username || (session?.roleCode === "INSTRUCTOR" ? teacherName : "Học sinh");
  }, [session, teacherName]);

  const currentUserAvatarUrl = session?.user?.avatarUrl || null;
  const currentUserRole = session?.roleCode === "INSTRUCTOR" ? "Giáo viên" : "Học sinh";
  const currentUserInitials = useMemo(() => {
    return (currentUserName || "WF")
      .split(" ")
      .filter(Boolean)
      .slice(-2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "WF";
  }, [currentUserName]);

  // Quản lý danh sách bài viết bảng tin
  const [posts, setPosts] = useState<ClassPost[]>([]);
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostImages, setNewPostImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal bài viết nổi và tương tác bình luận
  const [selectedPost, setSelectedPost] = useState<ClassPost | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [activePostMenuId, setActivePostMenuId] = useState<string | null>(null);
  const [hiddenPostIds, setHiddenPostIds] = useState<Record<string, boolean>>({});
  const [followingPostIds, setFollowingPostIds] = useState<Record<string, boolean>>({});

  // Chỉnh sửa bài viết
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState("");
  const [postEditHistories, setPostEditHistories] = useState<Record<string, Array<{ content: string; editedAt: string }>>>({});
  const [historyModalPost, setHistoryModalPost] = useState<ClassPost | null>(null);

  // Báo cáo bài viết
  const [reportModalPost, setReportModalPost] = useState<ClassPost | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);

  // Ô nhập bình luận chính trong Modal (cấp 1)
  const [mainCommentText, setMainCommentText] = useState("");
  const mainCommentInputRef = useRef<HTMLInputElement>(null);

  // Quản lý phản hồi bình luận con (cấp 2)
  const [replyingTo, setReplyingTo] = useState<{
    commentId: string;
    authorName: string;
  } | null>(null);
  const [replyText, setReplyText] = useState("");
  const replyInputRef = useRef<HTMLInputElement>(null);

  // Nạp dữ liệu bảng tin bền vững từ localStorage khi mount hoặc đổi lớp
  useEffect(() => {
    const loaded = loadClassFeedPosts(classItem.id, classItem.name, teacherName);
    setPosts(loaded);
  }, [classItem.id, classItem.name, teacherName]);

  // Cập nhật selectedPost đồng bộ với danh sách posts
  useEffect(() => {
    if (selectedPost) {
      const fresh = posts.find((p) => p.id === selectedPost.id);
      if (fresh) setSelectedPost(fresh);
    }
  }, [posts, selectedPost?.id]);

  /** Hàm tiện ích lưu danh sách bài viết cập nhật */
  const persistPosts = (updatedPosts: ClassPost[]) => {
    setPosts(updatedPosts);
    saveClassFeedPosts(classItem.id, updatedPosts);
  };

  /** Hiển thị Avatar chuẩn cho người dùng (có ảnh đại diện hoặc chữ viết tắt) */
  const renderAvatar = (
    name: string,
    avatarUrl?: string | null,
    sizeClass = "size-8",
    textClass = "text-xs"
  ) => {
    return (
      <UserAvatar
        name={name}
        avatarUrl={avatarUrl}
        className={`${sizeClass} ${textClass}`}
      />
    );
  };

  /** Xử lý đính kèm ảnh khi đăng bài (đọc thành data URL để lưu offline bền vững) */
  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remainingSlots = 5 - newPostImages.length;
    if (remainingSlots <= 0) {
      notify("Chỉ được đính kèm tối đa 5 hình ảnh trong một bài viết.", "error");
      return;
    }

    files.slice(0, remainingSlots).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          setNewPostImages((prev) => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    });

    if (e.target) e.target.value = "";
  };

  /** Đăng bài viết mới lên bảng tin */
  const handleCreatePost = () => {
    const trimmed = newPostContent.trim();
    if (!trimmed && newPostImages.length === 0) return;

    const newPost: ClassPost = {
      id: `post-${Date.now()}`,
      authorName: currentUserName,
      authorAvatar: currentUserInitials,
      authorAvatarUrl: currentUserAvatarUrl,
      authorRole: currentUserRole,
      createdAt: "Vừa xong",
      content: trimmed,
      images: newPostImages.length > 0 ? [...newPostImages] : undefined,
      likes: 0,
      isLiked: false,
      comments: [],
    };

    const updated = [newPost, ...posts];
    persistPosts(updated);
    setNewPostContent("");
    setNewPostImages([]);
    notify("Đã đăng bài viết mới lên bảng tin!", "success");
  };

  /** Xóa bài viết */
  const handleDeletePost = (postId: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa bài viết này không?")) return;
    const updated = posts.filter((p) => p.id !== postId);
    persistPosts(updated);
    if (selectedPost?.id === postId) setSelectedPost(null);
    notify("Đã xóa bài viết thành công.", "info");
  };

  /** Bắt đầu chỉnh sửa bài viết */
  const handleStartEditPost = (post: ClassPost) => {
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
    setActivePostMenuId(null);
  };

  /** Lưu nội dung chỉnh sửa bài viết */
  const handleSaveEditPost = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    // Lưu vào lịch sử chỉnh sửa
    const historyItem = {
      content: post.content,
      editedAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
    };
    setPostEditHistories((prev) => ({
      ...prev,
      [postId]: [historyItem, ...(prev[postId] || [])],
    }));

    const updated = posts.map((p) => {
      if (p.id === postId) {
        return {
          ...p,
          content: editingPostContent.trim(),
          isEdited: true,
        };
      }
      return p;
    });

    persistPosts(updated);
    setEditingPostId(null);
    notify("Đã cập nhật bài viết thành công.", "success");
  };

  /** Thích / Bỏ thích bài viết */
  const handleToggleLikePost = (postId: string) => {
    const updated = posts.map((p) => {
      if (p.id === postId) {
        const nextLiked = !p.isLiked;
        return {
          ...p,
          isLiked: nextLiked,
          likes: nextLiked ? p.likes + 1 : Math.max(0, p.likes - 1),
        };
      }
      return p;
    });
    persistPosts(updated);
  };

  /** Thêm bình luận cấp 1 vào bài viết */
  const handleAddMainComment = () => {
    if (!selectedPost || !mainCommentText.trim()) return;

    const newComment: PostComment = {
      id: `cmt-${Date.now()}`,
      authorName: currentUserName,
      authorAvatar: currentUserInitials,
      authorAvatarUrl: currentUserAvatarUrl,
      authorRole: currentUserRole,
      createdAt: "Vừa xong",
      content: mainCommentText.trim(),
      likes: 0,
      isLiked: false,
      replies: [],
    };

    const updated = posts.map((p) => {
      if (p.id === selectedPost.id) {
        return {
          ...p,
          comments: [...p.comments, newComment],
        };
      }
      return p;
    });

    persistPosts(updated);
    setMainCommentText("");
  };

  /** Thêm phản hồi con cấp 2 (Reply) theo hình mẫu Ảnh 2 */
  const handleAddReplyComment = (parentCommentId: string) => {
    if (!selectedPost || !replyText.trim() || !replyingTo) return;

    const newReply: PostComment = {
      id: `reply-${Date.now()}`,
      authorName: currentUserName,
      authorAvatar: currentUserInitials,
      authorAvatarUrl: currentUserAvatarUrl,
      authorRole: currentUserRole,
      createdAt: "Vừa xong",
      replyTo: replyingTo.authorName,
      content: replyText.trim(),
      likes: 0,
      isLiked: false,
    };

    const updated = posts.map((p) => {
      if (p.id === selectedPost.id) {
        return {
          ...p,
          comments: p.comments.map((c) => {
            if (c.id === parentCommentId) {
              return {
                ...c,
                replies: [...(c.replies || []), newReply],
              };
            }
            return c;
          }),
        };
      }
      return p;
    });

    persistPosts(updated);
    setReplyText("");
    setReplyingTo(null);
  };

  /** Thích / Bỏ thích bình luận (Cả cấp 1 và cấp 2) */
  const handleToggleLikeComment = (postId: string, commentId: string, isReply = false, parentId?: string) => {
    const updated = posts.map((p) => {
      if (p.id !== postId) return p;

      return {
        ...p,
        comments: p.comments.map((c) => {
          if (!isReply && c.id === commentId) {
            const nextLiked = !c.isLiked;
            return {
              ...c,
              isLiked: nextLiked,
              likes: nextLiked ? c.likes + 1 : Math.max(0, c.likes - 1),
            };
          }

          if (isReply && c.id === parentId && c.replies) {
            return {
              ...c,
              replies: c.replies.map((r) => {
                if (r.id === commentId) {
                  const nextLiked = !r.isLiked;
                  return {
                    ...r,
                    isLiked: nextLiked,
                    likes: nextLiked ? r.likes + 1 : Math.max(0, r.likes - 1),
                  };
                }
                return r;
              }),
            };
          }

          return c;
        }),
      };
    });

    persistPosts(updated);
  };

  return (
    <div className="space-y-4">
      {/* ================= KHUNG ĐĂNG BÀI VIẾT MỚI ================= */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
        <div className="flex items-start gap-3">
          {renderAvatar(currentUserName, currentUserAvatarUrl, "size-9", "text-xs")}
          <div className="flex-1">
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="Chia sẻ bài viết, câu hỏi hoặc thông báo với lớp học..."
              rows={2}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Danh sách ảnh đính kèm xem trước */}
        {newPostImages.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            {newPostImages.map((imgUrl, i) => (
              <div key={i} className="relative size-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 group">
                <img src={imgUrl} alt={`Ảnh đính kèm ${i + 1}`} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setNewPostImages(newPostImages.filter((_, idx) => idx !== i))}
                  className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] cursor-pointer hover:bg-rose-600 transition-colors"
                >
                  ✕
                </button>
              </div>
            ))}
            {newPostImages.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="size-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400 hover:text-blue-500 text-[10px] cursor-pointer"
              >
                <span>+ Thêm ảnh</span>
                <span>({newPostImages.length}/5)</span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageFileSelect}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ImageIcon size={15} className="text-emerald-500" />
            <span>Đính kèm ảnh ({newPostImages.length}/5)</span>
          </button>

          <button
            type="button"
            onClick={handleCreatePost}
            disabled={!newPostContent.trim() && newPostImages.length === 0}
            className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
          >
            Đăng bài
          </button>
        </div>
      </div>

      {/* ================= DANH SÁCH BÀI ĐĂNG BẢNG TIN ================= */}
      <div className="space-y-4">
        {posts.filter((p) => !hiddenPostIds[p.id]).length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-slate-400">
            <MessageSquare className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
            <p className="text-xs font-semibold">Chưa có bài đăng nào trong lớp học này</p>
            <p className="text-[11px] text-slate-400 mt-1">Hãy là người đầu tiên chia sẻ bài viết hoặc câu hỏi lên bảng tin lớp!</p>
          </div>
        )}

        {posts
          .filter((p) => !hiddenPostIds[p.id])
          .map((post) => {
            const isExpanded = Boolean(expandedPostIds[post.id]);
            const isLongText = post.content.length > 180;
            const displayContent = isLongText && !isExpanded ? `${post.content.slice(0, 180)}...` : post.content;
            const isOwner = post.authorName === currentUserName || session?.roleCode === "INSTRUCTOR";
            const totalCommentsCount =
              post.comments.length + post.comments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);

            return (
              <article
                key={post.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs space-y-3"
              >
                {/* Header bài viết */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {renderAvatar(post.authorName, post.authorAvatarUrl, "size-9", "text-xs")}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <strong className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {post.authorName}
                        </strong>
                        <span className="px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                          {post.authorRole}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">{post.createdAt}</span>
                    </div>
                  </div>

                  {/* Menu 3 chấm bài viết */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setActivePostMenuId(activePostMenuId === post.id ? null : post.id)}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {activePostMenuId === post.id && (
                      <div
                        className="absolute right-0 top-8 z-30 w-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl py-1 text-xs text-slate-700 dark:text-slate-200"
                        onMouseLeave={() => setActivePostMenuId(null)}
                      >
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => handleDeletePost(post.id)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-left transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                            <span>Xóa bài viết</span>
                          </button>
                        )}

                        {isOwner && (
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
                          onClick={() => {
                            setHiddenPostIds((prev) => ({ ...prev, [post.id]: true }));
                            setActivePostMenuId(null);
                            notify("Đã ẩn bài viết khỏi bảng tin.", "info");
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <EyeOff size={14} />
                          <span>Ẩn bài viết</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFollowingPostIds((prev) => ({ ...prev, [post.id]: !prev[post.id] }));
                            setActivePostMenuId(null);
                            notify(followingPostIds[post.id] ? "Đã tắt thông báo bài viết." : "Đã bật theo dõi bài viết.", "info");
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <Bell size={14} className={followingPostIds[post.id] ? "text-blue-600" : ""} />
                          <span>{followingPostIds[post.id] ? "Tắt thông báo bài viết" : "Theo dõi bài viết"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setHistoryModalPost(post);
                            setActivePostMenuId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <History size={14} />
                          <span>Lịch sử chỉnh sửa</span>
                        </button>

                        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                        <button
                          type="button"
                          onClick={() => {
                            setReportModalPost(post);
                            setReportReason("");
                            setReportSuccess(false);
                            setActivePostMenuId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-semibold text-left transition-colors cursor-pointer"
                        >
                          <Flag size={14} />
                          <span>Báo cáo bài viết</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Nội dung bài viết */}
                {editingPostId === post.id ? (
                  <div className="space-y-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-blue-400">
                    <textarea
                      value={editingPostContent}
                      onChange={(e) => setEditingPostContent(e.target.value)}
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
                        onClick={() => handleSaveEditPost(post.id)}
                        className="px-3.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Lưu thay đổi
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    <p className="whitespace-pre-wrap">{displayContent}</p>
                    {isLongText && (
                      <button
                        type="button"
                        onClick={() => setExpandedPostIds({ ...expandedPostIds, [post.id]: !isExpanded })}
                        className="text-xs font-bold text-blue-600 hover:underline mt-1 cursor-pointer"
                      >
                        {isExpanded ? "Ẩn bớt" : "Xem thêm"}
                      </button>
                    )}
                  </div>
                )}

                {/* Hình ảnh đính kèm: Click vào mở Modal bài viết nổi */}
                {post.images && post.images.length > 0 && (
                  <div
                    onClick={() => setSelectedPost(post)}
                    className={`grid gap-2 cursor-pointer rounded-xl overflow-hidden ${
                      post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"
                    }`}
                  >
                    <div className="h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                      <img
                        src={post.images[0]}
                        alt="Ảnh bài đăng"
                        className="size-full object-cover hover:scale-102 transition-transform duration-200"
                      />
                    </div>

                    {post.images.length >= 2 && (
                      <div className="relative h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                        <img
                          src={post.images[1]}
                          alt="Ảnh bài đăng 2"
                          className="size-full object-cover hover:scale-102 transition-transform duration-200"
                        />
                        {post.images.length > 2 && (
                          <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white text-2xl font-bold">
                            +{post.images.length - 2}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

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
                    onClick={() => setSelectedPost(post)}
                    className="hover:underline cursor-pointer"
                  >
                    {totalCommentsCount} bình luận
                  </button>
                </div>

                {/* Nút bấm Thích & Bình luận mở Modal */}
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <button
                    type="button"
                    onClick={() => handleToggleLikePost(post.id)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
                      post.isLiked ? "text-blue-600 dark:text-blue-400" : ""
                    }`}
                  >
                    <ThumbsUp size={15} fill={post.isLiked ? "currentColor" : "none"} />
                    <span>Thích</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPost(post)}
                    className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <MessageCircle size={15} />
                    <span>Bình luận</span>
                  </button>
                </div>
              </article>
            );
          })}
      </div>

      {/* ================= MODAL BÀI VIẾT NỔI VỚI BÌNH LUẬN ĐA TẦNG (CHUẨN ẢNH 2) ================= */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-5">
          <div className="relative flex flex-col w-full max-w-2xl max-h-[92vh] rounded-2xl bg-[#1c1d22] border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            {/* Header Modal */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#26272e] border-b border-slate-700/80 shrink-0">
              <div className="w-8" />
              <h3 className="text-sm sm:text-base font-bold text-white text-center">
                Bài viết của {selectedPost.authorName}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedPost(null);
                  setReplyingTo(null);
                }}
                className="size-8 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Nội dung chi tiết bài viết và Danh sách bình luận phân cấp đa tầng */}
            <div className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4">
              {/* Tác giả bài viết */}
              <div className="flex items-center gap-3">
                {renderAvatar(selectedPost.authorName, selectedPost.authorAvatarUrl, "size-10", "text-sm")}
                <div>
                  <div className="flex items-center gap-1.5">
                    <strong className="text-sm font-bold text-white">
                      {selectedPost.authorName}
                    </strong>
                    <span className="text-slate-400 text-xs">
                      trong {classItem.name || classItem.code}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">{selectedPost.createdAt}</span>
                </div>
              </div>

              {/* Text bài viết */}
              <p className="text-sm text-slate-100 leading-relaxed font-normal whitespace-pre-wrap">
                {selectedPost.content}
              </p>

              {/* Toàn bộ hình ảnh trong modal bài viết nổi */}
              {selectedPost.images && selectedPost.images.length > 0 && (
                <div className="space-y-2">
                  {selectedPost.images.map((img, idx) => (
                    <div key={idx} className="rounded-xl overflow-hidden border border-slate-700 bg-black/40">
                      <img src={img} alt={`Ảnh ${idx + 1}`} className="w-full max-h-96 object-contain" />
                    </div>
                  ))}
                </div>
              )}

              {/* Lượt tương tác bài viết */}
              <div className="pt-3 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">👍</span>
                  <span className="font-semibold text-slate-300">{selectedPost.likes}</span>
                </div>
                <span>
                  {selectedPost.comments.length +
                    selectedPost.comments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0)}{" "}
                  bình luận
                </span>
              </div>

              {/* ================= DANH SÁCH BÌNH LUẬN PHÂN CẤP ĐA TẦNG (CHUẨN ẢNH 2) ================= */}
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
                      {renderAvatar(cmt.authorName, cmt.authorAvatarUrl, "size-8 sm:size-9", "text-xs")}
                      <div className="flex-1 min-w-0">
                        {/* Tên và thời gian đăng */}
                        <div className="flex items-center gap-2">
                          <strong className="text-xs sm:text-sm font-bold text-white hover:underline cursor-pointer">
                            {cmt.authorName}
                          </strong>
                          <span className="text-[11px] text-slate-400">· {cmt.createdAt}</span>
                          {cmt.isEdited && (
                            <span className="text-[10px] text-slate-400 italic">· Đã chỉnh sửa</span>
                          )}
                        </div>

                        {/* Nội dung text thoáng đẹp, không bị đóng hộp gò bó */}
                        <p className="text-xs sm:text-sm text-slate-100 leading-relaxed mt-0.5 whitespace-pre-wrap">
                          {cmt.content}
                        </p>

                        {/* Thanh công cụ hành động của Bình luận cấp 1 */}
                        <div className="flex items-center gap-4 text-xs text-slate-400 mt-1.5">
                          {/* Nút Like bình luận */}
                          <button
                            type="button"
                            onClick={() => handleToggleLikeComment(selectedPost.id, cmt.id)}
                            className={`inline-flex items-center gap-1 font-semibold transition-colors cursor-pointer ${
                              cmt.isLiked ? "text-blue-400" : "hover:text-slate-200"
                            }`}
                          >
                            <ThumbsUp size={13} fill={cmt.isLiked ? "currentColor" : "none"} />
                            {cmt.likes > 0 && <span>{cmt.likes}</span>}
                          </button>

                          {/* Nút Trả lời: Mở khung phản hồi con ngay bên dưới */}
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo({ commentId: cmt.id, authorName: cmt.authorName });
                              setReplyText("");
                              setTimeout(() => replyInputRef.current?.focus(), 80);
                            }}
                            className="font-semibold text-slate-300 hover:text-white hover:underline transition-colors cursor-pointer"
                          >
                            Trả lời
                          </button>

                          {/* Nút Chia sẻ */}
                          <button
                            type="button"
                            onClick={() => notify("Đã sao chép liên kết bình luận!", "info")}
                            className="font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                          >
                            Chia sẻ
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* BÌNH LUẬN CẤP 2 (CÁC PHẢN HỒI CON THỤT LỀ THEO ẢNH 2) */}
                    {cmt.replies && cmt.replies.length > 0 && (
                      <div className="pl-8 sm:pl-11 space-y-3 relative before:absolute before:left-4 sm:before:left-5 before:top-1 before:bottom-3 before:w-[1.5px] before:bg-slate-700/60">
                        {cmt.replies.map((reply) => (
                          <div key={reply.id} className="flex items-start gap-2.5 group">
                            {renderAvatar(reply.authorName, reply.authorAvatarUrl, "size-7 sm:size-8", "text-[11px]")}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <strong className="text-xs font-bold text-white hover:underline cursor-pointer">
                                  {reply.authorName}
                                </strong>
                                <span className="text-[11px] text-slate-400">· {reply.createdAt}</span>
                              </div>

                              {/* Nội dung có Tag tên người được trả lời màu xanh nổi bật */}
                              <p className="text-xs sm:text-sm text-slate-100 leading-relaxed mt-0.5 whitespace-pre-wrap">
                                {reply.replyTo && (
                                  <span className="font-semibold text-blue-400 mr-1.5 cursor-pointer hover:underline">
                                    @{reply.replyTo}
                                  </span>
                                )}
                                <span>{reply.content}</span>
                              </p>

                              {/* Thanh công cụ hành động phản hồi con */}
                              <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleLikeComment(selectedPost.id, reply.id, true, cmt.id)}
                                  className={`inline-flex items-center gap-1 font-semibold transition-colors cursor-pointer ${
                                    reply.isLiked ? "text-blue-400" : "hover:text-slate-200"
                                  }`}
                                >
                                  <ThumbsUp size={12} fill={reply.isLiked ? "currentColor" : "none"} />
                                  {reply.likes > 0 && <span>{reply.likes}</span>}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplyingTo({ commentId: cmt.id, authorName: reply.authorName });
                                    setReplyText("");
                                    setTimeout(() => replyInputRef.current?.focus(), 80);
                                  }}
                                  className="font-semibold text-slate-300 hover:text-white hover:underline transition-colors cursor-pointer"
                                >
                                  Trả lời
                                </button>

                                <button
                                  type="button"
                                  onClick={() => notify("Đã sao chép liên kết phản hồi!", "info")}
                                  className="font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                                >
                                  Chia sẻ
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* KHUNG NHẬP PHẢN HỒI CON INLINE KHI BẤM "TRẢ LỜI" */}
                    {replyingTo?.commentId === cmt.id && (
                      <div className="pl-8 sm:pl-11 mt-2">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleAddReplyComment(cmt.id);
                          }}
                          className="flex items-center gap-2 p-2 rounded-2xl bg-[#26272e] border border-blue-500/50 shadow-md"
                        >
                          {renderAvatar(currentUserName, currentUserAvatarUrl, "size-7 sm:size-8", "text-[10px]")}
                          <div className="flex-1 flex items-center gap-1.5 min-w-0">
                            <span className="text-[11px] font-bold text-blue-400 whitespace-nowrap">
                              @{replyingTo.authorName}:
                            </span>
                            <input
                              ref={replyInputRef}
                              type="text"
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder="Viết phản hồi công khai..."
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
                            disabled={!replyText.trim()}
                            className="p-1.5 rounded-full text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors cursor-pointer"
                          >
                            <Send size={15} />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* THANH NHẬP BÌNH LUẬN CHÍNH DƯỚI CÙNG MODAL (CẤP 1) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddMainComment();
              }}
              className="p-3 bg-[#26272e] border-t border-slate-700 flex items-center gap-2.5 shrink-0"
            >
              {renderAvatar(currentUserName, currentUserAvatarUrl, "size-8", "text-xs")}
              <input
                ref={mainCommentInputRef}
                type="text"
                value={mainCommentText}
                onChange={(e) => setMainCommentText(e.target.value)}
                placeholder="Viết câu trả lời..."
                className="flex-1 py-2 px-3.5 rounded-full bg-[#18191e] border border-slate-700 text-xs text-white placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!mainCommentText.trim()}
                className="p-2 rounded-full text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL LỊCH SỬ CHỈNH SỬA ================= */}
      {historyModalPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-[#1c1d22] border border-slate-700 p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <History size={16} className="text-blue-400" />
                <span>Lịch sử chỉnh sửa</span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalPost(null)}
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
                <p className="text-xs text-slate-200 leading-relaxed">{historyModalPost.content}</p>
              </div>

              {(postEditHistories[historyModalPost.id] || []).map((hist, i) => (
                <div key={i} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Phiên bản cũ</span>
                    <span>{hist.editedAt}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{hist.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL BÁO CÁO BÀI VIẾT ================= */}
      {reportModalPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-[#1c1d22] border border-slate-700 p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2 font-bold text-sm text-amber-400">
                <Flag size={16} />
                <span>Báo cáo bài viết</span>
              </div>
              <button
                type="button"
                onClick={() => setReportModalPost(null)}
                className="size-7 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {reportSuccess ? (
              <div className="py-6 text-center space-y-2">
                <div className="size-12 rounded-full bg-emerald-500/20 text-emerald-400 grid place-items-center mx-auto text-xl font-bold">
                  ✓
                </div>
                <p className="text-sm font-bold text-white">Đã gửi báo cáo vi phạm</p>
                <p className="text-xs text-slate-400">
                  Cảm ơn bạn đã phản hồi. Quản trị viên và giáo viên phụ trách sẽ kiểm tra nội dung này.
                </p>
                <button
                  type="button"
                  onClick={() => setReportModalPost(null)}
                  className="mt-3 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-300">
                  Vui lòng chọn hoặc nhập lý do bài viết này vi phạm quy tắc cộng đồng:
                </p>
                <div className="space-y-1.5">
                  {[
                    "Nội dung xúc phạm, quấy rối hoặc bạo lực",
                    "Spam, quảng cáo không liên quan đến bài học",
                    "Chia sẻ đáp án thi / gian lận học thuật",
                    "Nội dung sai sự thật, gây hiểu lầm",
                  ].map((reason, idx) => (
                    <label
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer transition-colors"
                    >
                      <input
                        type="radio"
                        name="reportReason"
                        checked={reportReason === reason}
                        onChange={() => setReportReason(reason)}
                        className="text-blue-600"
                      />
                      <span>{reason}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                  <button
                    type="button"
                    onClick={() => setReportModalPost(null)}
                    className="px-3 py-1.5 rounded-xl border border-slate-600 text-xs hover:bg-slate-800 cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    disabled={!reportReason}
                    onClick={() => setReportSuccess(true)}
                    className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                  >
                    Gửi báo cáo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
