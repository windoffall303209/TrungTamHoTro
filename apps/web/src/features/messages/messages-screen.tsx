"use client";

import { Button, Field, inputClass, Modal } from "@/shared/ui/ui";
import {
  shouldSendChatMessage,
  shouldStartChatTimeGroup,
} from "@/lib/chat-message";
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  BellOff,
  Download,
  Eye,
  LoaderCircle,
  MessageCircle,
  Mic,
  Paperclip,
  Reply,
  Search,
  ShieldAlert,
  Square,
  SquarePen,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { InlineChatImage, roleLabels } from "./messages.shared";
import { useMessagesModel } from "./use-messages-model";

/** Hiển thị avatar tròn tinh gọn chuẩn phong cách Messenger */
function UserAvatarBadge({
  name,
  size = "md",
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const sizeClass = {
    xs: "size-6 text-[10px]",
    sm: "size-8 text-xs",
    md: "size-10 text-xs font-semibold",
    lg: "size-12 text-sm font-bold",
  }[size];

  return (
    <div className="relative shrink-0 select-none">
      <div
        className={`${sizeClass} rounded-full bg-slate-300 dark:bg-[#3a3b3c] text-slate-700 dark:text-slate-200 grid place-items-center font-medium overflow-hidden`}
      >
        {initials || "U"}
      </div>
    </div>
  );
}

/** Màn hình tin nhắn 1-1 chuyên nghiệp chuẩn phong cách Messenger phẳng, hạn chế bo góc và không màu mè. */
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
    sendMessage,
    searchConversation,
    toggleMute,
    reportMessage,
    blockDirectUser,
    openAttachment,
  } = model;

  // Lấy thông tin người đối thoại 1-1 từ members của cuộc trò chuyện
  const partnerMember = selected?.members.find(
    (m) => m.userId !== session.user.id,
  );

  return (
    <div className="mx-auto h-[calc(100dvh-4.5rem)] max-w-7xl p-0 md:p-3">
      <div className="grid h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#18191a] shadow-xs md:grid-cols-[21rem_1fr]">
        {/* ===================== CỘT 1: DANH SÁCH ĐOẠN CHAT 1-1 ===================== */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } min-h-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#18191a]`}
        >
          {/* Header Cột Đoạn chat */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800/60 select-none">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Đoạn chat
            </h1>
            <button
              type="button"
              className="grid size-8.5 place-items-center rounded-lg bg-slate-100 dark:bg-[#242526] hover:bg-slate-200 dark:hover:bg-[#303031] text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              title="Tìm liên hệ mới"
              onClick={() => {
                const input = document.getElementById("direct-chat-search-input");
                input?.focus();
              }}
            >
              <SquarePen size={16} />
            </button>
          </div>

          {/* Ô tìm kiếm người dùng từ CSDL - phẳng, gọn gàng */}
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800/60">
            <form
              className="relative flex items-center"
              onSubmit={(event) => void searchDirectory(event)}
            >
              <Search
                size={15}
                className="absolute left-3 text-slate-400 pointer-events-none"
              />
              <input
                id="direct-chat-search-input"
                aria-label="Tìm kiếm người liên hệ"
                className="w-full h-9 rounded-lg bg-slate-100 dark:bg-[#242526] border border-transparent pl-9 pr-8 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-[#1c1d1e] focus:border-slate-300 dark:focus:border-slate-700 transition-colors"
                placeholder="Tìm kiếm trên Messenger"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </form>
          </div>

          {/* Kết quả tìm kiếm người dùng từ danh bạ CSDL */}
          {directory.length > 0 && (
            <div className="max-h-60 overflow-y-auto border-b border-slate-200 dark:border-slate-800 p-1.5 bg-slate-50 dark:bg-[#202122]">
              <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Kết quả ({directory.length})
              </p>
              {directory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => void openDirect(entry.id)}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-200/60 dark:hover:bg-[#2a2b2c] transition-colors cursor-pointer"
                >
                  <UserAvatarBadge name={entry.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs sm:text-sm text-slate-800 dark:text-white font-medium">
                      {entry.displayName}
                    </strong>
                    <small className="text-slate-500 dark:text-slate-400 text-[11px]">
                      {roleLabels[entry.roleCode] || "Người dùng"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Danh sách các cuộc hội thoại 1-1 phẳng kiểu Messenger */}
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <LoaderCircle className="animate-spin mb-2" size={20} />
                <p className="text-xs">Đang tải đoạn chat…</p>
              </div>
            ) : conversations.length ? (
              conversations.map((item) => {
                const isSelected = item.id === selectedId;
                const partner = item.members.find((m) => m.userId !== session.user.id);
                const title = partner?.displayName || item.title || "Cuộc trò chuyện";
                return (
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                    className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors cursor-pointer border-0 ${
                      isSelected
                        ? "bg-slate-100 dark:bg-[#252733] text-slate-900 dark:text-white"
                        : "hover:bg-slate-50 dark:hover:bg-[#202124] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <UserAvatarBadge name={title} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <strong
                          className={`truncate text-[13.5px] ${
                            isSelected || (item.unreadCount ?? 0) > 0
                              ? "font-semibold text-slate-900 dark:text-white"
                              : "font-medium text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {title}
                        </strong>
                        {(item.unreadCount ?? 0) > 0 && (
                          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#0084ff] text-[10px] font-bold text-white">
                            {item.unreadCount}
                          </span>
                        )}
                      </div>
                      <p
                        className={`truncate text-xs mt-0.5 ${
                          (item.unreadCount ?? 0) > 0
                            ? "font-semibold text-slate-900 dark:text-slate-100"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {item.lastMessage?.content || "Bắt đầu cuộc trò chuyện"}
                      </p>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="p-6 text-center text-xs leading-5 text-slate-400">
                Chưa có hội thoại nào trong CSDL. Dùng ô tìm kiếm để liên hệ giảng viên hoặc quản trị viên.
              </p>
            )}
          </div>
        </aside>

        {/* ===================== CỘT 2: KHUNG CHAT 1-1 CHÍNH (FLEX-1) ===================== */}
        <section
          className={`${
            selectedId ? "flex" : "hidden md:flex"
          } min-h-0 min-w-0 flex-col bg-white dark:bg-[#18191a]`}
        >
          {selected ? (
            <>
              {/* Header khung chat phẳng, sạch sẽ */}
              <header className="h-14 px-4 bg-white dark:bg-[#18191a] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    aria-label="Quay lại danh sách"
                    className="grid size-8 place-items-center md:hidden rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                    onClick={() => setSelectedId("")}
                    type="button"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <UserAvatarBadge
                    name={partnerMember?.displayName || selected.title}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm sm:text-[15px] font-semibold text-slate-900 dark:text-white leading-tight">
                      {partnerMember?.displayName || selected.title}
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {partnerMember?.roleCode
                        ? roleLabels[partnerMember.roleCode as keyof typeof roleLabels] || partnerMember.roleCode
                        : "Trò chuyện trực tiếp 1-1"}
                      {selected.readOnly ? " · Chỉ đọc" : ""}
                    </p>
                  </div>
                </div>

                {/* Các công cụ thực tế: Tìm kiếm tin nhắn, Mute, Chặn */}
                <div className="flex items-center gap-1">
                  <form
                    className="hidden sm:flex items-center relative"
                    onSubmit={(event) => void searchConversation(event)}
                  >
                    <input
                      aria-label="Tìm trong hội thoại"
                      className="h-8 w-36 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-[#242526] pl-7 pr-2.5 text-xs outline-none focus:border-slate-400"
                      minLength={2}
                      onChange={(event) => setMessageQuery(event.target.value)}
                      placeholder="Tìm tin nhắn…"
                      value={messageQuery}
                    />
                    <Search
                      size={13}
                      className="absolute left-2 text-slate-400 pointer-events-none"
                    />
                  </form>

                  <button
                    aria-label={
                      selected.mutedUntil
                        ? "Bật thông báo"
                        : "Tắt thông báo 24 giờ"
                    }
                    className="grid size-8 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-[#242526] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    onClick={() => void toggleMute()}
                    title={selected.mutedUntil ? "Bật thông báo" : "Tắt thông báo"}
                    type="button"
                  >
                    {selected.mutedUntil ? (
                      <BellOff size={16} className="text-blue-500" />
                    ) : (
                      <Bell size={16} />
                    )}
                  </button>

                  <button
                    aria-label="Chặn liên hệ"
                    className="grid size-8 place-items-center rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 dark:text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                    onClick={() => setBlockOpen(true)}
                    title="Chặn liên hệ riêng"
                    type="button"
                  >
                    <UserX size={16} />
                  </button>
                </div>
              </header>

              {/* Danh sách kết quả tìm kiếm tin nhắn nếu có */}
              {searchResults.length > 0 && (
                <div className="max-h-36 overflow-y-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#202122] px-4 py-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>
                      {searchResults.length} kết quả cho “{messageQuery}”
                    </span>
                    <button
                      onClick={() => {
                        setSearchResults([]);
                        setMessageQuery("");
                      }}
                      type="button"
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {searchResults.map((item) => (
                    <button
                      className="block w-full border-t border-slate-200 dark:border-slate-700/60 py-1.5 text-left text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600"
                      key={item.id}
                      onClick={() => setSearchResults([])}
                      type="button"
                    >
                      <strong>{item.senderName}</strong>: {item.content.slice(0, 100)}
                    </button>
                  ))}
                </div>
              )}

              {/* Vùng hiển thị toàn bộ tin nhắn cuộn */}
              <div
                className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-white dark:bg-[#18191a] scrollbar-thin"
                onScroll={(event) =>
                  window.sessionStorage.setItem(
                    `wind-chat-scroll:${session.user.id}:${selected.id}`,
                    String(event.currentTarget.scrollTop),
                  )
                }
                ref={messagePaneRef}
              >
                {/* Banner đầu trang hội thoại */}
                <div className="flex flex-col items-center justify-center p-4 text-center my-2">
                  <UserAvatarBadge
                    name={partnerMember?.displayName || selected.title}
                    size="lg"
                  />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-2">
                    {partnerMember?.displayName || selected.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {partnerMember?.roleCode
                      ? roleLabels[partnerMember.roleCode as keyof typeof roleLabels] || partnerMember.roleCode
                      : "Thành viên hệ thống"}
                  </p>
                </div>

                {/* Danh sách các tin nhắn */}
                {messages.map((message, index) => {
                  const mine = message.senderId === session.user.id;
                  const startsTimeGroup = shouldStartChatTimeGroup(
                    message.createdAt,
                    messages[index - 1]?.createdAt,
                  );

                  return (
                    <div key={message.id}>
                      {startsTimeGroup ? (
                        <div className="my-2 text-center">
                          <span className="text-[11px] text-slate-400">
                            {new Date(message.createdAt).toLocaleDateString(locale, {
                              weekday: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      ) : null}

                      <div
                        className={`group flex items-end gap-1.5 ${
                          mine ? "justify-end" : "justify-start"
                        }`}
                      >
                        {!mine && (
                          <div className="mb-0.5 shrink-0">
                            <UserAvatarBadge
                              name={message.senderName || selected.title}
                              size="xs"
                            />
                          </div>
                        )}

                        <div
                          className={`flex flex-col ${
                            mine ? "items-end" : "items-start"
                          } max-w-[80%] sm:max-w-[70%]`}
                        >
                          {/* Trích dẫn tin nhắn đang reply nếu có */}
                          {message.replyTo ? (
                            <span
                              className={`mb-1 block rounded-md px-2.5 py-1 text-[11px] border leading-snug ${
                                mine
                                  ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200"
                                  : "bg-slate-100 dark:bg-[#242526] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <strong className="block text-[10px] text-slate-500">
                                Trả lời {message.replyTo.senderName}:
                              </strong>
                              {message.replyTo.content}
                            </span>
                          ) : null}

                          {/* Bong bóng tin nhắn chuẩn phong cách Messenger phẳng */}
                          <div
                            className={`relative px-3.5 py-2 text-xs sm:text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${
                              mine
                                ? "bg-[#0084ff] text-white rounded-2xl rounded-br-xs"
                                : "bg-[#e4e6eb] dark:bg-[#303030] text-slate-900 dark:text-slate-100 rounded-2xl rounded-bl-xs"
                            }`}
                          >
                            <span>{message.content}</span>

                            {/* Liên kết ngữ cảnh bài tập / đề thi / học liệu */}
                            {message.context ? (
                              <Link
                                className={`mt-2 block rounded-md border p-2 text-xs font-medium ${
                                  mine
                                    ? "border-white/30 bg-white/10 text-white"
                                    : "border-slate-300 dark:border-slate-600 bg-white dark:bg-[#242526] text-blue-600 dark:text-blue-400"
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

                            {/* Tệp đính kèm */}
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
                                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                                        mine ? "bg-white/20" : "bg-slate-200 dark:bg-slate-700"
                                      }`}
                                      key={file.id}
                                    >
                                      <Paperclip size={13} />
                                      <span className="truncate flex-1 font-medium">
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
                        </div>

                        {/* Nút thao tác nhanh khi hover: Trả lời hoặc Báo cáo */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                          <button
                            type="button"
                            onClick={() => setReplyTo(message)}
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Trả lời"
                          >
                            <Reply size={13} />
                          </button>
                          {!mine && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTarget(message);
                                setReportReason("");
                              }}
                              className="p-1 text-slate-400 hover:text-rose-500 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                              title="Báo cáo tin nhắn"
                            >
                              <ShieldAlert size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Form nhập và gửi tin nhắn phẳng chuẩn Messenger */}
              {selected.readOnly ? (
                <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#18191a] text-center text-xs text-slate-500 dark:text-slate-400">
                  Hội thoại này ở trạng thái chỉ đọc.
                </div>
              ) : (
                <form
                  className="p-2.5 bg-white dark:bg-[#18191a] border-t border-slate-200 dark:border-slate-800 select-none"
                  onSubmit={(event) => void sendMessage(event)}
                >
                  {/* Trạng thái trả lời tin nhắn */}
                  {replyTo && (
                    <div className="mb-2 flex items-center justify-between rounded-md bg-slate-100 dark:bg-[#242526] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200">
                      <span className="truncate">
                        <Reply
                          className="mr-1.5 inline text-blue-600"
                          size={13}
                        />
                        Trả lời <strong>{replyTo.senderName}</strong>: {replyTo.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-white ml-2"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Danh sách tệp đính kèm */}
                  {messageFiles.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {messageFiles.map((file, index) => (
                        <span
                          key={`${file.name}-${index}`}
                          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-[#242526] border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                        >
                          <Paperclip size={12} className="text-blue-500" />
                          <span className="truncate max-w-[120px]">{file.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setMessageFiles((prev) =>
                                prev.filter((_, i) => i !== index),
                              )
                            }
                            className="text-slate-400 hover:text-rose-500"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Thanh công cụ nhập tin nhắn */}
                  <div className="flex items-center gap-1.5">
                    {/* Nút ghi âm micro */}
                    <button
                      type="button"
                      onClick={() => void toggleRecording()}
                      className={`grid size-8.5 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer ${
                        recording
                          ? "bg-rose-600 text-white animate-pulse"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#242526]"
                      }`}
                      title={recording ? "Dừng ghi âm" : "Ghi âm tin nhắn thoại"}
                    >
                      {recording ? <Square size={13} /> : <Mic size={17} />}
                    </button>

                    {/* Nút đính kèm tệp */}
                    <label
                      className="grid size-8.5 shrink-0 place-items-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#242526] transition-colors cursor-pointer"
                      title="Đính kèm tệp"
                    >
                      <Paperclip size={17} />
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          queueMessageFiles(files);
                          e.target.value = "";
                        }}
                      />
                    </label>

                    {/* Ô input Aa viên thuốc phẳng chuẩn Messenger */}
                    <div className="flex-1 flex items-center rounded-full bg-slate-100 dark:bg-[#242526] px-3.5 py-1.5 transition-colors">
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
                        className="w-full bg-transparent text-xs sm:text-[13.5px] text-slate-900 dark:text-white placeholder:text-slate-500 outline-none"
                      />
                    </div>

                    {/* Nút gửi tin nhắn */}
                    <button
                      type="submit"
                      disabled={sending || (!draft.trim() && !messageFiles.length)}
                      className="grid size-8.5 shrink-0 place-items-center rounded-full bg-[#0084ff] text-white hover:bg-[#0073e6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      title="Gửi tin nhắn"
                    >
                      {sending ? (
                        <LoaderCircle className="animate-spin" size={15} />
                      ) : (
                        <ArrowUp size={16} strokeWidth={2.5} />
                      )}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-slate-400">
              <div>
                <MessageCircle
                  className="mx-auto mb-3 text-slate-400/60"
                  size={36}
                />
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Chọn một cuộc trò chuyện
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Chọn người liên hệ ở danh sách bên trái hoặc tìm kiếm để bắt đầu nhắn tin 1-1.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal báo cáo tin nhắn */}
      <Modal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Báo cáo tin nhắn"
        description="Báo cáo được gửi trực tiếp cho bộ phận quản trị và kiểm duyệt."
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
        description="Sau khi chặn, hai bên sẽ không thể nhắn tin riêng 1-1 với nhau."
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
