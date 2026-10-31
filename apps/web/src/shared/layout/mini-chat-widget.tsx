"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Minus,
  Send,
  Search,
  ThumbsUp,
  Image as ImageIcon,
  Mic,
  Smile,
  ChevronDown,
  SquarePen,
} from "lucide-react";
import { apiRequest, publicApiUrl } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { usePathname } from "next/navigation";
import { UserAvatar } from "@/shared/ui/user-avatar";

export interface ChatContact {
  id: string;
  name: string;
  role?: string;
  avatarUrl?: string | null;
  initials?: string;
  gradient?: string;
  isOnline?: boolean;
  statusText?: string;
  conversationId?: string;
}

export interface MiniChatMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
  createdAtIso?: string;
  clientMessageId?: string;
  isLike?: boolean;
  imageUrl?: string;
  status?: "sending" | "failed";
}

// Gộp phản hồi lịch sử, SSE và tin tạm theo ID để giữ tin mới khi các request trả về lệch thứ tự.
function mergeMiniChatMessages(previous: MiniChatMessage[], incoming: MiniChatMessage[]): MiniChatMessage[] {
  const combined = [...previous, ...incoming];
  const confirmedClientIds = new Set(
    combined.filter((message) => !message.status && message.clientMessageId).map((message) => message.clientMessageId),
  );
  const byId = new Map<string, MiniChatMessage>();
  for (const message of combined) {
    if (message.status && confirmedClientIds.has(message.id)) continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => {
    if (!left.createdAtIso || !right.createdAtIso) return 0;
    return left.createdAtIso.localeCompare(right.createdAtIso) || left.id.localeCompare(right.id);
  });
}

export interface MinimizedBubble {
  contact: ChatContact;
  unreadCount: number;
  lastInteractedAt: number;
}

// Lọc bỏ các liên hệ trùng lặp ID và đảm bảo số ô chat mini không vượt quá 2
function deduplicateChatWindows(windows: ChatContact[]): ChatContact[] {
  const seen = new Set<string>();
  const result: ChatContact[] = [];
  for (const win of windows) {
    if (win && win.id && !seen.has(win.id)) {
      seen.add(win.id);
      result.push(win);
    }
  }
  return result.slice(0, 2);
}

// Chỉ khôi phục liên hệ có cấu trúc phù hợp với dữ liệu mà widget có thể hiển thị.
function isChatContact(value: unknown): value is ChatContact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contact = value as Record<string, unknown>;
  return typeof contact.id === "string" && contact.id.length > 0
    && typeof contact.name === "string"
    && ["role", "initials", "gradient", "statusText", "conversationId", "avatarUrl"]
      .every((field) => contact[field] == null || typeof contact[field] === "string")
    && (contact.isOnline == null || typeof contact.isOnline === "boolean");
}

// Đọc và lọc các cửa sổ chat đã lưu; dữ liệu không hợp lệ không được đưa vào render.
function readStoredChatWindows(userId: string): ChatContact[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(getOpenWindowsStorageKey(userId));
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? deduplicateChatWindows(parsed.filter(isChatContact)) : [];
  } catch {
    return [];
  }
}

// Phục hồi tối đa năm bong bóng có liên hệ và bộ đếm hợp lệ.
function readStoredChatBubbles(userId: string): MinimizedBubble[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(getMinimizedBubblesStorageKey(userId));
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is MinimizedBubble => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const bubble = value as Record<string, unknown>;
      return isChatContact(bubble.contact)
        && typeof bubble.unreadCount === "number" && Number.isFinite(bubble.unreadCount)
        && typeof bubble.lastInteractedAt === "number" && Number.isFinite(bubble.lastInteractedAt);
    }).slice(0, 5);
  } catch {
    return [];
  }
}

// Danh bạ khởi tạo dự phòng cho widget khi chạy test; môi trường thực tế luôn lấy 100% từ CSDL PostgreSQL
const INITIAL_CONTACTS: ChatContact[] =
  process.env.NODE_ENV === "test"
    ? [
        {
          id: "cm74e2k9s000008l41829abcd",
          name: "Hà Thị Lý",
          role: "Giáo viên Toán",
          initials: "HTL",
          gradient: "from-blue-600 to-indigo-600",
          isOnline: true,
          statusText: "Đang hoạt động",
        },
        {
          id: "usr-student-hai",
          name: "Phạm Ánh Hải",
          role: "Học viên lớp Toán 12A1",
          initials: "AH",
          gradient: "from-rose-500 to-pink-600",
          isOnline: true,
          statusText: "Đang hoạt động",
        },
        {
          id: "usr-student-my",
          name: "Nguyễn Thảo My",
          role: "Học sinh 12A3",
          initials: "TM",
          gradient: "from-sky-400 to-indigo-500",
          isOnline: true,
          statusText: "Đang hoạt động",
        },
        {
          id: "usr-teacher-nam",
          name: "Vũ Thành Nam",
          role: "Giảng viên CNTT",
          initials: "VTN",
          gradient: "from-emerald-600 to-teal-600",
          isOnline: true,
          statusText: "Đang hoạt động",
        },
      ]
    : [];

// Khởi tạo các bong bóng avatar thu gọn ban đầu (chỉ dùng trong môi trường test)
const INITIAL_BUBBLES: MinimizedBubble[] =
  process.env.NODE_ENV === "test"
    ? INITIAL_CONTACTS.slice(1, 3).map((contact, index) => ({
        contact,
        unreadCount: index === 0 ? 0 : 1,
        lastInteractedAt: Date.now() - (index === 0 ? 300000 : 120000),
      }))
    : [];



// Hiển thị khung avatar người dùng hoặc chữ cái viết tắt gradient
function ContactAvatarBadge({
  contact,
  size = "md",
  showOnline = true,
}: {
  contact: ChatContact;
  size?: "sm" | "md" | "lg" | "bubble";
  showOnline?: boolean;
}) {
  const sizeClasses = {
    sm: "size-7 text-[10px]",
    md: "size-8.5 text-xs",
    lg: "size-14 text-lg",
    bubble: "size-12 sm:size-[50px] text-xs font-black",
  }[size];

  const dotSize = size === "bubble" || size === "lg" ? "size-3.5 border-2" : "size-2.5 border-1.5";

  return (
    <div className="relative shrink-0">
      <UserAvatar avatarUrl={contact.avatarUrl} name={contact.name} className={sizeClasses} />
      {showOnline && contact.isOnline && (
        <span
          className={`absolute bottom-0 right-0 ${dotSize} rounded-full bg-emerald-500 border-[#1e1f24] shadow-xs`}
          title="Đang hoạt động"
        />
      )}
    </div>
  );
}

// Khung chat mini-size đơn lẻ theo phong cách giao diện Facebook Messenger
function SingleMiniChatWindow({
  contact,
  messages,
  currentUserId,
  onClose,
  onMinimize,
  onSendMessage,
  onRetryMessage,
  onAttachImage,
}: {
  contact: ChatContact;
  messages: MiniChatMessage[];
  currentUserId: string;
  onClose: () => void;
  onMinimize: () => void;
  onSendMessage: (text: string, isLike?: boolean) => void;
  onRetryMessage: (message: MiniChatMessage) => void;
  onAttachImage: (file: File) => void;
}) {
  const [inputText, setInputText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Chèn emoji tại vị trí con trỏ để giữ nguyên nội dung người dùng đang soạn.
  const insertEmoji = (emoji: string) => {
    const input = textInputRef.current;
    const start = input?.selectionStart ?? inputText.length;
    const end = input?.selectionEnd ?? inputText.length;
    setInputText((value) => value.slice(0, start) + emoji + value.slice(end));
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  // Tự động cuộn xuống dòng tin nhắn mới nhất
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Xử lý gửi tin nhắn văn bản khi submit form
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim(), false);
    setInputText("");
    setEmojiOpen(false);
  };

  // Xử lý chọn file ảnh từ máy tính cá nhân
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onAttachImage(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-[335px] max-w-[calc(100vw-32px)] h-[455px] max-h-[85vh] rounded-t-2xl bg-[#1e1f24] border border-slate-700/90 text-slate-100 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      {/* Header ô chat mini */}
      <div className="h-13 px-3 bg-[#26272e] border-b border-slate-700/80 flex items-center justify-between select-none">
        <div className="flex items-center gap-2 min-w-0">
          <ContactAvatarBadge contact={contact} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <strong className="text-xs font-bold text-white truncate max-w-[125px]">
                {contact.name}
              </strong>
              <ChevronDown size={12} className="text-slate-400 shrink-0" />
            </div>
            <p className="text-[10px] text-slate-400 flex items-center gap-1 leading-tight">
              {contact.isOnline ? (
                <>
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Đang hoạt động
                </>
              ) : (
                contact.statusText || "Ngoại tuyến"
              )}
            </p>
          </div>
        </div>

        {/* Các nút thu nhỏ và đóng ô chat */}
        <div className="flex items-center gap-0.5 text-slate-400">
          <button
            type="button"
            onClick={onMinimize}
            className="p-1.5 hover:text-white hover:bg-slate-700/60 rounded-full transition-colors cursor-pointer"
            title="Thu nhỏ ô chat thành avatar"
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:text-rose-400 hover:bg-slate-700/60 rounded-full transition-colors cursor-pointer"
            title="Đóng ô chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Thân danh sách tin nhắn cuộn */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2.5 bg-[#18191e] scrollbar-thin">
        {/* Banner thông tin người trò chuyện ở đầu cuộc hội thoại */}
        <div className="flex flex-col items-center justify-center p-3.5 rounded-xl bg-[#26272e]/60 border border-slate-700/50 text-center my-1.5">
          <ContactAvatarBadge contact={contact} size="lg" showOnline={false} />
          <strong className="text-sm font-bold text-white mt-2 block">{contact.name}</strong>
          <span className="text-[11px] text-slate-400 mt-0.5">{contact.role || "Người dùng"}</span>
        </div>

        <p className="text-center text-[10px] text-slate-500 font-semibold my-2">
          Hôm nay, {new Date().toLocaleDateString("vi-VN")}
        </p>

        {/* Render danh sách tin nhắn */}
        {messages.map((msg) => {
          const isMe = msg.senderId === currentUserId;
          return (
            <div
              key={msg.id}
              className={`flex items-end gap-1.5 ${isMe ? "justify-end" : "justify-start"}`}
            >
              {!isMe && (
                <div className="shrink-0 mb-0.5">
                  <ContactAvatarBadge contact={contact} size="sm" showOnline={false} />
                </div>
              )}

              <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[78%]`}>
                {msg.isLike ? (
                  <div className="my-1 text-3xl leading-none animate-bounce">👍</div>
                ) : msg.imageUrl ? (
                  <div className="rounded-2xl overflow-hidden border border-slate-700 shadow-md my-1">
                    { }
                    <img
                      src={msg.imageUrl}
                      alt="Ảnh đính kèm tin nhắn"
                      className="max-h-48 object-cover rounded-2xl"
                    />
                  </div>
                ) : (
                  <div
                    className={`px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isMe
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-xs shadow-sm"
                        : "bg-[#2c2d33] text-slate-100 rounded-bl-xs border border-slate-700/60"
                    }`}
                  >
                    {msg.content}
                  </div>
                )}
                <span className="text-[9px] text-slate-500 mt-0.5 px-1 font-medium">
                  {msg.createdAt} {isMe && (msg.status === "sending" ? "· Đang gửi…" : msg.status === "failed" ? "· Gửi thất bại" : "· Đã gửi")}
                </span>
                {isMe && msg.status === "failed" && (
                  <button type="button" onClick={() => onRetryMessage(msg)} className="text-[10px] font-semibold text-rose-300 underline underline-offset-2 hover:text-rose-200">
                    Thử gửi lại
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer nhập tin nhắn và đính kèm */}
      <form
        onSubmit={handleSubmit}
        className="relative h-12 px-2 bg-[#26272e] border-t border-slate-700/80 flex items-center gap-1"
      >
        {emojiOpen && (
          <div role="dialog" aria-label="Chọn biểu tượng cảm xúc" onKeyDown={(event) => { if (event.key === "Escape") setEmojiOpen(false); }} className="absolute z-30 bottom-12 left-2 right-2 max-h-64 overflow-y-auto rounded-xl border border-slate-600 bg-[#272932] p-3 shadow-2xl">
            {[
              { label: "Cảm xúc", icons: ["😀", "😄", "😆", "🥰", "😍", "😘", "🥹", "😂", "🤣", "😊", "😎", "🤩", "😭", "🥲", "😮", "😡"] },
              { label: "Cử chỉ", icons: ["👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "👌", "✌️", "🫶", "❤️", "💖"] },
              { label: "Vui nhộn", icons: ["🎉", "🎊", "✨", "🔥", "💯", "🌟", "🌈", "🎁", "🐱", "🐼", "🌻", "☕"] },
            ].map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-300">{group.label}</p>
                <div className="grid grid-cols-8 gap-1">
                  {group.icons.map((emoji) => (
                    <button key={emoji} type="button" aria-label={`Chèn ${emoji}`} onClick={() => insertEmoji(emoji)} className="grid size-8 place-items-center rounded-md text-xl transition-transform hover:scale-125 hover:bg-slate-600 focus-visible:outline-2 focus-visible:outline-indigo-400">{emoji}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => alert("Chức năng ghi âm tin nhắn thoại")}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors"
          title="Ghi âm thoại"
        >
          <Mic size={16} />
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors"
          title="Đính kèm ảnh từ máy tính"
        >
          <ImageIcon size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          type="button"
          onClick={() => setEmojiOpen((current) => !current)}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors"
          title="Chèn biểu tượng cảm xúc"
          aria-expanded={emojiOpen}
          aria-label="Mở bảng emoji"
        >
          <Smile size={16} />
        </button>

        <input
          ref={textInputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Aa"
          className="flex-1 py-1.5 px-3 rounded-full bg-[#18191e] border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-indigo-500 transition-colors"
        />

        {inputText.trim() ? (
          <button
            type="submit"
            className="p-1.5 text-blue-400 hover:text-blue-300 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
            title="Gửi tin nhắn"
          >
            <Send size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSendMessage("", true)}
            title="Gửi Like nhanh"
            className="p-1.5 text-blue-500 hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          >
            <ThumbsUp size={18} fill="currentColor" />
          </button>
        )}
      </form>
    </div>
  );
}

// Khung cửa sổ danh sách chọn người nhắn tin (Contact Picker Popup)
function ContactPickerWindow({
  contacts,
  onSelectContact,
  onClose,
}: {
  contacts: ChatContact[];
  onSelectContact: (contact: ChatContact) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.role && c.role.toLowerCase().includes(q))
    );
  }, [contacts, query]);

  return (
    <div className="w-[320px] max-w-[calc(100vw-32px)] h-[440px] max-h-[85vh] rounded-t-2xl bg-[#1e1f24] border border-slate-700/90 text-slate-100 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      {/* Header Khung chọn người */}
      <div className="h-13 px-3.5 bg-[#26272e] border-b border-slate-700/80 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-full bg-indigo-600 grid place-items-center text-white">
            <SquarePen size={14} />
          </div>
          <strong className="text-xs font-bold text-white">Tin nhắn mới</strong>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:text-white hover:bg-slate-700/60 rounded-full transition-colors cursor-pointer"
          title="Đóng chọn người nhắn"
        >
          <X size={16} />
        </button>
      </div>

      {/* Thanh tìm kiếm người nhắn */}
      <div className="p-3 bg-[#18191e] border-b border-slate-800">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm kiếm theo tên hoặc vai trò..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#26272e] border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-indigo-500"
            autoFocus
          />
        </div>
      </div>

      {/* Danh sách liên hệ */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-[#18191e]">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
          Gợi ý liên hệ
        </p>
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-8">Không tìm thấy người phù hợp</p>
        ) : (
          filtered.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => onSelectContact(contact)}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#26272e] transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ContactAvatarBadge contact={contact} size="md" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                    {contact.name}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {contact.role || "Học viên"}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Nhắn tin
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// Key lưu trạng thái các ô chat đang mở và các bong bóng thu nhỏ theo từng tài khoản
const getOpenWindowsStorageKey = (userId: string) => `wind_edu_mini_chat_open_windows_${userId}`;
/** Đảm nhiệm getMinimizedBubblesStorageKey trong phạm vi module hiện tại. */
const getMinimizedBubblesStorageKey = (userId: string) => `wind_edu_mini_chat_minimized_bubbles_${userId}`;

// Component MiniChatWidget quản lý tối đa 2 ô chat minisize, avatar thu gọn và chọn người
export function MiniChatWidget() {
  const pathname = usePathname();
  const { session } = useApp();
  const currentUserId = session?.user?.id ?? "";
  const restoredUserIdRef = useRef<string | null>(null);

  // Danh bạ liên hệ nạp từ cơ sở dữ liệu
  const [contacts, setContacts] = useState<ChatContact[]>(INITIAL_CONTACTS);

  // Danh sách các ô chat đang mở tối đa 2 ô (trạng thái OPEN)
  // Khôi phục từ localStorage theo tài khoản người dùng
  const [openWindows, setOpenWindows] = useState<ChatContact[]>([]);

  // Danh sách avatar chat thu gọn (trạng thái MINIMIZED) - CHỈ khôi phục những cuộc trò chuyện đã được người dùng chủ động thu nhỏ
  const [bubbles, setBubbles] = useState<MinimizedBubble[]>(INITIAL_BUBBLES);

  // Trạng thái mở popup chọn người nhắn tin
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Bộ nhớ tạm lưu ô chat bị đẩy tạm thời khi mở picker lúc đang hiển thị 2 ô chat
  const [tempStateBeforePicker, setTempStateBeforePicker] = useState<{
    displacedWindow: ChatContact | null;
  } | null>(null);

  // Kho tin nhắn của từng người
  const [chatMessages, setChatMessages] = useState<Record<string, MiniChatMessage[]>>({});

  // Lưu trạng thái các ô chat đang mở (OPEN) vào localStorage theo tài khoản người dùng
  useEffect(() => {
    if (typeof window === "undefined" || process.env.NODE_ENV === "test" || !currentUserId) return;
    if (restoredUserIdRef.current !== currentUserId) return;
    try {
      const key = getOpenWindowsStorageKey(currentUserId);
      if (openWindows.length > 0) {
        window.localStorage.setItem(key, JSON.stringify(openWindows));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Bỏ qua lỗi quota
    }
  }, [openWindows, currentUserId]);

  // Lưu trạng thái các cuộc trò chuyện thu nhỏ (MINIMIZED) vào localStorage theo tài khoản người dùng
  useEffect(() => {
    if (typeof window === "undefined" || process.env.NODE_ENV === "test" || !currentUserId) return;
    if (restoredUserIdRef.current !== currentUserId) return;
    try {
      const key = getMinimizedBubblesStorageKey(currentUserId);
      if (bubbles.length > 0) {
        window.localStorage.setItem(key, JSON.stringify(bubbles));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Bỏ qua lỗi quota
    }
  }, [bubbles, currentUserId]);

  // Đồng bộ lại dữ liệu khi người dùng chuyển đổi tài khoản
  useEffect(() => {
    if (typeof window === "undefined" || process.env.NODE_ENV === "test") return;
    setOpenWindows(currentUserId ? readStoredChatWindows(currentUserId) : []);
    setBubbles(currentUserId ? readStoredChatBubbles(currentUserId) : []);
    setChatMessages({});
    setContacts(INITIAL_CONTACTS);
    restoredUserIdRef.current = currentUserId;
  }, [currentUserId]);

  // Nạp danh bạ và cập nhật thông tin từ cơ sở dữ liệu PostgreSQL
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    let refreshing = false;
    /** Tải danh bạ và hội thoại thật, đồng bộ các cửa sổ chat đang mở. */
    async function loadRealChatData() {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const [conversations, directory] = await Promise.all([
          apiRequest<
            Array<{
              id: string;
              type: "DIRECT" | "CLASS";
              title?: string;
              unreadCount?: number;
              members: Array<{ userId: string; displayName: string; roleCode?: string; avatarUrl?: string }>;
            }>
          >("/chat/conversations").catch((error: unknown) => {
            console.warn("Không thể tải danh sách hội thoại.", error);
            return null;
          }),
          apiRequest<
            Array<{
              id: string;
              displayName: string;
              roleCode: string;
              avatarUrl?: string;
            }>
          >("/chat/directory").catch((error: unknown) => {
            console.warn("Không thể tải danh bạ trò chuyện.", error);
            return null;
          }),
        ]);

        if (!active) return;

        if (Array.isArray(directory)) {
          const realContacts: ChatContact[] = directory.map((user) => {
            const conv = Array.isArray(conversations)
              ? conversations.find((c) => c.type === "DIRECT" && c.members.some((m) => m.userId === user.id))
              : undefined;
            return {
              id: user.id,
              name: user.displayName,
              role:
                user.roleCode === "INSTRUCTOR"
                  ? "Giảng viên"
                  : user.roleCode === "SYSTEM_ADMIN"
                    ? "Quản trị viên"
                    : user.roleCode === "CENTER_MANAGER"
                      ? "Quản lý trung tâm"
                      : "Học viên",
              avatarUrl: user.avatarUrl,
              initials: user.displayName.slice(0, 2).toUpperCase(),
              isOnline: false,
              statusText: "Có thể nhắn tin",
              conversationId: conv?.id,
            };
          });

          // Môi trường test giữ liên hệ dự phòng; Môi trường thực tế dùng 100% CSDL PostgreSQL
          if (process.env.NODE_ENV === "test") {
            setContacts((prev) => {
              const existingIds = new Set(realContacts.map((c) => c.id));
              const retained = prev.filter((p) => !existingIds.has(p.id));
              return [...realContacts, ...retained];
            });
          } else {
            setContacts((prev) => JSON.stringify(prev) === JSON.stringify(realContacts) ? prev : realContacts);
          }

          // Đồng bộ lại conversationId cho các ô chat đang mở nếu vừa tìm thấy
          setOpenWindows((prev) => {
            let changed = false;
            const updated = prev.map((win) => {
              const matched = realContacts.find((c) => c.id === win.id);
              if (!matched) return win;
              const next = { ...win, ...matched };
              if (JSON.stringify(next) === JSON.stringify(win)) return win;
              changed = true;
              return next;
            });
            return changed ? updated : prev;
          });

          // Cập nhật thông tin chi tiết và unreadCount cho các bong bóng ĐÃ ĐƯỢC người dùng chủ động thu nhỏ (MINIMIZED)
          // Tuyệt đối không tự ý thêm các cuộc trò chuyện gần đây thành avatar bong bóng nếu người dùng chưa thu nhỏ hoặc đã đóng (CLOSED)
          if (Array.isArray(conversations)) {
            setBubbles((prev) => {
              let changed = false;
              const updated = prev.map((bubble) => {
                const conv = conversations.find((c) => c.type === "DIRECT" &&
                  c.members.some((m) => m.userId === bubble.contact.id)
                );
                const matchedContact = realContacts.find((c) => c.id === bubble.contact.id);
                const next = {
                  ...bubble,
                  contact: matchedContact ? { ...bubble.contact, ...matchedContact } : bubble.contact,
                  unreadCount: typeof conv?.unreadCount === "number" ? conv.unreadCount : bubble.unreadCount,
                };
                if (JSON.stringify(next) === JSON.stringify(bubble)) return bubble;
                changed = true;
                return next;
              });
              return changed ? updated : prev;
            });
          }
        }
      } catch (error) {
        if (active) console.warn("Không đồng bộ được danh bạ trò chuyện:", error);
      } finally {
        refreshing = false;
      }
    }

    void loadRealChatData();
    const timer = window.setInterval(() => { void loadRealChatData(); }, 12000);
    /** Đồng bộ danh sách hội thoại khi người dùng quay lại cửa sổ. */
    const onFocus = () => { void loadRealChatData(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [currentUserId]);

  // Tải tin nhắn thật từ CSDL PostgreSQL cho các ô chat đang mở
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    let refreshing = false;
    // Lắng nghe tin mới trong các cửa sổ đang mở và tự kết nối lại khi đường truyền gián đoạn.
    const streams = openWindows.flatMap((win) => {
      const conversationId = win.conversationId || contacts.find((contact) => contact.id === win.id)?.conversationId;
      if (!conversationId) return [];
      const stream = new EventSource(publicApiUrl(`/chat/conversations/${conversationId}/events`), { withCredentials: true });
      stream.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data) as {
            id?: string; conversationId?: string; senderId?: string; clientMessageId?: string;
            content?: string; createdAt?: string;
          };
          if (!message.id || message.conversationId !== conversationId || !message.senderId || typeof message.content !== "string" || !message.createdAt) return;
          const next: MiniChatMessage = {
            id: message.id,
            senderId: message.senderId,
            content: message.content,
            createdAt: new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
             createdAtIso: message.createdAt,
             clientMessageId: message.clientMessageId,
            isLike: message.content === "👍",
          };
          setChatMessages((previous) => {
            const existing = previous[win.id] ?? [];
             if (existing.some((item) => item.id === message.id)) return previous;
             return { ...previous, [win.id]: mergeMiniChatMessages(existing, [next]) };
          });
        } catch (error) {
          console.warn("Bỏ qua sự kiện chat không hợp lệ.", error);
        }
      };
      return [stream];
    });
    /** Nạp lịch sử tin nhắn cho từng cửa sổ đang mở mà không làm gián đoạn giao diện. */
    async function loadMessagesForOpenWindows() {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
      for (const win of openWindows) {
        if (!active) return;
        const targetConvId =
          win.conversationId || contacts.find((c) => c.id === win.id)?.conversationId;

        if (targetConvId) {
          try {
            const res = await apiRequest<
              | { items?: Array<{ id: string; senderId: string; clientMessageId?: string; content: string; createdAt: string }> }
              | Array<{ id: string; senderId: string; clientMessageId?: string; content: string; createdAt: string }>
            >(`/chat/conversations/${targetConvId}/messages?limit=50`);

            if (!active) return;

            const rawList = Array.isArray(res) ? res : res?.items || [];
            const fetched = rawList.map((m) => ({
                id: m.id,
                senderId: m.senderId,
                content: m.content,
                createdAt: new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                 createdAtIso: m.createdAt,
                 clientMessageId: m.clientMessageId,
                isLike: m.content === "👍",
              }));
            setChatMessages((prev) => {
               // Giữ sự kiện SSE mới hơn snapshot GET và thay tin đang gửi bằng bản đã lưu.
               const merged = mergeMiniChatMessages(prev[win.id] ?? [], fetched);
              return JSON.stringify(prev[win.id]) === JSON.stringify(merged)
                ? prev
                : { ...prev, [win.id]: merged };
            });
          } catch (error) {
            if (active) console.warn("Không tải được lịch sử trò chuyện:", error);
          }
        }
      }
      } finally {
        refreshing = false;
      }
    }

    if (openWindows.length > 0) {
      void loadMessagesForOpenWindows();
    }
    const timer = window.setInterval(() => {
      if (openWindows.length > 0 && (streams.length === 0 || streams.some((stream) => stream.readyState !== EventSource.OPEN))) {
        void loadMessagesForOpenWindows();
      }
    }, 5000);
    /** Cập nhật các cửa sổ chat đang mở khi trình duyệt nhận focus. */
    const onFocus = () => { if (openWindows.length > 0) void loadMessagesForOpenWindows(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      streams.forEach((stream) => stream.close());
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [openWindows, contacts, currentUserId]);

  // Đưa một contact vào danh sách bubble thu gọn với cơ chế tối đa 5 người và loại bỏ người lâu nhất (LRU)
  const addContactToBubbles = useCallback((contact: ChatContact, unreadCount = 0) => {
    setBubbles((prev) => {
      // Lọc bỏ người này nếu đã có sẵn trong danh sách
      const filtered = prev.filter((b) => b.contact.id !== contact.id);

      // Sắp xếp theo thứ tự tương tác mới nhất
      const updatedItem: MinimizedBubble = {
        contact,
        unreadCount,
        lastInteractedAt: Date.now(),
      };

      const newList = [updatedItem, ...filtered];

      // Nếu vượt quá 5 người: loại bỏ người có thời gian tương tác cũ nhất
      if (newList.length > 5) {
        return newList.slice(0, 5);
      }
      return newList;
    });
  }, []);

  // Xóa bỏ một avatar chat khỏi danh sách bong bóng thu gọn khi bấm dấu X
  const handleRemoveBubble = useCallback((contactId: string) => {
    setBubbles((prev) => prev.filter((b) => b.contact.id !== contactId));
  }, []);

  // Xử lý khi bấm nút Thu nhỏ (-) trên một ô chat mini
  const handleMinimizeWindow = useCallback(
    (contact: ChatContact) => {
      // Đưa vào danh sách bubble
      addContactToBubbles(contact, 0);

      // Đóng ô chat đó khỏi màn hình
      setOpenWindows((prev) => {
        const next = prev.filter((c) => c.id !== contact.id);
        return next;
      });
    },
    [addContactToBubbles]
  );

  // Xử lý khi bấm nút Đóng (X) trên một ô chat mini
  const handleCloseWindow = useCallback((contactId: string) => {
    setOpenWindows((prev) => prev.filter((c) => c.id !== contactId));
  }, []);

  // Mở trực tiếp ô chat của một liên hệ theo đúng thứ tự 2 ô tối đa và kết nối CSDL
  const openChatForContact = useCallback(
    (contact: ChatContact) => {
      // Đóng khung chọn người nhắn và dọn dẹp bộ nhớ tạm nếu picker đang mở
      setIsPickerOpen(false);
      setTempStateBeforePicker((temp) => {
        if (temp?.displacedWindow && temp.displacedWindow.id !== contact.id) {
          addContactToBubbles(temp.displacedWindow, 0);
        }
        return null;
      });

      // Xóa khỏi danh sách bong bóng thu nhỏ nếu đang ở bubble
      setBubbles((prev) => prev.filter((b) => b.contact.id !== contact.id));

      const existingConvId =
        contact.conversationId || contacts.find((c) => c.id === contact.id)?.conversationId;
      const initialContact: ChatContact = existingConvId
        ? { ...contact, conversationId: existingConvId }
        : contact;

      setOpenWindows((prev) => {
        // Lọc sạch trùng lặp trước khi xử lý
        const cleaned = deduplicateChatWindows(prev);

        // Nếu người này đã mở sẵn ở một ô chat: giữ nguyên vị trí, không nhân bản
        if (cleaned.some((c) => c.id === initialContact.id)) {
          return cleaned.map((c) => (c.id === initialContact.id ? { ...c, ...initialContact } : c));
        }

        // Trường hợp 1: Chưa mở ô nào -> Mở thành Ô chat 1 (vị trí sát logo)
        if (cleaned.length === 0) {
          return [initialContact];
        }

        // Trường hợp 2: Đang mở 1 ô chat (ô chat 1) -> Ô mới mở thành Ô chat 2 (bên trái ô 1)
        if (cleaned.length === 1) {
          const existingWindow = cleaned[0];
          return existingWindow
            ? deduplicateChatWindows([initialContact, existingWindow])
            : [initialContact];
        }

        // Trường hợp 3: Đang mở 2 ô chat [ô 2, ô 1] ->
        // Ô 1 cũ bị thu nhỏ thành avatar bubble phía trên logo
        // Ô 2 cũ dời sang vị trí ô 1
        // Ô mới mở tại vị trí ô 2
        const oldSlot2 = cleaned[0];
        const oldSlot1 = cleaned[1];
        if (oldSlot1 && oldSlot2 && oldSlot1.id !== initialContact.id && oldSlot1.id !== oldSlot2.id) {
          addContactToBubbles(oldSlot1, 0);
        }

        return oldSlot2 ? deduplicateChatWindows([initialContact, oldSlot2]) : [initialContact];
      });

      // Nếu chưa có conversationId trong DB, kết nối hội thoại direct qua API ngay
      if (!existingConvId) {
        void (async () => {
          try {
            const conv = await apiRequest<{ id: string }>("/chat/conversations/direct", {
              method: "POST",
              body: JSON.stringify({ userId: contact.id }),
            });
            if (conv?.id) {
              setContacts((prev) =>
                prev.map((c) => (c.id === contact.id ? { ...c, conversationId: conv.id } : c))
              );
              setOpenWindows((prev) =>
                prev.map((w) => (w.id === contact.id ? { ...w, conversationId: conv.id } : w))
              );
            }
          } catch {
            // Giữ kết nối cục bộ
          }
        })();
      }
    },
    [addContactToBubbles, contacts]
  );

  // Lắng nghe sự kiện toàn cục open-mini-chat từ các màn hình khác
  useEffect(() => {
/** Đảm nhiệm handleOpenMiniChatEvent trong phạm vi module hiện tại. */
    const handleOpenMiniChatEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{
        id: string;
        name: string;
        role?: string;
        avatar?: string;
      }>;
      if (customEvent.detail) {
        const target = customEvent.detail;
        const existing = contacts.find((c) => c.id === target.id) || {
          id: target.id,
          name: target.name,
          role: target.role,
          initials: target.name.slice(0, 2).toUpperCase(),
          isOnline: true,
          statusText: "Đang hoạt động",
        };
        openChatForContact(existing);
      }
    };

    window.addEventListener("open-mini-chat", handleOpenMiniChatEvent);
    return () => {
      window.removeEventListener("open-mini-chat", handleOpenMiniChatEvent);
    };
  }, [contacts, openChatForContact]);

  // Xử lý khi bấm nút Logo Chat (nút tròn góc dưới cùng bên phải)
  const handleTogglePicker = () => {
    if (isPickerOpen) {
      // Đang mở picker mà bấm đóng -> Hủy picker
      handleCancelPicker();
    } else {
      // Mở picker:
      // Kiểm tra xem hiện đang có bao nhiêu ô chat
      if (openWindows.length === 2) {
        // Đang hiển thị 2 ô chat [ô 2, ô 1]:
        // Ô chat 2 thay vào vị trí ô chat 1, ô chat 1 tạm biến mất
        // Khung chọn người sẽ hiển thị ở vị trí chat số 2
        const currentSlot2 = openWindows[0];
        const currentSlot1 = openWindows[1];
        if (!currentSlot2 || !currentSlot1) {
          setIsPickerOpen(true);
          return;
        }

        setTempStateBeforePicker({
          displacedWindow: currentSlot1,
        });

        // Tạm thời đưa slot 2 sang slot 1
        setOpenWindows([currentSlot2]);
        setIsPickerOpen(true);
      } else {
        // Đang có 0 hoặc 1 ô chat
        setTempStateBeforePicker(null);
        setIsPickerOpen(true);
      }
    }
  };

  // Hủy/Đóng khung chọn người nhắn tin (nếu không chọn ai)
  const handleCancelPicker = () => {
    if (tempStateBeforePicker?.displacedWindow) {
      // Quay trở lại bình thường như người dùng mô tả:
      // Ô 2 về vị trí 2, ô 1 trở lại vị trí 1
      const restoredSlot1 = tempStateBeforePicker.displacedWindow;
      setOpenWindows((prev) => {
        const restoredSlot2 = prev[0];
        return restoredSlot2
          ? deduplicateChatWindows([restoredSlot2, restoredSlot1])
          : [restoredSlot1];
      });
    }
    setTempStateBeforePicker(null);
    setIsPickerOpen(false);
  };

  // Chọn một người từ khung chọn người nhắn tin
  const handleSelectContactFromPicker = (contact: ChatContact) => {
    // Xóa liên hệ này khỏi danh sách bong bóng thu nhỏ nếu có
    setBubbles((prev) => prev.filter((b) => b.contact.id !== contact.id));

    if (tempStateBeforePicker && tempStateBeforePicker.displacedWindow) {
      // Tình huống mở picker khi ban đầu đang mở 2 ô chat:
      const oldSlot1 = tempStateBeforePicker.displacedWindow;
      const oldSlot2 = openWindows[0];

      if (oldSlot2 && contact.id === oldSlot2.id) {
        // Nếu chọn lại chính người ở Slot 2 (đang tạm thế vào Slot 1):
        // Giữ nguyên người này và khôi phục Slot 1 cũ về vị trí ban đầu, tuyệt đối không tạo 2 ô trùng lặp
        setOpenWindows(deduplicateChatWindows([oldSlot2, oldSlot1]));
      } else if (contact.id === oldSlot1.id) {
        // Nếu chọn lại chính người ở Slot 1 cũ vừa bị ẩn tạm thời:
        // Đưa người này trở lại danh sách cùng với Slot 2 cũ
        setOpenWindows(oldSlot2 ? deduplicateChatWindows([contact, oldSlot2]) : [contact]);
      } else {
        // Chọn một người hoàn toàn mới:
        // Người ở ô số 1 cũ thu nhỏ lại thành avatar xuất hiện trên logo chat
        addContactToBubbles(oldSlot1, 0);
        setOpenWindows(oldSlot2 ? deduplicateChatWindows([contact, oldSlot2]) : [contact]);
      }
      setTempStateBeforePicker(null);
    } else {
      // Trường hợp thông thường (trước khi mở picker chỉ có 0 hoặc 1 ô chat):
      if (openWindows.some((c) => c.id === contact.id)) {
        // Đã mở sẵn ô chat này -> Không làm gì cả
      } else {
        openChatForContact(contact);
      }
    }
    setIsPickerOpen(false);
  };

  // Gửi tin nhắn và lưu trữ vật lý vào cơ sở dữ liệu PostgreSQL
  const handleSendMessage = async (contactId: string, text: string, isLike = false, retry?: MiniChatMessage) => {
    const messageContent = isLike ? "👍" : text;
    const clientMessageId =
      retry?.id ?? (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    const newMsg: MiniChatMessage = {
      id: clientMessageId,
      senderId: currentUserId,
      content: messageContent,
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      createdAtIso: new Date().toISOString(),
      isLike,
      status: "sending",
    };

    // 1. Cập nhật UI ngay lập tức
    setChatMessages((prev) => ({
      ...prev,
      [contactId]: mergeMiniChatMessages(
        retry ? (prev[contactId] ?? []).filter((message) => message.id !== retry.id) : (prev[contactId] ?? []),
        [newMsg],
      ),
    }));

    // Cập nhật timestamp tương tác
    setBubbles((prev) =>
      prev.map((b) =>
        b.contact.id === contactId ? { ...b, lastInteractedAt: Date.now() } : b
      )
    );

    // 2. Lưu trữ vật lý vào database PostgreSQL thông qua API chat
    try {
      let targetConvId =
        openWindows.find((w) => w.id === contactId)?.conversationId ||
        contacts.find((c) => c.id === contactId)?.conversationId;

      // Nếu chưa có conversationId trong DB, tạo hoặc lấy cuộc hội thoại direct 1-1
      if (!targetConvId) {
        const conv = await apiRequest<{ id: string }>("/chat/conversations/direct", {
          method: "POST",
          body: JSON.stringify({ userId: contactId }),
        });
        if (conv?.id) {
          targetConvId = conv.id;
          setContacts((prev) =>
            prev.map((c) => (c.id === contactId ? { ...c, conversationId: conv.id } : c))
          );
          setOpenWindows((prev) =>
            prev.map((w) => (w.id === contactId ? { ...w, conversationId: conv.id } : w))
          );
        }
      }

      // Gửi tin nhắn vào bảng chat_messages
      if (!targetConvId) throw new Error("Không mở được hội thoại để gửi tin nhắn.");
      const sent = await apiRequest<{ id: string; senderId: string; clientMessageId?: string; content: string; createdAt: string }>(
        `/chat/conversations/${targetConvId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: messageContent, clientMessageId }),
        },
      );
      setChatMessages((prev) => {
        const messages = prev[contactId] ?? [];
        return { ...prev, [contactId]: mergeMiniChatMessages(messages, [{
          id: sent.id,
          senderId: sent.senderId,
          content: sent.content,
          createdAt: new Date(sent.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          createdAtIso: sent.createdAt,
          clientMessageId: sent.clientMessageId ?? clientMessageId,
          isLike: sent.content === "👍",
        }]) };
      });
    } catch (error) {
      console.warn("Không gửi được tin nhắn:", error);
      setChatMessages((prev) => ({
        ...prev,
        [contactId]: (prev[contactId] ?? []).map((message) => message.id === clientMessageId ? { ...message, status: "failed" } : message),
      }));
    }
  };

  // Đính kèm file ảnh từ máy tính gửi trong tin nhắn
  const handleAttachImage = (contactId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = reader.result as string;
      const newMsg: MiniChatMessage = {
        id: `img-${Date.now()}`,
        senderId: currentUserId,
        content: "",
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        imageUrl,
      };

      setChatMessages((prev) => ({
        ...prev,
        [contactId]: [...(prev[contactId] || []), newMsg],
      }));
    };
    reader.readAsDataURL(file);
  };

  // Xác định các thành phần hiển thị ở Slot 2, Slot 1 và Cột Logo
  // Quy tắc hiển thị ngang từ trái sang phải: [Ô chat 2] [Ô chat 1] [Cột Logo chat]
  const uniqueWindows = useMemo(() => deduplicateChatWindows(openWindows), [openWindows]);
  const slot1Window = uniqueWindows.length === 2 ? uniqueWindows[1] : uniqueWindows[0] || null;
  const slot2Window =
    uniqueWindows.length === 2 && uniqueWindows[0]?.id !== uniqueWindows[1]?.id
      ? uniqueWindows[0]
      : null;


  // Ẩn hoàn toàn ô chat minisize khi người dùng đã vào trang Chat chính (/messages)
  if (pathname?.startsWith("/messages")) {
    return null;
  }

  return (
    <aside aria-label="Khung tin nhắn mini" className="fixed bottom-0 right-4 z-50 flex items-end gap-3 pointer-events-none select-none">
      {/* Vị trí Ô chat số 2 (nằm bên trái Ô chat số 1) */}
      {isPickerOpen && openWindows.length === 1 ? (
        // Khi mới mở 1 ô chat (ô 1), ấn logo chat thì hiển thị danh sách ở bên trái ô chat 1
        <ContactPickerWindow
          contacts={contacts}
          onSelectContact={handleSelectContactFromPicker}
          onClose={handleCancelPicker}
        />
      ) : slot2Window ? (
        <SingleMiniChatWindow
          contact={slot2Window}
          messages={chatMessages[slot2Window.id] || []}
          currentUserId={currentUserId}
          onClose={() => handleCloseWindow(slot2Window.id)}
          onMinimize={() => handleMinimizeWindow(slot2Window)}
          onSendMessage={(text, isLike) => handleSendMessage(slot2Window.id, text, isLike)}
          onRetryMessage={(message) => handleSendMessage(slot2Window.id, message.content, message.isLike, message)}
          onAttachImage={(file) => handleAttachImage(slot2Window.id, file)}
        />
      ) : null}

      {/* Vị trí Ô chat số 1 (nằm sát bên trái Logo Chat) */}
      {isPickerOpen && openWindows.length === 0 ? (
        // Khi chưa mở ô chat nào, ấn logo chat thì hiển thị danh sách ở vị trí ô chat 1
        <ContactPickerWindow
          contacts={contacts}
          onSelectContact={handleSelectContactFromPicker}
          onClose={handleCancelPicker}
        />
      ) : slot1Window ? (
        <SingleMiniChatWindow
          contact={slot1Window}
          messages={chatMessages[slot1Window.id] || []}
          currentUserId={currentUserId}
          onClose={() => handleCloseWindow(slot1Window.id)}
          onMinimize={() => handleMinimizeWindow(slot1Window)}
          onSendMessage={(text, isLike) => handleSendMessage(slot1Window.id, text, isLike)}
          onRetryMessage={(message) => handleSendMessage(slot1Window.id, message.content, message.isLike, message)}
          onAttachImage={(file) => handleAttachImage(slot1Window.id, file)}
        />
      ) : null}

      {/* Cột Logo Chat và các Avatar thu gọn phía bên phải ngoài cùng */}
      <div className="w-13 sm:w-14 flex flex-col items-center gap-2.5 pb-3 pointer-events-auto shrink-0">
        {/* Danh sách tối đa 5 avatar chat thu nhỏ xếp dọc phía trên logo chat */}
        <div className="flex flex-col items-center gap-2.5">
          {bubbles.map((bubble) => (
            <div key={bubble.contact.id} className="relative group">
              {/* Nút bấm vào avatar để mở lại ô chat */}
              <button
                type="button"
                onClick={() => {
                  if (isPickerOpen) handleCancelPicker();
                  openChatForContact(bubble.contact);
                }}
                className="relative block rounded-full focus:outline-hidden hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                title={`Mở chat với ${bubble.contact.name}`}
              >
                <ContactAvatarBadge contact={bubble.contact} size="bubble" />

                {/* Chỉ số báo số tin nhắn mới chưa đọc ở góc trên avatar */}
                {bubble.unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-600 text-white text-[11px] font-extrabold rounded-full flex items-center justify-center border-2 border-[#1e1f24] shadow-md animate-pulse">
                    {bubble.unreadCount > 9 ? "9+" : bubble.unreadCount}
                  </span>
                )}
              </button>

              {/* Dấu x trên avatar để tắt avatar chat đó đi */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveBubble(bubble.contact.id);
                }}
                className="absolute -top-1 -left-1 size-5 rounded-full bg-[#26272e] text-slate-300 hover:text-white hover:bg-rose-600 border border-slate-600 flex items-center justify-center shadow-md transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-10"
                title="Tắt cuộc trò chuyện"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>

        {/* Nút Logo Chat hình tròn biểu tượng cây bút để chọn người nhắn */}
        <button
          type="button"
          onClick={handleTogglePicker}
          className={`size-12 sm:size-[52px] rounded-full text-white shadow-2xl flex items-center justify-center transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 group relative ${
            isPickerOpen
              ? "bg-indigo-600 ring-4 ring-indigo-500/30"
              : "bg-[#3a3b3c] hover:bg-[#4a4b4c]"
          }`}
          title={isPickerOpen ? "Đóng chọn người nhắn" : "Soạn tin nhắn mới"}
        >
          {isPickerOpen ? (
            <X size={22} className="text-white" />
          ) : (
            <SquarePen size={22} className="text-white group-hover:scale-110 transition-transform" />
          )}
        </button>
      </div>
    </aside>
  );
}
