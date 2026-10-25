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
  Plus,
  Reply,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  Users,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { InlineChatImage, roleLabels } from "./messages.shared";
import { useMessagesModel } from "./use-messages-model";

/** Lắp ghép màn hình tin nhắn từ trạng thái, hành động và các thành phần nghiệp vụ. */
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
  } = model;

  return (
    <div className="mx-auto h-[calc(100dvh-4.5rem)] max-w-7xl p-0 md:px-6 md:py-3">
      <div className="grid h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm md:grid-cols-[21rem_1fr]">
        <aside
          className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40`}
        >
          <form
            className="flex gap-2 border-b border-slate-200 dark:border-slate-800 p-3"
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
            <div className="max-h-72 overflow-y-auto border-b border-slate-200 dark:border-slate-800 p-2">
              {classChoices.map((item) => (
                <button
                  className="flex w-full items-center gap-3 border-b border-slate-100 dark:border-slate-800/60 px-3 py-3 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
                  key={item.id}
                  onClick={() => void openClass(item.id)}
                  type="button"
                >
                  <Users size={17} className="text-sky-600 dark:text-sky-400" />
                  <span>
                    <strong className="block text-sm">{item.name}</strong>
                    <small className="text-slate-500">
                      {item.code} · trò chuyện lớp
                    </small>
                  </span>
                </button>
              ))}
              {directory.map((entry) => (
                <button
                  className="flex w-full items-center gap-3 border-b border-slate-100 dark:border-slate-800/60 px-3 py-3 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
                  key={entry.id}
                  onClick={() => void openDirect(entry.id)}
                  type="button"
                >
                  <MessageCircle size={17} className="text-sky-600 dark:text-sky-400" />
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
                  className={`w-full border-b border-slate-100 dark:border-slate-800/60 px-4 py-3.5 text-left transition-all ${
                    item.id === selectedId
                      ? "bg-sky-50/80 dark:bg-sky-950/40 border-l-4 border-l-sky-500 shadow-2xs font-semibold"
                      : "hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                  }`}
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
              <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-2">
                <button
                  aria-label="Quay lại danh sách"
                  className="grid size-10 place-items-center md:hidden text-slate-600 dark:text-slate-400"
                  onClick={() => setSelectedId("")}
                  type="button"
                >
                  <ArrowLeft size={19} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                    {selected.title}
                  </h2>
                  <p className="text-xs text-slate-500">
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
                    className="min-h-10 w-48 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs outline-none focus:border-sky-500"
                    minLength={2}
                    onChange={(event) => setMessageQuery(event.target.value)}
                    placeholder="Tìm trong tin nhắn…"
                    value={messageQuery}
                  />
                  <button
                    aria-label="Tìm trong hội thoại"
                    className="grid size-10 place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
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
                  className="grid size-10 place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
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
                    className="grid size-10 place-items-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    onClick={() => setBlockOpen(true)}
                    type="button"
                  >
                    <UserX size={18} />
                  </button>
                ) : null}
              </header>
              {searchResults.length ? (
                <div className="max-h-40 overflow-y-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-4">
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
                      className="block w-full border-t border-slate-100 dark:border-slate-800 py-2 text-left text-xs"
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
                              : {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                }),
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
                          className={`max-w-[82%] px-4 py-3 text-left text-sm ${
                            mine
                              ? "rounded-2xl rounded-tr-xs bg-sky-600 text-white shadow-xs"
                              : "rounded-2xl rounded-tl-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-xs"
                          }`}
                        >
                          {message.replyTo ? (
                            <span
                              className={`mb-2 block rounded-lg px-2.5 py-1 text-xs ${mine ? "bg-white/15 text-white/90" : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"}`}
                            >
                              {message.replyTo.senderName}:{" "}
                              {message.replyTo.content}
                            </span>
                          ) : null}
                          {!mine ? (
                            <strong className="mb-1 block text-xs font-bold text-sky-600 dark:text-sky-400">
                              {message.senderName}
                            </strong>
                          ) : null}
                          <span className="whitespace-pre-wrap break-words leading-relaxed">
                            {message.content}
                          </span>
                          {message.context ? (
                            <Link
                              className={`mt-2 block rounded-xl border px-3 py-2 font-bold ${mine ? "border-white/20 bg-white/10 text-white" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 text-sky-700 dark:text-sky-300"}`}
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
                                        void openAttachment(
                                          message,
                                          file.id,
                                          false,
                                        )
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
                <p className="border-t border-slate-200 dark:border-slate-800 px-4 py-4 text-center text-sm font-semibold text-slate-500">
                  Hội thoại này chỉ còn quyền đọc.
                </p>
              ) : (
                <form
                  className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
                  onSubmit={(event) => void sendMessage(event)}
                >
                  {replyTo ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 px-3 py-2 text-xs">
                      <span className="truncate text-slate-700 dark:text-slate-300">
                        <Reply className="mr-1 inline text-sky-600" size={13} />
                        Trả lời {replyTo.senderName}: {replyTo.content}
                      </span>
                      <button className="text-slate-500 hover:text-slate-800" onClick={() => setReplyTo(null)} type="button">
                        Hủy
                      </button>
                    </div>
                  ) : null}
                  {failedMessage ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                      <span>Tin nhắn chưa gửi.</span>
                      <button
                        className="font-bold underline"
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
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${mentionedUserIds.includes(member.userId) ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300" : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"}`}
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
                  <div className="flex min-h-14 items-end gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1.5 transition-all focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
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
                        <Square
                          aria-hidden="true"
                          fill="currentColor"
                          size={14}
                        />
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
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                          size={18}
                        />
                      ) : (
                        <ArrowUp
                          aria-hidden="true"
                          size={19}
                          strokeWidth={2.25}
                        />
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
