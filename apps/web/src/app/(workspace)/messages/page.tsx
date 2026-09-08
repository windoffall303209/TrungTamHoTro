"use client";

import {
  ArrowLeft,
  ArrowUp,
  Bell,
  BellOff,
  Download,
  Eye,
  ImageOff,
  LoaderCircle,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  Reply,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  UserX,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import {
  apiRequest,
  downloadApiFile,
  previewApiFile,
  publicApiUrl,
} from "@/lib/api-client";
import {
  chatRecordingExtension,
  normalizeChatMessage,
  selectChatRecordingMimeType,
  shouldSendChatMessage,
  shouldStartChatTimeGroup,
} from "@/lib/chat-message";
import type {
  ChatConversation,
  ChatDirectoryEntry,
  ChatMessage,
  ChatMessagePage,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";

const roleLabels: Record<ChatDirectoryEntry["roleCode"], string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  CENTER_MANAGER: "Quản lý trung tâm",
  INSTRUCTOR: "Giảng viên",
  LEARNER: "Học viên",
};

interface InlineChatImageProps {
  alt: string;
  mine: boolean;
  onOpen: () => void;
  path: string;
  roleCode: Parameters<typeof downloadApiFile>[1];
}

/** Tải ảnh chat có xác thực và thu hồi object URL khi tin rời khỏi màn hình. */
function InlineChatImage({
  alt,
  mine,
  onOpen,
  path,
  roleCode,
}: InlineChatImageProps) {
  const [imageUrl, setImageUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    void fetch(publicApiUrl(path), {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "image/*", "x-role-code": roleCode },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("image-preview-failed");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/"))
          throw new Error("invalid-image-preview");
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, retryCount, roleCode]);

  return (
    <div
      className={`overflow-hidden rounded-lg ${mine ? "bg-white/10" : "border border-[var(--rule)] bg-[var(--surface-muted)]"}`}
    >
      {imageUrl ? (
        <button
          aria-label={`Xem ${alt}`}
          className="block w-72 max-w-full overflow-hidden bg-[var(--canvas)]"
          onClick={onOpen}
          type="button"
        >
          <Image
            alt={alt}
            className="max-h-80 min-h-28 w-full object-contain"
            height={480}
            src={imageUrl}
            unoptimized
            width={640}
          />
        </button>
      ) : failed ? (
        <div className="flex min-h-28 w-72 max-w-full flex-col items-center justify-center gap-2 bg-[var(--canvas)] px-4 text-center text-xs text-[var(--ink-soft)]">
          <ImageOff aria-hidden="true" size={22} />
          <span>Không thể mở bản xem trước.</span>
          <button
            className="font-bold text-[var(--accent-deep)] underline decoration-1 underline-offset-4"
            onClick={() => {
              setFailed(false);
              setRetryCount((current) => current + 1);
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="mr-1 inline" size={13} />
            Thử tải lại
          </button>
        </div>
      ) : (
        <div
          aria-label="Đang tải bản xem trước…"
          className="grid min-h-28 w-72 max-w-full place-items-center bg-[var(--canvas)] text-[var(--ink-soft)]"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="animate-spin" size={20} />
        </div>
      )}
    </div>
  );
}

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
  const { locale } = useI18n();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [directory, setDirectory] = useState<ChatDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activeActionMessageId, setActiveActionMessageId] = useState("");
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const messageFilesRef = useRef(messageFiles);
  const selected = conversations.find((item) => item.id === selectedId);
  const draft = selectedId ? (drafts[selectedId] ?? "") : "";

  /** Dừng toàn bộ track micro để trình duyệt trả lại thiết bị ngay lập tức. */
  const releaseMicrophone = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  /** Thêm tệp vào hàng chờ sau khi kiểm tra giới hạn dùng chung của chat. */
  const queueMessageFiles = (files: File[]) => {
    const current = messageFilesRef.current;
    if (
      current.length + files.length > 5 ||
      files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024)
    ) {
      notify("Tối đa 5 tệp, mỗi tệp không quá 10 MB.", "error");
      return false;
    }
    const next = [...current, ...files];
    messageFilesRef.current = next;
    setMessageFiles(next);
    return true;
  };

  /** Bắt đầu hoặc kết thúc ghi âm và đưa bản ghi hợp lệ vào tệp đính kèm. */
  const toggleRecording = async () => {
    const activeRecorder = mediaRecorderRef.current;
    if (activeRecorder?.state === "recording") {
      activeRecorder.stop();
      releaseMicrophone();
      return;
    }
    if (messageFilesRef.current.length >= 5) {
      notify("Hãy bỏ bớt tệp trước khi ghi âm.", "error");
      return;
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      notify("Trình duyệt này chưa hỗ trợ ghi âm tin nhắn.", "error");
      return;
    }
    const conversationId = selectedIdRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (conversationId !== selectedIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = selectChatRecordingMimeType(MediaRecorder.isTypeSupported);
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        releaseMicrophone();
        setRecording(false);
        notify("Không thể tiếp tục ghi âm. Hãy kiểm tra lại micro.", "error");
      };
      recorder.onstop = () => {
        const shouldDiscard =
          discardRecordingRef.current ||
          conversationId !== selectedIdRef.current;
        const chunks = recordingChunksRef.current;
        const outputType = recorder.mimeType || mimeType || "audio/webm";
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        releaseMicrophone();
        setRecording(false);
        if (shouldDiscard || !chunks.length) return;
        const blob = new Blob(chunks, { type: outputType });
        const extension = chatRecordingExtension(outputType);
        queueMessageFiles([
          new File([blob], `ghi-am-${Date.now()}.${extension}`, {
            type: outputType,
          }),
        ]);
      };
      recorder.start(250);
      setRecording(true);
    } catch (error) {
      releaseMicrophone();
      setRecording(false);
      notify(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Bạn cần cấp quyền micro để ghi âm tin nhắn."
          : "Không mở được micro. Hãy kiểm tra thiết bị rồi thử lại.",
        "error",
      );
    }
  };

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

  // Đồng bộ dữ liệu mới nhất cho callback bất đồng bộ của MediaRecorder.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    messageFilesRef.current = messageFiles;
  }, [messageFiles, selectedId]);

  // Hủy bản ghi chưa hoàn tất khi đổi hội thoại hoặc rời khỏi trang.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        discardRecordingRef.current = true;
        recorder.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    };
  }, [selectedId]);

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
      messageFilesRef.current = [];
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
    <div className="mx-auto h-[calc(100dvh-4rem)] max-w-7xl p-0 md:px-6 md:py-4">
      <div className="grid h-full min-h-0 overflow-hidden border-y border-[var(--rule-strong)] bg-[var(--surface)]/70 md:grid-cols-[21rem_1fr] md:border-x">
        <aside
          className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-[var(--rule-strong)]`}
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
          <div className="min-h-0 flex-1 overflow-y-auto">
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
          className={`${selectedId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`}
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
                {messages.map((message, index) => {
                  const mine = message.senderId === session.user.id;
                  const startsTimeGroup = shouldStartChatTimeGroup(
                    message.createdAt,
                    messages[index - 1]?.createdAt,
                  );
                  const messageDate = new Date(message.createdAt);
                  const isToday =
                    messageDate.toDateString() === new Date().toDateString();
                  return (
                    <div key={message.id}>
                      {startsTimeGroup ? (
                        <time
                          className="my-5 block text-center text-xs font-semibold text-[var(--ink-muted)]"
                          dateTime={message.createdAt}
                        >
                          {new Intl.DateTimeFormat(locale, {
                            ...(isToday
                              ? {}
                              : { day: "2-digit", month: "2-digit", year: "numeric" }),
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(messageDate)}
                        </time>
                      ) : null}
                      <div
                        className={`group mb-1.5 flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                        onPointerUp={(event) => {
                          if (event.pointerType !== "mouse")
                            setActiveActionMessageId((current) =>
                              current === message.id ? "" : message.id,
                            );
                        }}
                      >
                        {mine ? (
                          <button
                            aria-label="Trả lời"
                            className={`grid size-8 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] group-focus-within:opacity-100 group-hover:opacity-100 ${activeActionMessageId === message.id ? "opacity-100" : "opacity-0"}`}
                            onClick={() => setReplyTo(message)}
                            title="Trả lời"
                            type="button"
                          >
                            <Reply aria-hidden="true" size={15} />
                          </button>
                        ) : null}
                        <article
                          className={`max-w-[82%] rounded-xl px-4 py-3 text-left text-sm ${mine ? "bg-[var(--action)] text-[var(--action-ink)]" : "border border-[var(--rule)] bg-[var(--surface)]"}`}
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
                            {message.attachments.map((file) => {
                              const attachmentPath = `/chat/messages/${message.id}/attachments/${file.id}`;
                              if (file.mimeType.startsWith("image/"))
                                return (
                                  <InlineChatImage
                                    alt={file.originalName}
                                    key={file.id}
                                    mine={mine}
                                    onOpen={() =>
                                      void openAttachment(message, file.id, true)
                                    }
                                    path={`${attachmentPath}?action=preview`}
                                    roleCode={session.roleCode}
                                  />
                                );
                              return (
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
                              );
                            })}
                          </div>
                        ) : null}
                        </article>
                        {!mine ? (
                          <div
                            className={`flex shrink-0 items-center transition group-focus-within:opacity-100 group-hover:opacity-100 ${activeActionMessageId === message.id ? "opacity-100" : "opacity-0"}`}
                          >
                          <button
                            aria-label="Trả lời"
                            className="grid size-8 place-items-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                            onClick={() => setReplyTo(message)}
                            title="Trả lời"
                            type="button"
                          >
                            <Reply aria-hidden="true" size={15} />
                          </button>
                          <button
                              aria-label="Báo cáo"
                              className="grid size-8 place-items-center rounded-full text-[var(--ink-muted)] hover:bg-rose-50 hover:text-[var(--danger)]"
                              onClick={() => {
                                setReportTarget(message);
                                setReportReason("");
                              }}
                              title="Báo cáo"
                              type="button"
                            >
                              <ShieldAlert aria-hidden="true" size={15} />
                            </button>
                          </div>
                        ) : null}
                      </div>
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
                  className="shrink-0 border-t border-[var(--rule-strong)] bg-[var(--surface)] p-3"
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
                  <div className="flex min-h-14 items-end gap-1 rounded-2xl border border-[var(--rule-strong)] bg-[var(--surface)] p-1.5 transition focus-within:border-[var(--accent)] focus-within:ring-3 focus-within:ring-[var(--accent)]/15">
                    <label
                      aria-label="Đính kèm tệp"
                      className={`grid size-11 shrink-0 place-items-center rounded-xl text-[var(--ink-soft)] transition-colors ${recording || sending ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"}`}
                      title="Đính kèm tệp"
                    >
                      <Plus aria-hidden="true" size={22} />
                      <input
                        accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt,.webm,.ogg,.m4a,.mp3,audio/*"
                        className="sr-only"
                        disabled={recording || sending}
                        multiple
                        onChange={(event) => {
                          const next = Array.from(event.target.files ?? []);
                          queueMessageFiles(next);
                          event.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    <textarea
                      aria-label="Nội dung tin nhắn"
                      className="max-h-32 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus-visible:outline-none"
                      maxLength={5000}
                      onChange={(event) => updateDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          !shouldSendChatMessage(
                            event.key,
                            event.shiftKey,
                            event.nativeEvent.isComposing,
                          ) ||
                          sending
                        )
                          return;
                        event.preventDefault();
                        void sendMessage();
                      }}
                      placeholder="Nhập tin nhắn…"
                      rows={1}
                      value={draft}
                    />
                    <button
                      aria-label={recording ? "Dừng ghi âm" : "Ghi âm"}
                      aria-pressed={recording}
                      className={`grid size-11 shrink-0 place-items-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${recording ? "bg-[var(--danger-soft)] text-[var(--danger)] ring-1 ring-[var(--danger)]/30" : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"}`}
                      disabled={sending}
                      onClick={() => void toggleRecording()}
                      title={recording ? "Dừng ghi âm" : "Ghi âm"}
                      type="button"
                    >
                      {recording ? (
                        <Square aria-hidden="true" fill="currentColor" size={14} />
                      ) : (
                        <Mic aria-hidden="true" size={20} />
                      )}
                    </button>
                    <span aria-live="polite" className="sr-only">
                      {recording ? "Đang ghi âm" : ""}
                    </span>
                    <button
                      aria-label="Gửi tin nhắn"
                      aria-busy={sending || undefined}
                      className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--action)] text-[var(--action-ink)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={
                        sending ||
                        recording ||
                        (!draft.trim() && !messageFiles.length)
                      }
                      type="submit"
                    >
                      {sending ? (
                        <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
                      ) : (
                        <ArrowUp aria-hidden="true" size={19} strokeWidth={2.25} />
                      )}
                    </button>
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
