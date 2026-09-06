"use client";

import {
  ArrowLeft,
  Bell,
  BellOff,
  Download,
  Eye,
  MessageCircle,
  Paperclip,
  Reply,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  UserX,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import {
  apiRequest,
  downloadApiFile,
  previewApiFile,
  publicApiUrl,
} from "@/lib/api-client";
import { normalizeChatMessage } from "@/lib/chat-message";
import type {
  ChatConversation,
  ChatDirectoryEntry,
  ChatMessage,
  ChatMessagePage,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

const roleLabels: Record<ChatDirectoryEntry["roleCode"], string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  CENTER_MANAGER: "Quản lý trung tâm",
  INSTRUCTOR: "Giảng viên",
  LEARNER: "Học viên",
};

/** Phục hồi bản nháp của tài khoản trong trình duyệt mà không làm hỏng lần render phía máy chủ. */
function loadStoredDrafts(userId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(`wind-chat-drafts:${userId}`) ?? "{}",
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Cung cấp danh bạ theo lớp và hội thoại riêng/lớp với luồng responsive hai cột. */
export default function MessagesPage() {
  const { session, notify } = useApp();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [directory, setDirectory] = useState<ChatDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    loadStoredDrafts(session.user.id),
  );
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [failedMessage, setFailedMessage] = useState<{
    content: string;
    clientMessageId: string;
    replyToId?: string;
    mentionedUserIds?: string[];
    files?: File[];
    contextType?: "ASSIGNMENT" | "EXAM" | "MATERIAL";
    contextId?: string;
  } | null>(null);
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [messageQuery, setMessageQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [pendingContext, setPendingContext] = useState<{
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL";
    id: string;
    title: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagePaneRef = useRef<HTMLDivElement>(null);
  const handledDeepLinkRef = useRef(false);
  const selected = conversations.find((item) => item.id === selectedId);
  const draft = selectedId ? (drafts[selectedId] ?? "") : "";

  /** Nạp danh sách hội thoại và giữ lựa chọn còn hợp lệ. */
  const loadConversations = useCallback(async () => {
    const rows = await apiRequest<ChatConversation[]>("/chat/conversations", {
      roleCode: session.roleCode,
    });
    setConversations(rows);
    setSelectedId((current) =>
      current && rows.some((item) => item.id === current)
        ? current
        : (rows[0]?.id ?? ""),
    );
  }, [session.roleCode]);

  /** Nạp một trang tin mới nhất rồi đồng bộ mốc đã đọc. */
  const loadMessages = useCallback(
    async (conversationId: string, quiet = false) => {
      try {
        const page = await apiRequest<ChatMessagePage>(
          `/chat/conversations/${conversationId}/messages?limit=80`,
          { roleCode: session.roleCode },
        );
        setMessages(page.items.map(normalizeChatMessage).filter((item): item is ChatMessage => Boolean(item)));
        await apiRequest(`/chat/conversations/${conversationId}/read`, {
          method: "PATCH",
          roleCode: session.roleCode,
        });
        if (!quiet)
          window.requestAnimationFrame(() => {
            const stored = window.sessionStorage.getItem(
              `wind-chat-scroll:${session.user.id}:${conversationId}`,
            );
            if (stored && messagePaneRef.current)
              messagePaneRef.current.scrollTop = Number(stored);
            else bottomRef.current?.scrollIntoView({ block: "end" });
          });
      } catch (error) {
        if (!quiet)
          notify(
            error instanceof Error ? error.message : "Không tải được tin nhắn.",
            "error",
          );
      }
    },
    [notify, session.roleCode, session.user.id],
  );

  // Khởi tạo danh sách hội thoại cho tài khoản hiện tại.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConversations()
        .catch((error) =>
          notify(
            error instanceof Error
              ? error.message
              : "Không tải được hội thoại.",
            "error",
          ),
        )
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations, notify]);

  // Mở điểm vào từ thành viên, bài tập, kết quả hoặc học liệu đúng một lần khi tải trang.
  useEffect(() => {
    if (loading || handledDeepLinkRef.current) return;
    handledDeepLinkRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversationId");
    const userId = params.get("userId");
    const classId = params.get("classId");
    const contextType = params.get("contextType");
    const contextId = params.get("contextId");
    if (
      ["ASSIGNMENT", "EXAM", "MATERIAL"].includes(contextType ?? "") &&
      contextId
    ) {
      const linkedContext = {
        type: contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
        id: contextId,
        title: params.get("contextTitle") ?? "Nội dung được chia sẻ",
      };
      window.setTimeout(() => setPendingContext(linkedContext), 0);
    }
    if (conversationId) {
      const available = conversations.some(
        (item) => item.id === conversationId,
      );
      if (available) window.setTimeout(() => setSelectedId(conversationId), 0);
      else
        notify(
          "Hội thoại không còn khả dụng hoặc bạn đã bị thu hồi quyền truy cập.",
          "error",
        );
      return;
    }
    const request = userId
      ? apiRequest<ChatConversation>("/chat/conversations/direct", {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ userId }),
        })
      : classId
        ? apiRequest<ChatConversation>("/chat/conversations/class", {
            method: "POST",
            roleCode: session.roleCode,
            body: JSON.stringify({ classId }),
          })
        : null;
    if (request)
      void request
        .then(async (conversation) => {
          await loadConversations();
          setSelectedId(conversation.id);
        })
        .catch((error: unknown) =>
          notify(
            error instanceof Error
              ? error.message
              : "Không mở được hội thoại từ liên kết.",
            "error",
          ),
        );
  }, [conversations, loadConversations, loading, notify, session.roleCode]);

  /** Nạp lịch sử một lần rồi dùng SSE cho tin mới và bộ đếm đa thiết bị. */
  useEffect(() => {
    if (!selectedId) return;
    const initialTimer = window.setTimeout(() => {
      void loadMessages(selectedId);
    }, 0);
    const events = new EventSource(
      publicApiUrl(`/chat/conversations/${selectedId}/events`),
      { withCredentials: true },
    );
    events.onmessage = (event) => {
      try {
        const message = normalizeChatMessage(JSON.parse(event.data));
        if (!message) return;
        setMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
        );
        void apiRequest(`/chat/conversations/${selectedId}/read`, {
          method: "PATCH",
          roleCode: session.roleCode,
        });
        void loadConversations();
        window.requestAnimationFrame(() =>
          bottomRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
          }),
        );
      } catch {
        // EventSource tự nối lại; lịch sử ban đầu vẫn là nguồn phục hồi khi payload lỗi.
      }
    };
    return () => {
      window.clearTimeout(initialTimer);
      events.close();
    };
  }, [loadConversations, loadMessages, selectedId, session.roleCode]);

  /** Lưu bản nháp từng hội thoại để điều hướng không làm mất nội dung. */
  const updateDraft = (value: string) => {
    if (!selectedId) return;
    const next = { ...drafts, [selectedId]: value };
    setDrafts(next);
    window.localStorage.setItem(
      `wind-chat-drafts:${session.user.id}`,
      JSON.stringify(next),
    );
  };

  /** Tìm danh bạ bằng tên có/không dấu, mã hoặc lớp chung. */
  const searchDirectory = async (event: React.FormEvent) => {
    event.preventDefault();
    setSearching(true);
    try {
      setDirectory(
        await apiRequest<ChatDirectoryEntry[]>(
          `/chat/directory?q=${encodeURIComponent(query)}`,
          { roleCode: session.roleCode },
        ),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tìm được danh bạ.",
        "error",
      );
    } finally {
      setSearching(false);
    }
  };

  /** Mở hội thoại riêng mà không gửi nội dung tự động. */
  const openDirect = async (userId: string) => {
    try {
      const conversation = await apiRequest<ChatConversation>(
        "/chat/conversations/direct",
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ userId }),
        },
      );
      await loadConversations();
      setSelectedId(conversation.id);
      setDirectory([]);
      setQuery("");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được hội thoại.",
        "error",
      );
    }
  };

  /** Mở nhóm lớp đã ghi danh/phân công. */
  const openClass = async (classId: string) => {
    try {
      const conversation = await apiRequest<ChatConversation>(
        "/chat/conversations/class",
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ classId }),
        },
      );
      await loadConversations();
      setSelectedId(conversation.id);
      setDirectory([]);
      setQuery("");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không mở được trò chuyện lớp.",
        "error",
      );
    }
  };

  /** Gửi hoặc thử lại một tin bằng cùng clientMessageId để chống tạo trùng. */
  const sendMessage = async (
    event?: React.FormEvent,
    retry = failedMessage,
  ) => {
    event?.preventDefault();
    if (!selectedId || selected?.readOnly) return;
    const payload = retry ?? {
      content: draft.trim(),
      clientMessageId: crypto.randomUUID(),
      replyToId: replyTo?.id,
      mentionedUserIds,
      files: messageFiles,
      contextType: pendingContext?.type,
      contextId: pendingContext?.id,
    };
    if (!payload.content && !payload.files?.length) return;
    setSending(true);
    setFailedMessage(null);
    try {
      const body = payload.files?.length
        ? new FormData()
        : JSON.stringify({
            content: payload.content,
            clientMessageId: payload.clientMessageId,
            replyToId: payload.replyToId,
            mentionedUserIds: payload.mentionedUserIds,
            contextType: payload.contextType,
            contextId: payload.contextId,
          });
      if (body instanceof FormData) {
        body.set("content", payload.content);
        body.set("clientMessageId", payload.clientMessageId);
        if (payload.replyToId) body.set("replyToId", payload.replyToId);
        body.set(
          "mentionedUserIds",
          JSON.stringify(payload.mentionedUserIds ?? []),
        );
        if (payload.contextType) body.set("contextType", payload.contextType);
        if (payload.contextId) body.set("contextId", payload.contextId);
        payload.files?.forEach((file) => body.append("files", file));
      }
      await apiRequest(`/chat/conversations/${selectedId}/messages`, {
        method: "POST",
        roleCode: session.roleCode,
        body,
      });
      updateDraft("");
      setReplyTo(null);
      setMessageFiles([]);
      setMentionedUserIds([]);
      setPendingContext(null);
      await loadMessages(selectedId);
      await loadConversations();
    } catch (error) {
      setFailedMessage(payload);
      notify(
        error instanceof Error ? error.message : "Tin nhắn chưa gửi được.",
        "error",
      );
    } finally {
      setSending(false);
    }
  };

  /** Tìm tin trong hội thoại mà không thay đổi mốc đọc hoặc danh sách hiện tại. */
  const searchConversation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || messageQuery.trim().length < 2) return;
    try {
      const rows = await apiRequest<ChatMessage[]>(
          `/chat/conversations/${selectedId}/search?q=${encodeURIComponent(messageQuery)}`,
          { roleCode: session.roleCode },
        );
      setSearchResults(rows.map(normalizeChatMessage).filter((item): item is ChatMessage => Boolean(item)));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tìm được tin nhắn.",
        "error",
      );
    }
  };

  /** Bật hoặc tắt thông báo hội thoại trong 24 giờ. */
  const toggleMute = async () => {
    if (!selected) return;
    try {
      await apiRequest(`/chat/conversations/${selected.id}/mute`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          mutedUntil: selected.mutedUntil
            ? undefined
            : new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
      await loadConversations();
      notify(
        selected.mutedUntil
          ? "Đã bật lại thông báo."
          : "Đã tắt thông báo trong 24 giờ.",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không đổi được cài đặt thông báo.",
        "error",
      );
    }
  };

  /** Gửi báo cáo nội dung tin nhắn với lý do có thể truy vết. */
  const reportMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reportTarget) return;
    try {
      await apiRequest(`/chat/messages/${reportTarget.id}/report`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: reportReason }),
      });
      setReportTarget(null);
      setReportReason("");
      notify("Đã gửi báo cáo tin nhắn.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi được báo cáo.",
        "error",
      );
    }
  };

  /** Chặn người còn lại trong hội thoại riêng để dừng gửi tin hai chiều. */
  const blockDirectUser = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = selected?.members.find(
      (item) => item.userId !== session.user.id,
    );
    if (!target) return;
    try {
      await apiRequest("/chat/blocks", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId: target.userId, reason: blockReason }),
      });
      setBlockOpen(false);
      setBlockReason("");
      await loadConversations();
      notify("Đã chặn liên hệ riêng.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không chặn được người dùng.",
        "error",
      );
    }
  };

  /** Xem trước hoặc tải tệp chat qua cổng kiểm tra membership. */
  const openAttachment = async (
    message: ChatMessage,
    attachmentId: string,
    preview: boolean,
  ) => {
    const path = `/chat/messages/${message.id}/attachments/${attachmentId}${preview ? "?action=preview" : ""}`;
    try {
      if (preview) await previewApiFile(path, session.roleCode);
      else await downloadApiFile(path, session.roleCode);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được tệp chat.",
        "error",
      );
    }
  };

  const classChoices = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; name: string }>();
    for (const entry of directory)
      for (const item of entry.sharedClasses) byId.set(item.id, item);
    return [...byId.values()];
  }, [directory]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Liên lạc nội bộ"
        title="Tin nhắn"
        description="Tìm theo lớp chung, mở đúng người và tiếp tục trao đổi trong một nơi."
      />
      <div className="mt-6 grid min-h-[36rem] overflow-hidden border-y border-[var(--rule-strong)] bg-[var(--surface)]/70 md:grid-cols-[21rem_1fr]">
        <aside
          className={`${selectedId ? "hidden md:block" : "block"} border-r border-[var(--rule-strong)]`}
        >
          <form
            className="flex gap-2 border-b border-[var(--rule)] p-3"
            onSubmit={(event) => void searchDirectory(event)}
          >
            <input
              aria-label="Tìm người"
              className={inputClass}
              placeholder="Tên, mã hoặc lớp…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button aria-label="Tìm" loading={searching} type="submit">
              <Search size={16} />
            </Button>
          </form>
          {directory.length || classChoices.length ? (
            <div className="max-h-72 overflow-y-auto border-b border-[var(--rule-strong)] p-2">
              {classChoices.map((item) => (
                <button
                  className="flex w-full items-center gap-3 border-b border-[var(--rule)] px-3 py-3 text-left hover:bg-[var(--surface-muted)]"
                  key={item.id}
                  onClick={() => void openClass(item.id)}
                  type="button"
                >
                  <Users size={17} className="text-[var(--accent)]" />
                  <span>
                    <strong className="block text-sm">{item.name}</strong>
                    <small className="text-[var(--ink-muted)]">
                      {item.code} · trò chuyện lớp
                    </small>
                  </span>
                </button>
              ))}
              {directory.map((entry) => (
                <button
                  className="flex w-full items-center gap-3 border-b border-[var(--rule)] px-3 py-3 text-left hover:bg-[var(--surface-muted)]"
                  key={entry.id}
                  onClick={() => void openDirect(entry.id)}
                  type="button"
                >
                  <MessageCircle size={17} className="text-[var(--accent)]" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">
                      {entry.displayName}
                    </strong>
                    <small className="text-[var(--ink-muted)]">
                      {roleLabels[entry.roleCode]}
                      {entry.sharedClasses[0]
                        ? ` · ${entry.sharedClasses[0].code}`
                        : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="max-h-[31rem] overflow-y-auto">
            {loading ? (
              <p className="p-5 text-sm text-[var(--ink-muted)]">
                Đang tải hội thoại…
              </p>
            ) : conversations.length ? (
              conversations.map((item) => (
                <button
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={`w-full border-b border-[var(--rule)] px-4 py-4 text-left ${item.id === selectedId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-muted)]"}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-3">
                    <strong className="truncate text-sm">{item.title}</strong>
                    {item.unreadCount ? (
                      <span className="grid min-w-6 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-xs font-bold text-white">
                        {item.unreadCount}
                      </span>
                    ) : null}
                  </span>
                  <small className="mt-1 block truncate text-[var(--ink-muted)]">
                    {item.lastMessage?.content ??
                      (item.type === "CLASS" ? "Nhóm lớp" : "Chưa có tin nhắn")}
                  </small>
                </button>
              ))
            ) : (
              <p className="p-5 text-sm leading-6 text-[var(--ink-muted)]">
                Chưa có hội thoại. Dùng ô tìm kiếm để liên hệ giảng viên hoặc
                thành viên cùng lớp.
              </p>
            )}
          </div>
        </aside>
        <section
          className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-col`}
        >
          {selected ? (
            <>
              <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-[var(--rule-strong)] px-4 py-2">
                <button
                  aria-label="Quay lại danh sách"
                  className="grid size-10 place-items-center md:hidden"
                  onClick={() => setSelectedId("")}
                  type="button"
                >
                  <ArrowLeft size={19} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-heading text-lg font-bold">
                    {selected.title}
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selected.type === "CLASS"
                      ? `${selected.members.filter((item) => item.status === "ACTIVE").length} thành viên`
                      : selected.members.find(
                          (item) => item.userId !== session.user.id,
                        )?.roleCode}
                    {selected.readOnly ? " · Chỉ đọc" : ""}
                  </p>
                </div>
                <form
                  className="hidden items-center gap-1 lg:flex"
                  onSubmit={(event) => void searchConversation(event)}
                >
                  <input
                    aria-label="Tìm trong hội thoại"
                    className="min-h-10 w-44 rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
                    minLength={2}
                    onChange={(event) => setMessageQuery(event.target.value)}
                    placeholder="Tìm trong tin nhắn"
                    value={messageQuery}
                  />
                  <button
                    aria-label="Tìm trong hội thoại"
                    className="grid size-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"
                    type="submit"
                  >
                    <Search size={17} />
                  </button>
                </form>
                <button
                  aria-label={
                    selected.mutedUntil
                      ? "Bật thông báo"
                      : "Tắt thông báo 24 giờ"
                  }
                  className="grid size-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"
                  onClick={() => void toggleMute()}
                  type="button"
                >
                  {selected.mutedUntil ? (
                    <BellOff size={18} />
                  ) : (
                    <Bell size={18} />
                  )}
                </button>
                {selected.type === "DIRECT" ? (
                  <button
                    aria-label="Chặn người dùng"
                    className="grid size-10 place-items-center rounded-lg text-[var(--danger)] hover:bg-rose-50"
                    onClick={() => setBlockOpen(true)}
                    type="button"
                  >
                    <UserX size={18} />
                  </button>
                ) : null}
              </header>
              {searchResults.length ? (
                <div className="max-h-40 overflow-y-auto border-b border-[var(--rule)] bg-[var(--surface-muted)] px-4">
                  <div className="flex items-center justify-between py-2 text-xs font-bold">
                    <span>
                      {searchResults.length} kết quả cho “{messageQuery}”
                    </span>
                    <button
                      onClick={() => {
                        setSearchResults([]);
                        setMessageQuery("");
                      }}
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {searchResults.map((item) => (
                    <button
                      className="block w-full border-t border-[var(--rule)] py-2 text-left text-xs"
                      key={item.id}
                      onClick={() => setSearchResults([])}
                      type="button"
                    >
                      <strong>{item.senderName}</strong> ·{" "}
                      {item.content.slice(0, 120)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div
                className="flex-1 overflow-y-auto px-4 py-5 md:px-6"
                onScroll={(event) =>
                  window.sessionStorage.setItem(
                    `wind-chat-scroll:${session.user.id}:${selected.id}`,
                    String(event.currentTarget.scrollTop),
                  )
                }
                ref={messagePaneRef}
              >
                {messages.map((message) => {
                  const mine = message.senderId === session.user.id;
                  return (
                    <div
                      className={`mb-3 flex ${mine ? "justify-end" : "justify-start"}`}
                      key={message.id}
                    >
                      <article
                        className={`group max-w-[82%] rounded-xl px-4 py-3 text-left text-sm ${mine ? "bg-[var(--action)] text-[var(--action-ink)]" : "border border-[var(--rule)] bg-[var(--surface)]"}`}
                      >
                        {message.replyTo ? (
                          <span
                            className={`mb-2 block rounded-md px-2 py-1 text-xs ${mine ? "bg-white/10 text-white/75" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"}`}
                          >
                            {message.replyTo.senderName}:{" "}
                            {message.replyTo.content}
                          </span>
                        ) : null}
                        {!mine ? (
                          <strong className="mb-1 block text-xs text-[var(--accent)]">
                            {message.senderName}
                          </strong>
                        ) : null}
                        <span className="whitespace-pre-wrap break-words">
                          {message.content}
                        </span>
                        {message.context ? (
                          <Link
                            className={`mt-2 block rounded-lg border px-3 py-2 font-bold ${mine ? "border-white/20 bg-white/10" : "border-[var(--rule)] bg-[var(--surface-muted)]"}`}
                            href={message.context.href}
                          >
                            {message.context.type === "ASSIGNMENT"
                              ? "Bài tập"
                              : message.context.type === "EXAM"
                                ? "Đề thi"
                                : "Học liệu"}
                            : {message.context.title}
                          </Link>
                        ) : null}
                        {message.attachments?.length ? (
                          <div className="mt-2 space-y-1">
                            {message.attachments.map((file) => (
                              <div
                                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${mine ? "bg-white/10" : "bg-[var(--surface-muted)]"}`}
                                key={file.id}
                              >
                                <Paperclip size={13} />
                                <span className="min-w-0 flex-1 truncate text-xs font-bold">
                                  {file.originalName}
                                </span>
                                {file.canPreview ? (
                                  <button
                                    aria-label={`Xem ${file.originalName}`}
                                    onClick={() =>
                                      void openAttachment(
                                        message,
                                        file.id,
                                        true,
                                      )
                                    }
                                    type="button"
                                  >
                                    <Eye size={14} />
                                  </button>
                                ) : null}
                                <button
                                  aria-label={`Tải ${file.originalName}`}
                                  onClick={() =>
                                    void openAttachment(message, file.id, false)
                                  }
                                  type="button"
                                >
                                  <Download size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <small
                          className={`mt-1 block text-right ${mine ? "text-white/65" : "text-[var(--ink-muted)]"}`}
                        >
                          {new Date(message.createdAt).toLocaleTimeString(
                            "vi-VN",
                            { hour: "2-digit", minute: "2-digit" },
                          )}
                        </small>
                        <div
                          className={`mt-2 flex items-center justify-end gap-3 text-[11px] font-bold ${mine ? "text-white/70" : "text-[var(--ink-muted)]"}`}
                        >
                          <button
                            onClick={() => setReplyTo(message)}
                            type="button"
                          >
                            <Reply className="mr-1 inline" size={12} />
                            Trả lời
                          </button>
                          {!mine ? (
                            <button
                              onClick={() => {
                                setReportTarget(message);
                                setReportReason("");
                              }}
                              type="button"
                            >
                              <ShieldAlert className="mr-1 inline" size={12} />
                              Báo cáo
                            </button>
                          ) : null}
                        </div>
                      </article>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              {selected.readOnly ? (
                <p className="border-t border-[var(--rule-strong)] px-4 py-4 text-center text-sm font-semibold text-[var(--ink-muted)]">
                  Hội thoại này chỉ còn quyền đọc.
                </p>
              ) : (
                <form
                  className="border-t border-[var(--rule-strong)] p-3"
                  onSubmit={(event) => void sendMessage(event)}
                >
                  {replyTo ? (
                    <div className="mb-2 flex items-center justify-between gap-3 bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <span className="truncate">
                        <Reply className="mr-1 inline" size={13} />
                        Trả lời {replyTo.senderName}: {replyTo.content}
                      </span>
                      <button onClick={() => setReplyTo(null)} type="button">
                        Hủy
                      </button>
                    </div>
                  ) : null}
                  {failedMessage ? (
                    <div className="mb-2 flex items-center justify-between gap-3 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      <span>Tin nhắn chưa gửi.</span>
                      <button
                        className="font-bold"
                        onClick={() =>
                          void sendMessage(undefined, failedMessage)
                        }
                        type="button"
                      >
                        <RotateCcw className="mr-1 inline" size={13} />
                        Thử lại
                      </button>
                    </div>
                  ) : null}
                  {selected.type === "CLASS" ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {selected.members
                        .filter(
                          (item) =>
                            item.status === "ACTIVE" &&
                            item.userId !== session.user.id,
                        )
                        .map((member) => (
                          <button
                            className={`rounded-full border px-2 py-1 text-[11px] font-bold ${mentionedUserIds.includes(member.userId) ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]" : "border-[var(--rule)]"}`}
                            key={member.userId}
                            onClick={() =>
                              setMentionedUserIds((current) =>
                                current.includes(member.userId)
                                  ? current.filter((id) => id !== member.userId)
                                  : [...current, member.userId],
                              )
                            }
                            type="button"
                          >
                            @{member.displayName}
                          </button>
                        ))}
                    </div>
                  ) : null}
                  {pendingContext ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-xs">
                      <span className="truncate font-bold">
                        Đính kèm{" "}
                        {pendingContext.type === "ASSIGNMENT"
                          ? "bài tập"
                          : pendingContext.type === "EXAM"
                            ? "đề thi"
                            : "học liệu"}
                        : {pendingContext.title}
                      </span>
                      <button
                        aria-label="Bỏ thẻ ngữ cảnh"
                        onClick={() => setPendingContext(null)}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null}
                  {messageFiles.length ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {messageFiles.map((file, index) => (
                        <span
                          className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-xs"
                          key={`${file.name}-${index}`}
                        >
                          {file.name}
                          <button
                            aria-label={`Bỏ ${file.name}`}
                            onClick={() =>
                              setMessageFiles((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                            type="button"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-end gap-2">
                    <label
                      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--rule)] hover:bg-[var(--surface-muted)]"
                      aria-label="Đính kèm tệp"
                    >
                      <Paperclip size={17} />
                      <input
                        accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt"
                        className="sr-only"
                        multiple
                        onChange={(event) => {
                          const next = Array.from(event.target.files ?? []);
                          if (
                            messageFiles.length + next.length <= 5 &&
                            next.every(
                              (file) =>
                                file.size > 0 && file.size <= 10 * 1024 * 1024,
                            )
                          )
                            setMessageFiles([...messageFiles, ...next]);
                          else
                            notify(
                              "Tối đa 5 tệp, mỗi tệp không quá 10 MB.",
                              "error",
                            );
                          event.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    <textarea
                      aria-label="Nội dung tin nhắn"
                      className={`${inputClass} min-h-11 resize-none`}
                      maxLength={5000}
                      placeholder="Nhập tin nhắn…"
                      rows={2}
                      value={draft}
                      onChange={(event) => updateDraft(event.target.value)}
                    />
                    <Button
                      aria-label="Gửi tin nhắn"
                      disabled={!draft.trim() && !messageFiles.length}
                      loading={sending}
                      type="submit"
                    >
                      <Send size={17} />
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-[var(--ink-muted)]">
              <div>
                <MessageCircle className="mx-auto mb-3" size={30} />
                <p>Chọn một hội thoại hoặc tìm người cần liên hệ.</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <Modal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Báo cáo tin nhắn"
        description="Báo cáo được gửi cho bộ phận kiểm duyệt; người gửi tin không được thông báo tên người báo cáo."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void reportMessage(event)}
        >
          <Field label="Lý do">
            <textarea
              className={inputClass}
              minLength={5}
              onChange={(event) => setReportReason(event.target.value)}
              required
              rows={4}
              value={reportReason}
            />
          </Field>
          <Button disabled={reportReason.trim().length < 5} type="submit">
            <ShieldAlert size={15} />
            Gửi báo cáo
          </Button>
        </form>
      </Modal>
      <Modal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Chặn liên hệ riêng"
        description="Sau khi chặn, cả hai phía không thể gửi tin riêng mới. Trò chuyện lớp vẫn hoạt động theo quyền lớp."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void blockDirectUser(event)}
        >
          <Field label="Lý do (không bắt buộc)">
            <textarea
              className={inputClass}
              maxLength={500}
              onChange={(event) => setBlockReason(event.target.value)}
              rows={3}
              value={blockReason}
            />
          </Field>
          <Button type="submit" variant="danger">
            <UserX size={15} />
            Xác nhận chặn
          </Button>
        </form>
      </Modal>
    </div>
  );
}
