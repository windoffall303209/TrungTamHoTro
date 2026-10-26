"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Minus,
  Send,
  Search,
  ThumbsUp,
  Image as ImageIcon,
  Mic,
  Smile,
  Users,
  Shield,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { apiRequest } from "@/lib/api-client";
import type { ChatConversation, ChatMessage } from "@/lib/chat-types";

interface ChatTarget {
  id: string;
  name: string;
  role?: string;
  avatar?: string;
}

/** Component Chat mini nổi ở góc phải màn hình theo phong cách tin nhắn mạng xã hội */
export function MiniChatWidget() {
  const { session, notify } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ChatTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  // Danh sách tin nhắn giả lập & hội thoại để người dùng trải nghiệm tức thời
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Array<{ id: string; senderId: string; content: string; createdAt: string; isLike?: boolean }>>>({
    "teacher-1": [
      {
        id: "msg-1",
        senderId: "teacher-1",
        content: "Chào em, em cần hỗ trợ bài tập môn Toán hay thắc mắc về đề kiểm tra vừa rồi?",
        createdAt: "20:02",
      },
      {
        id: "msg-2",
        senderId: session.user.id || "me",
        content: "Dạ em chào Thầy/Cô, em muốn hỏi về câu số 4 trong bài kiểm tra 15 phút hôm nay ạ.",
        createdAt: "20:03",
      },
    ],
    "admin-1": [
      {
        id: "msg-adm-1",
        senderId: "admin-1",
        content: "Trung tâm hỗ trợ Wind EDU xin chào bạn. Bạn cần hỗ trợ kỹ thuật hay tài khoản?",
        createdAt: "09:30",
      },
    ],
  });

  const messageEndRef = useRef<HTMLDivElement>(null);

  /** Cuộn xuống dòng tin nhắn mới nhất trong khung chat */
  const scrollToBottom = useCallback(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (activeTarget && isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [activeTarget, isOpen, isMinimized, messages, scrollToBottom]);

  /** Lắng nghe sự kiện mở chat từ các màn hình khác (ví dụ nút Chat cạnh thành viên lớp) */
  useEffect(() => {
    const handleOpenChat = (event: Event) => {
      const customEvent = event as CustomEvent<ChatTarget>;
      if (customEvent.detail) {
        setActiveTarget(customEvent.detail);
        setIsOpen(true);
        setIsMinimized(false);
      }
    };

    window.addEventListener("open-mini-chat", handleOpenChat);
    return () => {
      window.removeEventListener("open-mini-chat", handleOpenChat);
    };
  }, []);

  /** Tải danh sách hội thoại từ API hoặc khởi tạo mặc định */
  const loadConversations = useCallback(async () => {
    try {
      const data = await apiRequest<ChatConversation[]>("/chat/conversations", {
        roleCode: session.roleCode,
      });
      if (Array.isArray(data) && data.length > 0) {
        setConversations(data);
      }
    } catch {
      // Dùng danh sách fallback trực quan nếu chưa có tin nhắn backend
      setConversations([]);
    }
  }, [session.roleCode]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Danh bạ liên hệ nhanh mặc định (Giáo viên, Admin, Quản trị)
  const defaultContacts: ChatTarget[] = useMemo(
    () => [
      {
        id: "teacher-1",
        name: "Hà Thị Lý (Giáo viên Toán)",
        role: "INSTRUCTOR",
        avatar: "L",
      },
      {
        id: "admin-1",
        name: "Ban Quản trị & Kỹ thuật",
        role: "SYSTEM_ADMIN",
        avatar: "AD",
      },
      {
        id: "teacher-2",
        name: "Vũ Thành Nam (Giảng viên)",
        role: "INSTRUCTOR",
        avatar: "VN",
      },
    ],
    [],
  );

  /** Gửi một tin nhắn văn bản hoặc biểu tượng Like nhanh */
  const handleSendMessage = (customText?: string, isLike = false) => {
    const text = customText !== undefined ? customText : inputText.trim();
    if (!text && !isLike) return;
    if (!activeTarget) return;

    const newMsg = {
      id: `msg-${Date.now()}`,
      senderId: session.user.id || "me",
      content: isLike ? "👍" : text,
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isLike,
    };

    setMessages((prev) => ({
      ...prev,
      [activeTarget.id]: [...(prev[activeTarget.id] || []), newMsg],
    }));

    if (!isLike) {
      setInputText("");
    }

    // Mô phỏng phản hồi tự động nếu là kênh hỗ trợ
    if (activeTarget.id === "admin-1" || activeTarget.id === "teacher-1") {
      setTimeout(() => {
        const replyMsg = {
          id: `reply-${Date.now()}`,
          senderId: activeTarget.id,
          content: isLike ? "👍 Cảm ơn bạn!" : "Tin nhắn của bạn đã được tiếp nhận. Chúng tôi sẽ phản hồi sớm nhất!",
          createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => ({
          ...prev,
          [activeTarget.id]: [...(prev[activeTarget.id] || []), replyMsg],
        }));
      }, 1200);
    }
  };

  const filteredContacts = defaultContacts.filter((contact) =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {/* Khung Chat Mini Size */}
      {isOpen && (
        <div
          className={`mb-3 w-80 sm:w-88 rounded-2xl border border-slate-700/80 bg-[#1e1f24] text-slate-100 shadow-2xl transition-all duration-200 overflow-hidden flex flex-col ${
            isMinimized ? "h-14" : "h-[480px] max-h-[80vh]"
          }`}
        >
          {/* Header Mini Chat */}
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#26272e] border-b border-slate-700/70 select-none">
            <div className="flex items-center gap-2.5 min-w-0">
              {activeTarget ? (
                <>
                  <div className="size-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 grid place-items-center text-white text-xs font-bold shrink-0">
                    {activeTarget.avatar || activeTarget.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setActiveTarget(null)}
                      className="text-xs font-bold text-slate-100 hover:underline truncate block max-w-[160px] text-left"
                    >
                      {activeTarget.name}
                    </button>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Đang hoạt động
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-full bg-blue-600 grid place-items-center text-white text-xs font-bold">
                    <MessageCircle size={14} />
                  </div>
                  <strong className="text-xs font-bold text-white">Tin nhắn học tập</strong>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              {activeTarget && (
                <button
                  type="button"
                  onClick={() => setActiveTarget(null)}
                  title="Danh sách liên hệ"
                  className="p-1 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors text-xs font-semibold mr-1"
                >
                  Đổi người
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsMinimized((prev) => !prev)}
                className="p-1.5 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors"
                title={isMinimized ? "Phóng to" : "Thu nhỏ"}
              >
                <Minus size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setIsMinimized(false);
                }}
                className="p-1.5 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors"
                title="Đóng chat"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Nội dung cửa sổ Chat (khi không thu nhỏ) */}
          {!isMinimized && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#18191e]">
              {!activeTarget ? (
                /* Màn hình danh sách liên hệ & hội thoại */
                <div className="flex-1 flex flex-col p-3 space-y-3 overflow-y-auto">
                  {/* Ô tìm kiếm người chat */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm kiếm người nhắn tin..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#26272e] border border-slate-700 text-xs text-white placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 px-1 mb-2">
                      Kênh liên hệ nhanh
                    </p>
                    <div className="space-y-1">
                      {filteredContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => setActiveTarget(contact)}
                          className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#26272e] transition-colors text-left group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="size-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 grid place-items-center text-white text-xs font-bold shrink-0">
                              {contact.avatar}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                                {contact.name}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {contact.role === "INSTRUCTOR"
                                  ? "Giáo viên giảng dạy"
                                  : "Quản trị hệ thống"}
                              </p>
                            </div>
                          </div>
                          <span className="text-[11px] text-blue-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                            Nhắn tin
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Màn hình khung chat chi tiết với 1 người */
                <>
                  <div className="flex-1 p-3 overflow-y-auto space-y-3">
                    {/* Thẻ thông tin cá nhân nổi bật giống mẫu của người dùng */}
                    <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#26272e]/60 border border-slate-700/60 text-center my-2">
                      <div className="size-14 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 grid place-items-center text-white text-lg font-bold shadow-md mb-2">
                        {activeTarget.avatar || activeTarget.name.slice(0, 2).toUpperCase()}
                      </div>
                      <strong className="text-sm font-bold text-white block">{activeTarget.name}</strong>
                      <span className="text-[11px] text-slate-400 mt-0.5">Wind EDU Chat</span>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-slate-200 transition-colors"
                          onClick={() => notify(`Đang mở trang cá nhân của ${activeTarget.name}`)}
                        >
                          Trang cá nhân
                        </button>
                      </div>
                    </div>

                    <p className="text-center text-[10px] text-slate-400 my-2">
                      Hôm nay, {new Date().toLocaleDateString("vi-VN")}
                    </p>

                    {/* Danh sách tin nhắn */}
                    {(messages[activeTarget.id] || []).map((msg) => {
                      const isMe = msg.senderId === (session.user.id || "me");
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                        >
                          {msg.isLike ? (
                            <div className="my-1 text-4xl leading-none animate-bounce">
                              👍
                            </div>
                          ) : (
                            <div
                              className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed ${
                                isMe
                                  ? "bg-blue-600 text-white rounded-br-xs"
                                  : "bg-[#2a2b33] text-slate-100 rounded-bl-xs border border-slate-700/60"
                              }`}
                            >
                              {msg.content}
                            </div>
                          )}
                          <span className="text-[9px] text-slate-400 mt-0.5 px-1">
                            {msg.createdAt} {isMe && "· Đã gửi"}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </div>

                  {/* Thanh soạn tin nhắn dưới cùng */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="p-2.5 bg-[#26272e] border-t border-slate-700/80 flex items-center gap-1.5"
                  >
                    <button
                      type="button"
                      title="Gửi file ảnh"
                      onClick={() => notify("Chức năng đính kèm ảnh tin nhắn")}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors"
                    >
                      <ImageIcon size={16} />
                    </button>
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Aa"
                      className="flex-1 py-1.5 px-3 rounded-full bg-[#18191e] border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500"
                    />
                    <button
                      type="button"
                      title="Biểu tượng cảm xúc"
                      onClick={() => handleSendMessage("😊")}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors"
                    >
                      <Smile size={16} />
                    </button>
                    {inputText.trim() ? (
                      <button
                        type="submit"
                        className="p-1.5 text-blue-400 hover:text-blue-300 rounded-lg hover:bg-slate-700/50 transition-colors"
                      >
                        <Send size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendMessage(undefined, true)}
                        title="Gửi Like nhanh"
                        className="p-1.5 text-blue-500 hover:scale-110 active:scale-95 transition-transform"
                      >
                        <ThumbsUp size={18} fill="currentColor" />
                      </button>
                    )}
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bong bóng Chat tròn nổi ở góc màn hình */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="size-13 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all grid place-items-center group relative cursor-pointer"
          title="Nhắn tin với giáo viên & bạn học"
        >
          <MessageCircle size={24} className="group-hover:rotate-6 transition-transform" />
          <span className="absolute -top-0.5 -right-0.5 size-3.5 bg-emerald-500 border-2 border-white rounded-full" />
        </button>
      )}
    </div>
  );
}
