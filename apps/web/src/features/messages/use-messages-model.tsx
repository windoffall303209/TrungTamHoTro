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
import {
  SHARED_DEFAULT_CONTACTS,
  getStoredChatMessages,
  appendSharedChatMessage,
  subscribeSharedChat,
} from "@/lib/chat-shared-store";
import type {
  ChatConversation,
  ChatDirectoryEntry,
  ChatMessage,
  ChatMessagePage,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStoredDrafts } from "./messages.shared";

/** Tạo danh sách hội thoại đồng bộ hoàn toàn giữa server và danh bạ liên hệ dùng chung */
function buildSharedConversations(
  serverRows: ChatConversation[],
  sessionUserId: string,
  sessionUserName: string,
  sessionRoleCode: string,
): ChatConversation[] {
  const result: ChatConversation[] = [...serverRows];
  const storedMessages = getStoredChatMessages();

  for (const contact of SHARED_DEFAULT_CONTACTS) {
    if (!result.some((c) => c.id === contact.id)) {
      const msgs = storedMessages[contact.id] || [];
      const last = msgs[msgs.length - 1];
      result.push({
        id: contact.id,
        title: contact.name,
        type: contact.type || "DIRECT",
        readOnly: false,
        unreadCount: contact.unreadCount || 0,
        mutedUntil: null,
        members: [
          {
            userId: sessionUserId,
            displayName: sessionUserName,
            roleCode: sessionRoleCode,
            status: "ACTIVE",
          },
          {
            userId: contact.id,
            displayName: contact.name,
            roleCode: contact.role || "MEMBER",
            status: "ACTIVE",
          },
        ],
        lastMessage: last
          ? {
              id: last.id,
              content: last.content,
              createdAt: last.createdAt,
              senderId: last.senderId,
              senderName: last.senderName,
            }
          : contact.lastMessageText
            ? {
                id: `init-${contact.id}`,
                content: contact.lastMessageText,
                createdAt: new Date().toISOString(),
                senderId: contact.id,
                senderName: contact.name,
              }
            : undefined,
      });
    }
  }
  return result;
}

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình tin nhắn; giữ nguyên thứ tự hook. */
export function useMessagesModel() {
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

  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(true);

  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "groups">("all");

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
    let rows: ChatConversation[] = [];
    try {
      rows = await apiRequest<ChatConversation[]>("/chat/conversations", {
        roleCode: session.roleCode,
      });
    } catch {
      rows = [];
    }
    const merged = buildSharedConversations(
      rows,
      session.user.id,
      session.user.name,
      session.roleCode,
    );
    setConversations(merged);
    setSelectedId((current) =>
      current && merged.some((item) => item.id === current)
        ? current
        : (merged[0]?.id ?? ""),
    );
  }, [session.roleCode, session.user.id, session.user.name]);

  /** Nạp một trang tin mới nhất rồi đồng bộ mốc đã đọc. */
  const loadMessages = useCallback(
    async (conversationId: string, quiet = false) => {
      try {
        let serverMessages: ChatMessage[] = [];
        try {
          const page = await apiRequest<ChatMessagePage>(
            `/chat/conversations/${conversationId}/messages?limit=80`,
            { roleCode: session.roleCode },
          );
          serverMessages = page.items
            .map(normalizeChatMessage)
            .filter((item): item is ChatMessage => Boolean(item));
          await apiRequest(`/chat/conversations/${conversationId}/read`, {
            method: "PATCH",
            roleCode: session.roleCode,
          });
        } catch {
          // Bỏ qua lỗi server nếu hội thoại thuộc danh bạ dùng chung
        }

        const stored = getStoredChatMessages()[conversationId] || [];
        const localMapped: ChatMessage[] = stored.map((msg) => ({
          id: msg.id,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content,
          createdAt: msg.createdAt,
          replyTo: msg.replyTo,
          attachments: [],
        }));

        const mergedMap = new Map<string, ChatMessage>();
        for (const m of serverMessages) mergedMap.set(m.id, m);
        for (const m of localMapped) {
          if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
        }

        const sorted = Array.from(mergedMap.values()).sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        setMessages(sorted);

        if (!quiet)
          window.requestAnimationFrame(() => {
            const storedScroll = window.sessionStorage.getItem(
              `wind-chat-scroll:${session.user.id}:${conversationId}`,
            );
            if (storedScroll && messagePaneRef.current)
              messagePaneRef.current.scrollTop = Number(storedScroll);
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

  // Lắng nghe sự kiện đồng bộ tin nhắn từ mini-chat widget hoặc tab khác
  useEffect(() => {
    const unsubscribe = subscribeSharedChat((event) => {
      const detail = event.detail;
      if (detail?.conversationId) {
        if (detail.conversationId === selectedId) {
          void loadMessages(selectedId, true);
        }
        void loadConversations();
      }
    });
    return unsubscribe;
  }, [loadConversations, loadMessages, selectedId]);

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
      const isSharedContact = SHARED_DEFAULT_CONTACTS.some(
        (c) => c.id === selectedId,
      );
      if (!isSharedContact) {
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
      }

      // Đồng bộ tin nhắn gửi vào kho chung để widget chat cũng nhận được
      appendSharedChatMessage({
        id: payload.clientMessageId,
        conversationId: selectedId,
        senderId: session.user.id,
        senderName: session.user.name || "Tôi",
        content: payload.content,
        createdAt: new Date().toISOString(),
        replyTo: replyTo
          ? {
              id: replyTo.id,
              senderName: replyTo.senderName,
              content: replyTo.content,
            }
          : undefined,
      });

      // Nếu liên hệ có hỗ trợ phản hồi tự động thì kích hoạt sau 1.5s
      const autoContact = SHARED_DEFAULT_CONTACTS.find(
        (c) => c.id === selectedId,
      );
      if (autoContact) {
        setTimeout(() => {
          const replyText =
            autoContact.id === "teacher-1"
              ? "Thầy/Cô đã nhận được câu hỏi của em. Em xem lại công thức ở mục 3 trang 45 nhé!"
              : autoContact.id === "student-hai"
                ? "Ok bạn ơi, lát làm xong bài tập gửi mình xem đối chiếu kết quả với nhé!"
                : autoContact.id === "teacher-nam"
                  ? "Chào em, bài thực hành em nộp chạy thử rất ổn. Nhớ chú ý tối ưu thuật toán thêm nhé."
                  : autoContact.id === "student-anime"
                    ? "Tài liệu học tập nằm ở tab Kho tài liệu hoặc phần đính kèm lớp học nhé bạn!"
                    : "Trung tâm hỗ trợ Wind EDU đã ghi nhận yêu cầu của bạn và sẽ kiểm tra trong ít phút.";
          appendSharedChatMessage({
            id: `reply-${Date.now()}`,
            conversationId: selectedId,
            senderId: autoContact.id,
            senderName: autoContact.name,
            content: replyText,
            createdAt: new Date().toISOString(),
          });
        }, 1500);
      }

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
      setSearchResults(
        rows
          .map(normalizeChatMessage)
          .filter((item): item is ChatMessage => Boolean(item)),
      );
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
    searching,
    sending,
    recording,
    activeActionMessageId,
    setActiveActionMessageId,
    replyTo,
    setReplyTo,
    failedMessage,
    messageFiles,
    setMessageFiles,
    mentionedUserIds,
    setMentionedUserIds,
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
    pendingContext,
    setPendingContext,
    bottomRef,
    messagePaneRef,
    selected,
    draft,
    queueMessageFiles,
    toggleRecording,
    updateDraft,
    searchDirectory,
    openDirect,
    openClass,
    sendMessage,
    searchConversation,
    toggleMute,
    reportMessage,
    blockDirectUser,
    openAttachment,
    classChoices,
    isInfoPanelOpen,
    setIsInfoPanelOpen,
    activeFilter,
    setActiveFilter,
  };
}
