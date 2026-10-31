"use client";

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
} from "@/lib/chat-message";
import type {
  ChatConversation,
  ChatDirectoryEntry,
  ChatMessage,
  ChatMessagePage,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadStoredDrafts } from "./messages.shared";

/** Quản lý trạng thái, tải dữ liệu từ CSDL và điều khiển hành động của màn hình tin nhắn 1-1. */
export function useMessagesModel() {
  const { session, notify } = useApp();
  const { locale } = useI18n();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [directory, setDirectory] = useState<ChatDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    loadStoredDrafts(session.user.id),
  );

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [failedMessage, setFailedMessage] = useState<{
    content: string;
    clientMessageId: string;
    replyToId?: string;
    files?: File[];
    contextType?: "ASSIGNMENT" | "EXAM" | "MATERIAL";
    contextId?: string;
  } | null>(null);

  const [messageFiles, setMessageFiles] = useState<File[]>([]);
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
  const recordingRequestRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  const messageFilesRef = useRef(messageFiles);
  const draftsRef = useRef(drafts);
  const conversationsRequestRef = useRef(0);
  const messagesRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const sendingRef = useRef(false);

  const selected = conversations.find((item) => item.id === selectedId);
  const draft = selectedId ? (drafts[selectedId] ?? "") : "";

  /** Dừng toàn bộ track micro để giải phóng thiết bị ngay lập tức. */
  const releaseMicrophone = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  /** Thêm tệp vào hàng chờ sau khi kiểm tra dung lượng và số lượng. */
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

  /** Bắt đầu hoặc kết thúc ghi âm tin nhắn thoại. */
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
    const requestId = ++recordingRequestRef.current;
    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (
        requestId !== recordingRequestRef.current ||
        conversationId !== selectedIdRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = selectChatRecordingMimeType(
        MediaRecorder.isTypeSupported,
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (mediaRecorderRef.current !== recorder) return;
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (mediaRecorderRef.current !== recorder) return;
        discardRecordingRef.current = true;
        releaseMicrophone();
        setRecording(false);
        notify("Không thể tiếp tục ghi âm. Hãy kiểm tra lại micro.", "error");
      };
      recorder.onstop = () => {
        if (mediaRecorderRef.current !== recorder) return;
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
      if (recordingStreamRef.current !== acquiredStream)
        acquiredStream?.getTracks().forEach((track) => track.stop());
      if (requestId !== recordingRequestRef.current) return;
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

  /** Nạp danh sách hội thoại 1-1 từ CSDL thật, loại bỏ hoàn toàn các hội thoại nhóm. */
  const loadConversations = useCallback(async (quiet = false) => {
    const requestId = ++conversationsRequestRef.current;
    try {
      const rows = await apiRequest<ChatConversation[]>("/chat/conversations", {
        roleCode: session.roleCode,
      });
      if (requestId !== conversationsRequestRef.current) return;
      // Chỉ nhận các hội thoại 1-1 (DIRECT)
      const directOnly = rows.filter((item) => item.type === "DIRECT");
      setConversations(directOnly);
      setSelectedId((current) =>
        current && directOnly.some((item) => item.id === current)
          ? current
          : (directOnly[0]?.id ?? ""),
      );
    } catch (error) {
      if (requestId !== conversationsRequestRef.current) return;
      if (!quiet) notify(
        error instanceof Error
          ? error.message
          : "Không tải được danh sách tin nhắn từ CSDL.",
        "error",
      );
    }
  }, [notify, session.roleCode]);

  /** Nạp lịch sử tin nhắn từ CSDL cho một hội thoại và cập nhật mốc đã đọc. */
  const loadMessages = useCallback(
    async (conversationId: string, quiet = false) => {
      const requestId = ++messagesRequestRef.current;
      try {
        const page = await apiRequest<ChatMessagePage>(
          `/chat/conversations/${conversationId}/messages?limit=80`,
          { roleCode: session.roleCode },
        );
        // Tránh ghi lịch sử của hội thoại cũ khi người dùng đã chuyển hội thoại.
        if (conversationId !== selectedIdRef.current || requestId !== messagesRequestRef.current) return;
        const history = page.items
          .map(normalizeChatMessage)
          .filter((item): item is ChatMessage => Boolean(item));
        setMessages((current) => {
          const ids = new Set(history.map((item) => item.id));
          // Giữ các tin SSE đã đến trong khi API đang tải lịch sử.
          const live = current.filter((item) => item.conversationId === conversationId && !ids.has(item.id));
          return [...history, ...live].sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          );
        });
        await apiRequest(`/chat/conversations/${conversationId}/read`, {
          method: "PATCH",
          roleCode: session.roleCode,
        });
        if (conversationId !== selectedIdRef.current || requestId !== messagesRequestRef.current) return;
        if (!quiet)
          window.requestAnimationFrame(() => {
            if (conversationId !== selectedIdRef.current || requestId !== messagesRequestRef.current) return;
            let stored: string | null = null;
            try {
              stored = window.sessionStorage.getItem(
                `wind-chat-scroll:${session.user.id}:${conversationId}`,
              );
            } catch {
              // Vẫn hiển thị tin mới nhất khi trình duyệt chặn lưu vị trí cuộn.
            }
            if (stored && messagePaneRef.current)
              messagePaneRef.current.scrollTop = Number(stored);
            else bottomRef.current?.scrollIntoView({ block: "end" });
          });
      } catch (error) {
        if (!quiet && conversationId === selectedIdRef.current && requestId === messagesRequestRef.current)
          notify(
            error instanceof Error ? error.message : "Không tải được tin nhắn.",
            "error",
          );
      }
    },
    [notify, session.roleCode, session.user.id],
  );

  // Khởi tạo danh sách hội thoại từ CSDL khi tải trang
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConversations().finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  // Cập nhật hội thoại chưa chọn và phục hồi tin nhắn khi luồng SSE gián đoạn.
  useEffect(() => {
    /** Đồng bộ lại danh sách và tin nhắn khi quay lại cửa sổ hoặc hết chu kỳ dự phòng. */
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadConversations(true);
      if (selectedIdRef.current) void loadMessages(selectedIdRef.current, true);
    };
    const intervalId = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadConversations, loadMessages]);

  // Đồng bộ id và file hiện tại cho recording
  useEffect(() => {
    selectedIdRef.current = selectedId;
    messageFilesRef.current = messageFiles;
  }, [messageFiles, selectedId]);

  // Kết quả tìm kiếm chỉ thuộc hội thoại đã chọn tại thời điểm truy vấn.
  useEffect(() => {
    searchRequestRef.current += 1;
    setSearchResults([]);
  }, [selectedId]);

  // Hủy bản ghi âm nếu người dùng chuyển hội thoại
  useEffect(() => {
    return () => {
      recordingRequestRef.current += 1;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        discardRecordingRef.current = true;
        recorder.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    };
  }, [selectedId]);

  // Xử lý deep link query parameters từ các trang khác
  useEffect(() => {
    if (loading || handledDeepLinkRef.current) return;
    handledDeepLinkRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversationId");
    const userId = params.get("userId");
    const contextType = params.get("contextType");
    const contextId = params.get("contextId");

    if (
      ["ASSIGNMENT", "EXAM", "MATERIAL"].includes(contextType ?? "") &&
      contextId
    ) {
      setPendingContext({
        type: contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
        id: contextId,
        title: params.get("contextTitle") ?? "Nội dung được chia sẻ",
      });
    }

    if (conversationId) {
      const available = conversations.some((item) => item.id === conversationId);
      if (available) setSelectedId(conversationId);
      return;
    }

    if (userId) {
      void apiRequest<ChatConversation>("/chat/conversations/direct", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId }),
      })
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
    }
  }, [conversations, loadConversations, loading, notify, session.roleCode]);

  // Lắng nghe sự kiện Server-Sent Events (SSE) để nhận tin nhắn mới theo thời gian thực
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const initialTimer = window.setTimeout(() => {
      void loadMessages(selectedId);
    }, 0);
    const events = new EventSource(
      publicApiUrl(`/chat/conversations/${selectedId}/events`),
      { withCredentials: true },
    );
    events.onmessage = (event) => {
      if (!active || selectedId !== selectedIdRef.current) return;
      try {
        const message = normalizeChatMessage(JSON.parse(event.data));
        if (!message || message.conversationId !== selectedId) return;
        setMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message].sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
              ),
        );
        void apiRequest(`/chat/conversations/${selectedId}/read`, {
          method: "PATCH",
          roleCode: session.roleCode,
        }).catch((error: unknown) => {
          if (active && selectedId === selectedIdRef.current)
            notify(
              error instanceof Error ? error.message : "Không đánh dấu được tin nhắn đã đọc.",
              "error",
            );
        });
        void loadConversations();
        window.requestAnimationFrame(() => {
          if (active && selectedId === selectedIdRef.current)
            bottomRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "end",
            });
        });
      } catch (error) {
        console.warn("Bỏ qua sự kiện tin nhắn không hợp lệ.", error);
      }
    };
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      events.close();
    };
  }, [loadConversations, loadMessages, notify, selectedId, session.roleCode]);

  /** Cập nhật bản nháp theo id cố định để request cũ không ghi đè bản nháp mới. */
  const saveDraft = (conversationId: string, value: string) => {
    if (!conversationId) return;
    const next = { ...draftsRef.current, [conversationId]: value };
    draftsRef.current = next;
    setDrafts(next);
    try {
      window.localStorage.setItem(
        `wind-chat-drafts:${session.user.id}`,
        JSON.stringify(next),
      );
    } catch {
      // Giữ bản nháp trong React state khi không thể ghi localStorage.
    }
  };

  /** Lưu nội dung đang nhập cho hội thoại hiện tại. */
  const updateDraft = (value: string) => saveDraft(selectedId, value);

  /** Tìm kiếm người dùng thật từ CSDL để bắt đầu nhắn tin 1-1 */
  const searchDirectory = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestId = ++directoryRequestRef.current;
    try {
      const entries = await apiRequest<ChatDirectoryEntry[]>(
        `/chat/directory?q=${encodeURIComponent(query)}`,
        { roleCode: session.roleCode },
      );
      if (requestId === directoryRequestRef.current) setDirectory(entries);
    } catch (error) {
      if (requestId !== directoryRequestRef.current) return;
      notify(
        error instanceof Error ? error.message : "Không tìm được người dùng.",
        "error",
      );
    }
  };

  /** Mở hội thoại 1-1 với một người dùng từ CSDL */
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
      directoryRequestRef.current += 1;
      setDirectory([]);
      setQuery("");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được hội thoại.",
        "error",
      );
    }
  };

  /** Gửi tin nhắn thật vào CSDL qua API backend */
  const sendMessage = async (
    event?: React.FormEvent,
    retry = failedMessage,
  ) => {
    event?.preventDefault();
    if (!selectedId || selected?.readOnly || sendingRef.current) return;
    const conversationId = selectedId;
    const submittedDraft = draft;
    const payload = retry ?? {
      content: draft.trim(),
      clientMessageId: crypto.randomUUID(),
      replyToId: replyTo?.id,
      files: messageFiles,
      contextType: pendingContext?.type,
      contextId: pendingContext?.id,
    };
    if (!payload.content && !payload.files?.length) return;
    sendingRef.current = true;
    setSending(true);
    setFailedMessage(null);
    try {
      const body = payload.files?.length
        ? new FormData()
        : JSON.stringify({
            content: payload.content,
            clientMessageId: payload.clientMessageId,
            replyToId: payload.replyToId,
            contextType: payload.contextType,
            contextId: payload.contextId,
          });
      if (body instanceof FormData) {
        body.set("content", payload.content);
        body.set("clientMessageId", payload.clientMessageId);
        if (payload.replyToId) body.set("replyToId", payload.replyToId);
        if (payload.contextType) body.set("contextType", payload.contextType);
        if (payload.contextId) body.set("contextId", payload.contextId);
        payload.files?.forEach((file) => body.append("files", file));
      }
      await apiRequest(`/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        roleCode: session.roleCode,
        body,
      });

      if (draftsRef.current[conversationId] === submittedDraft) saveDraft(conversationId, "");
      if (conversationId === selectedIdRef.current) {
        setReplyTo((current) => current?.id === replyTo?.id ? null : current);
        if (messageFilesRef.current === messageFiles) {
          messageFilesRef.current = [];
          setMessageFiles([]);
        }
        setPendingContext((current) => current?.id === pendingContext?.id && current?.type === pendingContext?.type ? null : current);
      }
      await loadMessages(conversationId);
      await loadConversations();
    } catch (error) {
      if (conversationId === selectedIdRef.current) setFailedMessage(payload);
      notify(
        error instanceof Error ? error.message : "Tin nhắn chưa gửi được.",
        "error",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  /** Tìm kiếm từ khóa trong các tin nhắn của hội thoại hiện tại */
  const searchConversation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || messageQuery.trim().length < 2) return;
    const conversationId = selectedId;
    const requestId = ++searchRequestRef.current;
    try {
      const rows = await apiRequest<ChatMessage[]>(
        `/chat/conversations/${conversationId}/search?q=${encodeURIComponent(messageQuery)}`,
        { roleCode: session.roleCode },
      );
      if (conversationId !== selectedIdRef.current || requestId !== searchRequestRef.current) return;
      setSearchResults(
        rows
          .map(normalizeChatMessage)
          .filter((item): item is ChatMessage => Boolean(item)),
      );
    } catch (error) {
      if (conversationId === selectedIdRef.current && requestId === searchRequestRef.current)
        notify(
          error instanceof Error ? error.message : "Không tìm được tin nhắn.",
          "error",
        );
    }
  };

  /** Bật hoặc tắt thông báo hội thoại trong 24 giờ */
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

  /** Gửi báo cáo tin nhắn vi phạm */
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

  /** Chặn liên hệ riêng với người đang chat 1-1 */
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

  /** Xem trước hoặc tải tệp chat */
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

  return {
    session,
    locale,
    conversations,
    selectedId,
    setSelectedId,
    messages,
    directory,
    query,
    setQuery,
    loading,
    sending,
    recording,
    replyTo,
    setReplyTo,
    messageFiles,
    setMessageFiles,
    messageQuery,
    setMessageQuery,
    searchResults,
    setSearchResults,
    reportTarget,
    setReportTarget,
    reportReason,
    setReportReason,
    blockOpen,
    setBlockOpen,
    blockReason,
    setBlockReason,
    bottomRef,
    messagePaneRef,
    selected,
    draft,
    queueMessageFiles,
    toggleRecording,
    updateDraft,
    searchDirectory,
    openDirect,
    sendMessage,
    searchConversation,
    toggleMute,
    reportMessage,
    blockDirectUser,
    openAttachment,
  };
}
