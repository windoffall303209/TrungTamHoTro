"use client";

import { Button, Field, inputClass, Modal } from "@/components/ui";
import {
  shouldSendChatMessage,
  shouldStartChatTimeGroup,
} from "@/lib/chat-message";
import { SHARED_DEFAULT_CONTACTS } from "@/lib/chat-shared-store";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Bell,
  BellOff,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Lock,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Reply,
  RotateCcw,
  Search,
  ShieldAlert,
  Smile,
  Square,
  SquarePen,
  ThumbsUp,
  User,
  Users,
  UserX,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { InlineChatImage, roleLabels } from "./messages.shared";
import { useMessagesModel } from "./use-messages-model";

/** Hiển thị avatar tròn dạng chữ cái viết tắt hoặc hình đại diện */
function MessengerAvatarBadge({
  name,
  gradient,
  size = "md",
  isOnline = true,
}: {
  name: string;
  gradient?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  isOnline?: boolean;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const sizeClass = {
    xs: "size-4 text-[9px]",
    sm: "size-7 text-xs",
    md: "size-12 text-sm",
    lg: "size-14 text-base",
    xl: "size-20 text-xl",
  }[size];

  const dotSize = {
    xs: "size-1.5 border-1",
    sm: "size-2.5 border-1.5",
    md: "size-3.5 border-2",
    lg: "size-4 border-2",
    xl: "size-5 border-2",
  }[size];

  return (
    <div className="relative shrink-0 select-none">
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-tr ${
          gradient || "from-blue-600 via-indigo-600 to-purple-600"
        } grid place-items-center text-white font-bold shadow-sm overflow-hidden`}
      >
        {initials || "U"}
      </div>
      {isOnline && (
        <span
          className={`absolute bottom-0 right-0 ${dotSize} rounded-full bg-emerald-500 border-[#181920] shadow-xs`}
          title="Đang hoạt động"
        />
      )}
    </div>
  );
}

/** Lắp ghép màn hình tin nhắn Facebook Messenger chuẩn 3 cột chuyên nghiệp */
export default function MessagesScreen() {
  const model = useMessagesModel();
  const {
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
  } = model;

  // Trạng thái đóng/mở các mục accordion của Cột 3 (Thông tin đoạn chat)
  const [accordionOpen, setAccordionOpen] = useState<{
    info: boolean;
    customize: boolean;
    media: boolean;
    privacy: boolean;
  }>({
    info: true,
    customize: true,
    media: false,
    privacy: false,
  });

  // Tìm contact tương ứng từ SHARED_DEFAULT_CONTACTS để lấy gradient & status
  const currentContact = SHARED_DEFAULT_CONTACTS.find(
    (c) => c.id === selected?.id,
  );

  // Lọc danh sách đoạn chat theo các tab Messenger: Tất cả, Chưa đọc, Nhóm
  const filteredConversations = conversations.filter((item) => {
    if (activeFilter === "unread") return (item.unreadCount ?? 0) > 0;
    if (activeFilter === "groups") return item.type === "CLASS";
    return true;
  });

  return (
    <div className="mx-auto h-[calc(100dvh-4.5rem)] max-w-[1920px] p-0 md:p-3">
      <div className="flex h-full min-h-0 overflow-hidden rounded-none md:rounded-2xl border border-slate-800 bg-[#121319] text-slate-100 shadow-2xl">
        {/* ===================== CỘT 1: SIDEBAR ĐOẠN CHAT (~360px) ===================== */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } w-full md:w-[350px] lg:w-[360px] shrink-0 min-h-0 flex-col border-r border-slate-800/90 bg-[#16171f]`}
        >
          {/* Header Đoạn chat với nút ba chấm và nút Soạn tin nhắn mới */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 select-none">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Đoạn chat
            </h1>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="grid size-9 place-items-center rounded-full bg-[#2a2b35] hover:bg-[#383a48] text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Tùy chọn đoạn chat"
              >
                <MoreHorizontal size={19} />
              </button>
              <button
                type="button"
                className="grid size-9 place-items-center rounded-full bg-[#2a2b35] hover:bg-[#383a48] text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Soạn tin nhắn mới"
                onClick={() => {
                  const input = document.getElementById("messenger-search-input");
                  input?.focus();
                }}
              >
                <SquarePen size={18} />
              </button>
            </div>
          </div>

          {/* Thanh tìm kiếm hình viên thuốc chuẩn Facebook Messenger */}
          <div className="px-3.5 py-2">
            <form
              className="relative flex items-center"
              onSubmit={(event) => void searchDirectory(event)}
            >
              <Search
                size={16}
                className="absolute left-3.5 text-slate-400 pointer-events-none"
              />
              <input
                id="messenger-search-input"
                aria-label="Tìm kiếm trên Messenger"
                className="w-full h-10 rounded-full bg-[#252631] pl-10 pr-4 text-xs sm:text-sm text-white placeholder:text-slate-400 border border-transparent focus:border-purple-500/50 focus:bg-[#20212a] outline-none transition-all"
                placeholder="Tìm kiếm trên Messenger"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 text-slate-400 hover:text-white"
                >
                  <X size={15} />
                </button>
              )}
            </form>
          </div>

          {/* Các tab phân loại hội thoại: Tất cả - Chưa đọc - Nhóm */}
          <div className="flex items-center gap-1.5 px-3.5 pb-2 border-b border-slate-800/80 select-none overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                activeFilter === "all"
                  ? "bg-[#2e89ff]/20 text-[#60a5fa] border border-[#2e89ff]/40 shadow-xs"
                  : "bg-[#252631] text-slate-400 hover:bg-[#2d2e3b] hover:text-slate-200"
              }`}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("unread")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                activeFilter === "unread"
                  ? "bg-[#2e89ff]/20 text-[#60a5fa] border border-[#2e89ff]/40 shadow-xs"
                  : "bg-[#252631] text-slate-400 hover:bg-[#2d2e3b] hover:text-slate-200"
              }`}
            >
              Chưa đọc
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("groups")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                activeFilter === "groups"
                  ? "bg-[#2e89ff]/20 text-[#60a5fa] border border-[#2e89ff]/40 shadow-xs"
                  : "bg-[#252631] text-slate-400 hover:bg-[#2d2e3b] hover:text-slate-200"
              }`}
            >
              Nhóm
            </button>
          </div>

          {/* Kết quả tìm kiếm danh bạ hệ thống khi có query */}
          {directory.length || classChoices.length ? (
            <div className="max-h-72 overflow-y-auto border-b border-slate-800 p-2 bg-[#1c1d27]">
              <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Kết quả tìm kiếm
              </p>
              {classChoices.map((item) => (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#282937] transition-colors cursor-pointer"
                  key={item.id}
                  onClick={() => void openClass(item.id)}
                  type="button"
                >
                  <div className="size-10 rounded-full bg-indigo-600/30 text-indigo-400 grid place-items-center">
                    <Users size={18} />
                  </div>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs sm:text-sm text-white">
                      {item.name}
                    </strong>
                    <small className="text-slate-400">
                      {item.code} · Nhóm lớp
                    </small>
                  </span>
                </button>
              ))}
              {directory.map((entry) => (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#282937] transition-colors cursor-pointer"
                  key={entry.id}
                  onClick={() => void openDirect(entry.id)}
                  type="button"
                >
                  <MessengerAvatarBadge name={entry.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs sm:text-sm text-white">
                      {entry.displayName}
                    </strong>
                    <small className="text-slate-400">
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

          {/* Danh sách cuộc trò chuyện chuẩn phong cách Messenger */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <LoaderCircle className="animate-spin mb-2" size={24} />
                <p className="text-xs">Đang tải đoạn chat…</p>
              </div>
            ) : filteredConversations.length ? (
              filteredConversations.map((item) => {
                const isSelected = item.id === selectedId;
                const matchContact = SHARED_DEFAULT_CONTACTS.find(
                  (c) => c.id === item.id,
                );
                return (
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                    className={`group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[#252735] text-white shadow-xs"
                        : "hover:bg-[#1d1f2a] text-slate-300"
                    }`}
                  >
                    <MessengerAvatarBadge
                      name={item.title}
                      gradient={matchContact?.gradient}
                      size="md"
                      isOnline={matchContact?.isOnline ?? true}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <strong
                          className={`truncate text-[14px] ${
                            isSelected || (item.unreadCount ?? 0) > 0
                              ? "font-bold text-white"
                              : "font-semibold text-slate-200"
                          }`}
                        >
                          {item.title}
                        </strong>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {matchContact?.lastMessageTime || "Vừa xong"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p
                          className={`truncate text-[12px] leading-tight ${
                            (item.unreadCount ?? 0) > 0
                              ? "font-bold text-white"
                              : "text-slate-400"
                          }`}
                        >
                          {item.lastMessage?.content ??
                            (item.type === "CLASS"
                              ? "Nhóm lớp học"
                              : "Chưa có tin nhắn")}
                        </p>
                        {(item.unreadCount ?? 0) > 0 && (
                          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-blue-500 text-[10px] font-black text-white">
                            {item.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="p-6 text-center text-xs leading-5 text-slate-400">
                Không có đoạn chat nào trong mục này.
              </p>
            )}
          </div>
        </aside>

        {/* ===================== CỘT 2: KHUNG CHAT CHÍNH (FLEX-1) ===================== */}
        <section
          className={`${
            selectedId ? "flex" : "hidden md:flex"
          } flex-1 min-h-0 min-w-0 flex-col bg-[#14151d]`}
        >
          {selected ? (
            <>
              {/* Header Messenger với nút Gọi thoại, Video Call và nút Thông tin (Cột 3) */}
              <header className="h-16 px-4 bg-[#1a1b24] border-b border-slate-800/90 flex items-center justify-between select-none">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    aria-label="Quay lại danh sách"
                    className="grid size-9 place-items-center md:hidden rounded-full hover:bg-slate-700/60 text-slate-300"
                    onClick={() => setSelectedId("")}
                    type="button"
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <MessengerAvatarBadge
                    name={selected.title}
                    gradient={currentContact?.gradient}
                    size="sm"
                    isOnline={currentContact?.isOnline ?? true}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm sm:text-base font-bold text-white leading-tight">
                      {selected.title}
                    </h2>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 leading-tight">
                      {currentContact?.isOnline ? (
                        <>
                          <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                          Đang hoạt động
                        </>
                      ) : (
                        currentContact?.statusText || "Hoạt động gần đây"
                      )}
                      {selected.readOnly ? " · Chỉ đọc" : ""}
                    </p>
                  </div>
                </div>

                {/* Các nút hành động header Messenger: Gọi thoại, Video call, Bật tắt Cột 3 */}
                <div className="flex items-center gap-1 text-purple-400">
                  <button
                    type="button"
                    onClick={() => alert("Chức năng gọi thoại đang kết nối…")}
                    className="p-2 rounded-full hover:bg-purple-500/15 transition-colors cursor-pointer"
                    title="Bắt đầu cuộc gọi thoại"
                  >
                    <Phone size={19} />
                  </button>
                  <button
                    type="button"
                    onClick={() => alert("Chức năng gọi video đang kết nối…")}
                    className="p-2 rounded-full hover:bg-purple-500/15 transition-colors cursor-pointer"
                    title="Bắt đầu gọi video"
                  >
                    <Video size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsInfoPanelOpen((prev) => !prev)}
                    className={`p-2 rounded-full transition-colors cursor-pointer ${
                      isInfoPanelOpen
                        ? "bg-purple-500/25 text-purple-300"
                        : "hover:bg-purple-500/15 text-purple-400"
                    }`}
                    title={
                      isInfoPanelOpen
                        ? "Ẩn thông tin đoạn chat"
                        : "Xem thông tin đoạn chat"
                    }
                  >
                    <Info size={20} />
                  </button>
                </div>
              </header>

              {/* Thanh tìm kiếm nhanh nội dung trong cuộc trò chuyện (nếu đang tìm) */}
              {searchResults.length ? (
                <div className="max-h-40 overflow-y-auto border-b border-slate-800 bg-[#1c1d28] px-4 py-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span>
                      {searchResults.length} kết quả cho “{messageQuery}”
                    </span>
                    <button
                      onClick={() => {
                        setSearchResults([]);
                        setMessageQuery("");
                      }}
                      type="button"
                      className="text-slate-400 hover:text-white"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {searchResults.map((item) => (
                    <button
                      className="block w-full border-t border-slate-800/80 py-1.5 text-left text-xs text-slate-300 hover:text-white"
                      key={item.id}
                      onClick={() => setSearchResults([])}
                      type="button"
                    >
                      <strong>{item.senderName}</strong>:{" "}
                      {item.content.slice(0, 100)}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Vùng hiển thị toàn bộ tin nhắn cuộn */}
              <div
                className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[#121319] scrollbar-thin"
                onScroll={(event) =>
                  window.sessionStorage.setItem(
                    `wind-chat-scroll:${session.user.id}:${selected.id}`,
                    String(event.currentTarget.scrollTop),
                  )
                }
                ref={messagePaneRef}
              >
                {/* Banner đầu trang hội thoại */}
                <div className="flex flex-col items-center justify-center p-6 text-center my-4">
                  <MessengerAvatarBadge
                    name={selected.title}
                    gradient={currentContact?.gradient}
                    size="xl"
                    isOnline={false}
                  />
                  <h3 className="text-lg font-bold text-white mt-3">
                    {selected.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {currentContact?.role ||
                      (selected.type === "CLASS"
                        ? "Nhóm thảo luận lớp học"
                        : "Thành viên Wind EDU")}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-2 bg-[#1c1d27] px-3 py-1 rounded-full border border-slate-800">
                    <Lock size={12} className="text-emerald-400" />
                    Được mã hóa đầu cuối
                  </div>
                </div>

                {/* Danh sách bong bóng tin nhắn Messenger */}
                {messages.map((message, index) => {
                  const mine = message.senderId === session.user.id;
                  const startsTimeGroup = shouldStartChatTimeGroup(
                    message.createdAt,
                    messages[index - 1]?.createdAt,
                  );
                  const isLastMessage = index === messages.length - 1;

                  return (
                    <div key={message.id}>
                      {startsTimeGroup ? (
                        <div className="my-4 text-center">
                          <span className="text-[11px] font-semibold text-slate-400 bg-[#1e202a] px-3 py-1 rounded-full border border-slate-800">
                            {new Date(message.createdAt).toLocaleDateString(
                              "vi-VN",
                              {
                                weekday: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                        </div>
                      ) : null}

                      <div
                        className={`group flex items-end gap-2 ${
                          mine ? "justify-end" : "justify-start"
                        }`}
                      >
                        {!mine && (
                          <div className="mb-0.5 shrink-0">
                            <MessengerAvatarBadge
                              name={message.senderName || selected.title}
                              gradient={currentContact?.gradient}
                              size="xs"
                              isOnline={false}
                            />
                          </div>
                        )}

                        <div
                          className={`flex flex-col ${
                            mine ? "items-end" : "items-start"
                          } max-w-[75%] sm:max-w-[70%]`}
                        >
                          {/* Trích dẫn tin nhắn đang reply nếu có */}
                          {message.replyTo ? (
                            <span
                              className={`mb-1 block rounded-xl px-3 py-1.5 text-[11px] border leading-snug ${
                                mine
                                  ? "bg-purple-950/40 border-purple-800/60 text-purple-200"
                                  : "bg-[#252735] border-slate-700 text-slate-300"
                              }`}
                            >
                              <strong className="block text-[10px] text-slate-400">
                                Trả lời {message.replyTo.senderName}:
                              </strong>
                              {message.replyTo.content}
                            </span>
                          ) : null}

                          {/* Bong bóng tin nhắn chính */}
                          <div
                            className={`relative px-4 py-2.5 text-xs sm:text-[13.5px] leading-relaxed whitespace-pre-wrap break-words shadow-sm transition-all ${
                              mine
                                ? "bg-gradient-to-r from-[#9333ea] to-[#a855f7] text-white rounded-2xl rounded-br-xs"
                                : "bg-[#282933] text-slate-100 rounded-2xl rounded-bl-xs border border-slate-700/60"
                            }`}
                          >
                            {!mine && selected.type === "CLASS" ? (
                              <strong className="block text-[11px] font-bold text-purple-400 mb-0.5">
                                {message.senderName}
                              </strong>
                            ) : null}

                            <span>{message.content}</span>

                            {/* Liên kết ngữ cảnh bài tập / đề thi / học liệu */}
                            {message.context ? (
                              <Link
                                className={`mt-2 block rounded-xl border p-2.5 font-semibold text-xs ${
                                  mine
                                    ? "border-white/20 bg-white/10 text-white"
                                    : "border-slate-700 bg-slate-900/40 text-purple-300"
                                }`}
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

                            {/* Các tệp đính kèm */}
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
                                          void openAttachment(
                                            message,
                                            file.id,
                                            true,
                                          )
                                        }
                                        path={`${attachmentPath}?action=preview`}
                                        roleCode={session.roleCode}
                                      />
                                    );
                                  return (
                                    <div
                                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                        mine ? "bg-white/15" : "bg-slate-800"
                                      }`}
                                      key={file.id}
                                    >
                                      <Paperclip size={13} />
                                      <span className="truncate flex-1">
                                        {file.originalName}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void openAttachment(
                                            message,
                                            file.id,
                                            false,
                                          )
                                        }
                                      >
                                        <Download size={13} />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>

                          {/* Read receipt avatar nhỏ của người nhận ở cuối tin nhắn (chuẩn Messenger) */}
                          {mine && isLastMessage && (
                            <div className="flex items-center gap-1 mt-1 pr-1">
                              <span className="text-[10px] text-slate-400">
                                Đã xem
                              </span>
                              <MessengerAvatarBadge
                                name={selected.title}
                                gradient={currentContact?.gradient}
                                size="xs"
                                isOnline={false}
                              />
                            </div>
                          )}
                        </div>

                        {/* Nút reply nhanh khi hover */}
                        <button
                          type="button"
                          onClick={() => setReplyTo(message)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-all cursor-pointer"
                          title="Trả lời"
                        >
                          <Reply size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Khung nhập tin nhắn Facebook Messenger với micro, ảnh, sticker, input Aa và nút Gửi/Like */}
              {selected.readOnly ? (
                <div className="p-4 border-t border-slate-800 bg-[#161720] text-center text-xs text-slate-400 font-semibold">
                  Hội thoại này ở trạng thái chỉ đọc.
                </div>
              ) : (
                <form
                  className="p-3 bg-[#161720] border-t border-slate-800/90 select-none"
                  onSubmit={(event) => void sendMessage(event)}
                >
                  {/* Thanh thông báo trả lời tin nhắn */}
                  {replyTo && (
                    <div className="mb-2 flex items-center justify-between rounded-xl bg-[#222430] border border-slate-700/80 px-3 py-2 text-xs text-slate-200">
                      <span className="truncate">
                        <Reply
                          className="mr-1.5 inline text-purple-400"
                          size={13}
                        />
                        Đang trả lời <strong>{replyTo.senderName}</strong>:{" "}
                        {replyTo.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        className="text-slate-400 hover:text-white ml-2"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Thanh tệp đính kèm chờ gửi */}
                  {messageFiles.length ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {messageFiles.map((file, index) => (
                        <span
                          key={`${file.name}-${index}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#252735] border border-slate-700 px-2.5 py-1 text-xs text-slate-200"
                        >
                          <Paperclip size={12} className="text-purple-400" />
                          <span className="truncate max-w-[120px]">
                            {file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setMessageFiles((prev) =>
                                prev.filter((_, i) => i !== index),
                              )
                            }
                            className="text-slate-400 hover:text-rose-400"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* Thanh công cụ nhập liệu Facebook Messenger */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    {/* Nút ghi âm micro */}
                    <button
                      type="button"
                      onClick={() => void toggleRecording()}
                      className={`grid size-9 sm:size-10 shrink-0 place-items-center rounded-full transition-colors cursor-pointer ${
                        recording
                          ? "bg-rose-600 text-white animate-pulse"
                          : "text-purple-400 hover:bg-[#252735]"
                      }`}
                      title={recording ? "Dừng ghi âm" : "Ghi âm tin nhắn thoại"}
                    >
                      {recording ? <Square size={14} /> : <Mic size={19} />}
                    </button>

                    {/* Nút đính kèm ảnh */}
                    <label
                      className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full text-purple-400 hover:bg-[#252735] transition-colors cursor-pointer"
                      title="Đính kèm ảnh"
                    >
                      <ImageIcon size={19} />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          queueMessageFiles(files);
                          e.target.value = "";
                        }}
                      />
                    </label>

                    {/* Nút sticker */}
                    <button
                      type="button"
                      onClick={() => updateDraft(`${draft} 😊`)}
                      className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full text-purple-400 hover:bg-[#252735] transition-colors cursor-pointer"
                      title="Chèn biểu tượng cảm xúc"
                    >
                      <Smile size={19} />
                    </button>

                    {/* Nút GIF */}
                    <button
                      type="button"
                      onClick={() => updateDraft(`${draft} [GIF]`)}
                      className="hidden sm:grid size-10 shrink-0 place-items-center rounded-full text-purple-400 hover:bg-[#252735] text-xs font-black transition-colors cursor-pointer"
                      title="Chèn ảnh GIF"
                    >
                      GIF
                    </button>

                    {/* Ô input Aa viên thuốc bo tròn */}
                    <div className="flex-1 flex items-center rounded-full bg-[#252735] border border-slate-700/80 px-4 py-1.5 focus-within:border-purple-500/80 focus-within:ring-2 focus-within:ring-purple-500/20 transition-all">
                      <input
                        type="text"
                        value={draft}
                        onChange={(e) => updateDraft(e.target.value)}
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
                        placeholder="Aa"
                        className="w-full bg-transparent text-xs sm:text-sm text-white placeholder:text-slate-400 outline-none"
                      />
                    </div>

                    {/* Nút gửi (Send màu tím) hoặc Like (ThumbsUp màu tím) */}
                    {draft.trim() || messageFiles.length ? (
                      <button
                        type="submit"
                        disabled={sending}
                        className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full bg-purple-600 text-white hover:bg-purple-500 transition-colors cursor-pointer shadow-md"
                        title="Gửi tin nhắn"
                      >
                        {sending ? (
                          <LoaderCircle className="animate-spin" size={17} />
                        ) : (
                          <ArrowUp size={18} strokeWidth={2.5} />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          updateDraft("👍");
                          setTimeout(() => void sendMessage(), 50);
                        }}
                        className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full text-purple-400 hover:bg-[#252735] hover:scale-110 active:scale-95 transition-all cursor-pointer"
                        title="Gửi Like"
                      >
                        <ThumbsUp size={20} fill="currentColor" />
                      </button>
                    )}
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-slate-400">
              <div>
                <MessageCircle
                  className="mx-auto mb-3 text-purple-400/60"
                  size={42}
                />
                <h3 className="text-base font-bold text-slate-200">
                  Chọn một đoạn chat
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Chọn người liên hệ bên trái để bắt đầu cuộc trò chuyện.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ===================== CỘT 3: THÔNG TIN ĐOẠN CHAT (~340px) ===================== */}
        {selected && isInfoPanelOpen && (
          <aside className="w-full md:w-[320px] lg:w-[340px] shrink-0 min-h-0 flex-col border-l border-slate-800/90 bg-[#16171f] overflow-y-auto scrollbar-thin select-none hidden lg:flex">
            {/* Header thông tin người nhận với avatar lớn và mã hóa đầu cuối */}
            <div className="flex flex-col items-center justify-center p-6 text-center border-b border-slate-800/80">
              <MessengerAvatarBadge
                name={selected.title}
                gradient={currentContact?.gradient}
                size="xl"
                isOnline={currentContact?.isOnline ?? true}
              />
              <h2 className="text-base font-bold text-white mt-3 leading-snug">
                {selected.title}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {currentContact?.role ||
                  (selected.type === "CLASS" ? "Nhóm lớp" : "Thành viên")}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-2 bg-[#22232f] px-3 py-1 rounded-full border border-slate-800">
                <Lock size={12} className="text-emerald-400" />
                Được mã hóa đầu cuối
              </div>

              {/* 3 nút tròn hành động: Trang cá nhân, Tắt thông báo, Tìm kiếm */}
              <div className="grid grid-cols-3 gap-3 w-full mt-5">
                <button
                  type="button"
                  onClick={() => alert(`Xem trang cá nhân của ${selected.title}`)}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="size-10 rounded-full bg-[#272835] group-hover:bg-[#343647] text-slate-200 flex items-center justify-center transition-colors">
                    <User size={18} />
                  </div>
                  <span className="text-[11px] text-slate-400 group-hover:text-slate-200 font-medium">
                    Trang cá n...
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void toggleMute()}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="size-10 rounded-full bg-[#272835] group-hover:bg-[#343647] text-slate-200 flex items-center justify-center transition-colors">
                    {selected.mutedUntil ? (
                      <BellOff size={18} className="text-purple-400" />
                    ) : (
                      <Bell size={18} />
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 group-hover:text-slate-200 font-medium">
                    {selected.mutedUntil ? "Bật thông báo" : "Tắt thông báo"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById(
                      "messenger-search-input",
                    );
                    input?.focus();
                  }}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="size-10 rounded-full bg-[#272835] group-hover:bg-[#343647] text-slate-200 flex items-center justify-center transition-colors">
                    <Search size={18} />
                  </div>
                  <span className="text-[11px] text-slate-400 group-hover:text-slate-200 font-medium">
                    Tìm kiếm
                  </span>
                </button>
              </div>
            </div>

            {/* Các nhóm Accordion chi tiết chuẩn Messenger */}
            <div className="p-3 space-y-1">
              {/* 1. Thông tin về đoạn chat */}
              <div className="rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setAccordionOpen((prev) => ({ ...prev, info: !prev.info }))
                  }
                  className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:bg-[#20212d] rounded-xl transition-colors cursor-pointer"
                >
                  <span>Thông tin về đoạn chat</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${
                      accordionOpen.info ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {accordionOpen.info && (
                  <div className="px-2 pb-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => alert("Xem các tin nhắn quan trọng đã ghim")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <Pin size={16} className="text-slate-400" />
                      <span>Xem tin nhắn đã ghim</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 2. Tùy chỉnh đoạn chat */}
              <div className="rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setAccordionOpen((prev) => ({
                      ...prev,
                      customize: !prev.customize,
                    }))
                  }
                  className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:bg-[#20212d] rounded-xl transition-colors cursor-pointer"
                >
                  <span>Tùy chỉnh đoạn chat</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${
                      accordionOpen.customize ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {accordionOpen.customize && (
                  <div className="px-2 pb-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => alert("Chủ đề tím gradient Messenger đã kích hoạt")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <span className="size-4 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 shadow-xs" />
                      <span>Đổi chủ đề</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => alert("Biểu tượng cảm xúc mặc định: 👍")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <ThumbsUp size={16} className="text-purple-400" />
                      <span>Thay đổi biểu tượng cảm xúc</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => alert("Chỉnh sửa biệt danh hiển thị trong đoạn chat")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <span className="text-xs font-extrabold text-slate-400 font-mono">
                        Aa
                      </span>
                      <span>Chỉnh sửa biệt danh</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 3. File phương tiện và file */}
              <div className="rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setAccordionOpen((prev) => ({ ...prev, media: !prev.media }))
                  }
                  className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:bg-[#20212d] rounded-xl transition-colors cursor-pointer"
                >
                  <span>File phương tiện và file</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${
                      accordionOpen.media ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {accordionOpen.media && (
                  <div className="px-2 pb-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => alert("Xem kho ảnh và video đã chia sẻ")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <ImageIcon size={16} className="text-slate-400" />
                      <span>File phương tiện</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => alert("Xem các tệp tài liệu đã gửi")}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-slate-300 hover:bg-[#252735] transition-colors cursor-pointer text-left"
                    >
                      <FileText size={16} className="text-slate-400" />
                      <span>File đính kèm</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 4. Quyền riêng tư và hỗ trợ */}
              <div className="rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setAccordionOpen((prev) => ({
                      ...prev,
                      privacy: !prev.privacy,
                    }))
                  }
                  className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:bg-[#20212d] rounded-xl transition-colors cursor-pointer"
                >
                  <span>Quyền riêng tư và hỗ trợ</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${
                      accordionOpen.privacy ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {accordionOpen.privacy && (
                  <div className="px-2 pb-2 space-y-1">
                    {selected.type === "DIRECT" && (
                      <button
                        type="button"
                        onClick={() => setBlockOpen(true)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer text-left"
                      >
                        <UserX size={16} />
                        <span>Chặn người dùng</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const lastMsg = messages[messages.length - 1];
                        if (lastMsg) {
                          setReportTarget(lastMsg);
                          setReportReason("");
                        } else {
                          alert("Chưa có tin nhắn để báo cáo");
                        }
                      }}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-amber-400 hover:bg-amber-950/30 transition-colors cursor-pointer text-left"
                    >
                      <ShieldAlert size={16} />
                      <span>Báo cáo sự cố hoặc tin nhắn</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Modal báo cáo tin nhắn */}
      <Modal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Báo cáo tin nhắn"
        description="Báo cáo được gửi ẩn danh cho ban kiểm duyệt học tập Wind EDU."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void reportMessage(event)}
        >
          <Field label="Lý do báo cáo">
            <textarea
              className={inputClass}
              minLength={5}
              onChange={(event) => setReportReason(event.target.value)}
              required
              rows={4}
              value={reportReason}
              placeholder="Nhập chi tiết lý do bạn báo cáo tin nhắn này…"
            />
          </Field>
          <Button disabled={reportReason.trim().length < 5} type="submit">
            <ShieldAlert size={15} />
            Gửi báo cáo
          </Button>
        </form>
      </Modal>

      {/* Modal chặn người dùng */}
      <Modal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Chặn liên hệ riêng"
        description="Sau khi chặn, hai bên sẽ không thể nhắn tin riêng. Nhóm lớp học vẫn hoạt động theo quy định lớp."
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
              placeholder="Lý do chặn…"
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
