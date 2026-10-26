"use client";

import { Button, Field, inputClass, Modal } from "@/components/ui";
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
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  SquarePen,
  User,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { InlineChatImage, roleLabels } from "./messages.shared";
import { useMessagesModel } from "./use-messages-model";

/** Hiển thị avatar tròn dạng chữ cái viết tắt hoặc hình đại diện */
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
    xs: "size-5 text-[10px]",
    sm: "size-8 text-xs",
    md: "size-11 text-sm",
    lg: "size-14 text-base",
  }[size];

  return (
    <div className="relative shrink-0 select-none">
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-600 grid place-items-center text-white font-bold shadow-xs overflow-hidden`}
      >
        {initials || "U"}
      </div>
    </div>
  );
}

/** Màn hình tin nhắn 1-1 chuyên nghiệp 2 cột tinh gọn, kết nối trực tiếp dữ liệu từ CSDL. */
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
      <div className="grid h-full min-h-0 overflow-hidden rounded-none md:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121319] shadow-sm md:grid-cols-[22rem_1fr]">
        {/* ===================== CỘT 1: DANH SÁCH ĐOẠN CHAT 1-1 ===================== */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } min-h-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#161720]`}
        >
          {/* Header Cột Đoạn chat */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800/80 select-none">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Đoạn chat
            </h1>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full bg-slate-200 dark:bg-[#252735] hover:bg-slate-300 dark:hover:bg-[#343647] text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              title="Tìm kiếm liên hệ mới"
              onClick={() => {
                const input = document.getElementById("direct-chat-search-input");
                input?.focus();
              }}
            >
              <SquarePen size={17} />
            </button>
          </div>

          {/* Ô tìm kiếm người dùng từ CSDL */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800/60">
            <form
              className="relative flex items-center"
              onSubmit={(event) => void searchDirectory(event)}
            >
              <Search
                size={16}
                className="absolute left-3.5 text-slate-400 pointer-events-none"
              />
              <input
                id="direct-chat-search-input"
                aria-label="Tìm kiếm người liên hệ"
                className="w-full h-10 rounded-full bg-white dark:bg-[#222430] border border-slate-200 dark:border-slate-700/80 pl-10 pr-9 text-xs sm:text-sm text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-purple-500 transition-all"
                placeholder="Tìm theo tên hoặc email…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X size={15} />
                </button>
              )}
            </form>
          </div>

          {/* Kết quả tìm kiếm người dùng từ danh bạ CSDL */}
          {directory.length > 0 && (
            <div className="max-h-64 overflow-y-auto border-b border-slate-200 dark:border-slate-800 p-2 bg-slate-100 dark:bg-[#1a1b26]">
              <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Kết quả tìm kiếm ({directory.length})
              </p>
              {directory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => void openDirect(entry.id)}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-200/70 dark:hover:bg-[#282937] transition-colors cursor-pointer"
                >
                  <UserAvatarBadge name={entry.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs sm:text-sm text-slate-800 dark:text-white">
                      {entry.displayName}
                    </strong>
                    <small className="text-slate-500 dark:text-slate-400">
                      {roleLabels[entry.roleCode] || "Người dùng"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Danh sách các cuộc hội thoại 1-1 từ CSDL */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <LoaderCircle className="animate-spin mb-2" size={22} />
                <p className="text-xs">Đang tải đoạn chat từ CSDL…</p>
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
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-purple-50 dark:bg-[#252735] text-purple-900 dark:text-white border-l-4 border-purple-600 shadow-2xs font-semibold"
                        : "hover:bg-slate-200/60 dark:hover:bg-[#1d1f2a] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <UserAvatarBadge name={title} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <strong
                          className={`truncate text-[13.5px] ${
                            isSelected || (item.unreadCount ?? 0) > 0
                              ? "font-bold text-slate-900 dark:text-white"
                              : "font-semibold text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {title}
                        </strong>
                        {(item.unreadCount ?? 0) > 0 && (
                          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-purple-600 text-[10px] font-black text-white">
                            {item.unreadCount}
                          </span>
                        )}
                      </div>
                      <p
                        className={`truncate text-xs mt-0.5 ${
                          (item.unreadCount ?? 0) > 0
                            ? "font-bold text-slate-900 dark:text-slate-100"
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
              <p className="p-6 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
                Chưa có hội thoại nào trong CSDL. Dùng ô tìm kiếm để liên hệ với giảng viên hoặc quản trị viên.
              </p>
            )}
          </div>
        </aside>

        {/* ===================== CỘT 2: KHUNG CHAT 1-1 CHÍNH (FLEX-1) ===================== */}
        <section
          className={`${
            selectedId ? "flex" : "hidden md:flex"
          } min-h-0 min-w-0 flex-col bg-white dark:bg-[#121319]`}
        >
          {selected ? (
            <>
              {/* Header khung chat 1-1 */}
              <header className="h-16 px-4 bg-white dark:bg-[#181922] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between select-none">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    aria-label="Quay lại danh sách"
                    className="grid size-9 place-items-center md:hidden rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                    onClick={() => setSelectedId("")}
                    type="button"
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <UserAvatarBadge
                    name={partnerMember?.displayName || selected.title}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight">
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

                {/* Các công cụ thực tế của project: Tìm kiếm tin nhắn, Mute, Chặn, Báo cáo */}
                <div className="flex items-center gap-1">
                  <form
                    className="hidden sm:flex items-center relative"
                    onSubmit={(event) => void searchConversation(event)}
                  >
                    <input
                      aria-label="Tìm trong hội thoại"
                      className="h-8.5 w-40 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#222430] pl-8 pr-3 text-xs outline-none focus:border-purple-500"
                      minLength={2}
                      onChange={(event) => setMessageQuery(event.target.value)}
                      placeholder="Tìm tin nhắn…"
                      value={messageQuery}
                    />
                    <Search
                      size={14}
                      className="absolute left-2.5 text-slate-400 pointer-events-none"
                    />
                  </form>

                  <button
                    aria-label={
                      selected.mutedUntil
                        ? "Bật thông báo"
                        : "Tắt thông báo 24 giờ"
                    }
                    className="grid size-9 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    onClick={() => void toggleMute()}
                    title={selected.mutedUntil ? "Bật thông báo" : "Tắt thông báo"}
                    type="button"
                  >
                    {selected.mutedUntil ? (
                      <BellOff size={17} className="text-purple-500" />
                    ) : (
                      <Bell size={17} />
                    )}
                  </button>

                  <button
                    aria-label="Chặn liên hệ"
                    className="grid size-9 place-items-center rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 dark:text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                    onClick={() => setBlockOpen(true)}
                    title="Chặn liên hệ riêng"
                    type="button"
                  >
                    <UserX size={17} />
                  </button>
                </div>
              </header>

              {/* Danh sách kết quả tìm kiếm tin nhắn nếu có */}
              {searchResults.length > 0 && (
                <div className="max-h-36 overflow-y-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#1a1b26] px-4 py-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
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
                      className="block w-full border-t border-slate-200 dark:border-slate-800/80 py-1.5 text-left text-xs text-slate-600 dark:text-slate-300 hover:text-purple-600"
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
                className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 bg-slate-50/30 dark:bg-[#121319] scrollbar-thin"
                onScroll={(event) =>
                  window.sessionStorage.setItem(
                    `wind-chat-scroll:${session.user.id}:${selected.id}`,
                    String(event.currentTarget.scrollTop),
                  )
                }
                ref={messagePaneRef}
              >
                {/* Banner đầu trang hội thoại */}
                <div className="flex flex-col items-center justify-center p-6 text-center my-3">
                  <UserAvatarBadge
                    name={partnerMember?.displayName || selected.title}
                    size="lg"
                  />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-3">
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
                        <div className="my-3 text-center">
                          <span className="text-[11px] font-semibold text-slate-400 bg-slate-200/60 dark:bg-[#1e202a] px-3 py-1 rounded-full">
                            {new Date(message.createdAt).toLocaleDateString(locale, {
                              weekday: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
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
                              className={`mb-1 block rounded-xl px-3 py-1 text-[11px] border leading-snug ${
                                mine
                                  ? "bg-purple-950/30 border-purple-800/50 text-purple-200"
                                  : "bg-slate-200/70 dark:bg-[#252735] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <strong className="block text-[10px] text-slate-400">
                                Trả lời {message.replyTo.senderName}:
                              </strong>
                              {message.replyTo.content}
                            </span>
                          ) : null}

                          {/* Bong bóng tin nhắn */}
                          <div
                            className={`relative px-4 py-2.5 text-xs sm:text-[13.5px] leading-relaxed whitespace-pre-wrap break-words shadow-2xs transition-all ${
                              mine
                                ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl rounded-br-xs"
                                : "bg-white dark:bg-[#252733] text-slate-800 dark:text-slate-100 rounded-2xl rounded-bl-xs border border-slate-200 dark:border-slate-700/70"
                            }`}
                          >
                            <span>{message.content}</span>

                            {/* Liên kết ngữ cảnh bài tập / đề thi / học liệu */}
                            {message.context ? (
                              <Link
                                className={`mt-2 block rounded-xl border p-2 text-xs font-semibold ${
                                  mine
                                    ? "border-white/20 bg-white/10 text-white"
                                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-purple-600 dark:text-purple-300"
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
                                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                        mine ? "bg-white/15" : "bg-slate-100 dark:bg-slate-800"
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
                        </div>

                        {/* Nút thao tác nhanh khi hover: Trả lời hoặc Báo cáo */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all">
                          <button
                            type="button"
                            onClick={() => setReplyTo(message)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                            title="Trả lời"
                          >
                            <Reply size={14} />
                          </button>
                          {!mine && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTarget(message);
                                setReportReason("");
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-500 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                              title="Báo cáo tin nhắn"
                            >
                              <ShieldAlert size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Form nhập và gửi tin nhắn */}
              {selected.readOnly ? (
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#161720] text-center text-xs text-slate-500 dark:text-slate-400 font-semibold">
                  Hội thoại này ở trạng thái chỉ đọc.
                </div>
              ) : (
                <form
                  className="p-3 bg-white dark:bg-[#161720] border-t border-slate-200 dark:border-slate-800 select-none"
                  onSubmit={(event) => void sendMessage(event)}
                >
                  {/* Trạng thái trả lời tin nhắn */}
                  {replyTo && (
                    <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-100 dark:bg-[#222430] border border-slate-200 dark:border-slate-700/80 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200">
                      <span className="truncate">
                        <Reply
                          className="mr-1.5 inline text-purple-600 dark:text-purple-400"
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
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-[#252735] border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200"
                        >
                          <Paperclip size={12} className="text-purple-500" />
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
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* Nút ghi âm micro */}
                    <button
                      type="button"
                      onClick={() => void toggleRecording()}
                      className={`grid size-9 sm:size-10 shrink-0 place-items-center rounded-full transition-colors cursor-pointer ${
                        recording
                          ? "bg-rose-600 text-white animate-pulse"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#252735]"
                      }`}
                      title={recording ? "Dừng ghi âm" : "Ghi âm tin nhắn thoại"}
                    >
                      {recording ? <Square size={14} /> : <Mic size={18} />}
                    </button>

                    {/* Nút đính kèm tệp */}
                    <label
                      className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#252735] transition-colors cursor-pointer"
                      title="Đính kèm tệp"
                    >
                      <Paperclip size={18} />
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

                    {/* Ô input Aa viên thuốc bo tròn */}
                    <div className="flex-1 flex items-center rounded-full bg-slate-100 dark:bg-[#222430] border border-slate-200 dark:border-slate-700 px-4 py-1.5 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20 transition-all">
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
                        placeholder="Nhập tin nhắn…"
                        className="w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
                      />
                    </div>

                    {/* Nút gửi tin nhắn */}
                    <button
                      type="submit"
                      disabled={sending || (!draft.trim() && !messageFiles.length)}
                      className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
                      title="Gửi tin nhắn"
                    >
                      {sending ? (
                        <LoaderCircle className="animate-spin" size={17} />
                      ) : (
                        <ArrowUp size={18} strokeWidth={2.5} />
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
                  className="mx-auto mb-3 text-purple-400/50"
                  size={42}
                />
                <h3 className="text-base font-bold text-slate-700 dark:text-slate-200">
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
