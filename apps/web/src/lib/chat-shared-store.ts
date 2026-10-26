/**
 * Kho lưu trữ và đồng bộ dữ liệu chat dùng chung giữa Mini Chat Widget và Giao diện Tin nhắn Messenger 3 cột.
 * Đảm bảo mọi cuộc trò chuyện, tin nhắn gửi từ ô chat nổi hay trang chat chính đều được đồng bộ tức thì.
 */

export interface SharedChatContact {
  id: string;
  name: string;
  role: string;
  initials: string;
  gradient: string;
  avatarUrl?: string;
  isOnline: boolean;
  statusText: string;
  type: "DIRECT" | "CLASS";
  classCode?: string;
  lastMessageText?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

export interface SharedChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  replyTo?: { id: string; senderName: string; content: string };
}

export const SHARED_DEFAULT_CONTACTS: SharedChatContact[] = [
  {
    id: "teacher-1",
    name: "Hà Thị Lý",
    role: "Giáo viên Toán 12A1",
    initials: "HTL",
    gradient: "from-blue-600 to-indigo-600",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Thầy/Cô đã nhận được câu hỏi của em. Em xem lại công thức ở mục 3 trang 45 nhé!",
    lastMessageTime: "20:02",
    unreadCount: 0,
  },
  {
    id: "student-hai",
    name: "Phạm Ánh Hải",
    role: "Học viên lớp Toán 12A1",
    initials: "AH",
    gradient: "from-rose-500 to-pink-600",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Có nha, 15h vào phòng Zoom của thầy Nam nhé!",
    lastMessageTime: "17:36",
    unreadCount: 0,
  },
  {
    id: "teacher-nam",
    name: "Vũ Thành Nam",
    role: "Giảng viên CNTT",
    initials: "VTN",
    gradient: "from-emerald-600 to-teal-600",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Chào em, bài thực hành em nộp chạy thử rất ổn. Nhớ chú ý tối ưu thuật toán thêm nhé.",
    lastMessageTime: "15:45",
    unreadCount: 0,
  },
  {
    id: "student-anime",
    name: "Nguyễn Thảo My",
    role: "Học sinh 12A3",
    initials: "TM",
    gradient: "from-sky-400 to-indigo-500",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Bạn ơi cho mình hỏi tài liệu ôn thi học kỳ tải ở mục nào vậy?",
    lastMessageTime: "19:40",
    unreadCount: 1,
  },
  {
    id: "admin-system",
    name: "Ban Quản trị & Kỹ thuật",
    role: "Hỗ trợ học tập Wind EDU",
    initials: "AD",
    gradient: "from-amber-500 to-orange-600",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Trung tâm hỗ trợ Wind EDU đã ghi nhận yêu cầu của bạn và sẽ kiểm tra trong ít phút.",
    lastMessageTime: "Hôm qua",
    unreadCount: 0,
  },
  {
    id: "class-web-k01",
    name: "Lớp Web Full-stack (WEB-K01)",
    role: "Nhóm lớp học chính khóa · 32 thành viên",
    initials: "WF",
    gradient: "from-indigo-600 to-violet-700",
    isOnline: true,
    statusText: "32 thành viên",
    type: "CLASS",
    classCode: "WEB-K01",
    lastMessageText: "Thầy Nam: Hạn nộp bài tập Assignment 02 là trước 23h59 Chủ nhật tuần này.",
    lastMessageTime: "09:15",
    unreadCount: 2,
  },
  {
    id: "student-minh",
    name: "Nguyễn Đức Minh",
    role: "Lớp trưởng 12A1",
    initials: "DM",
    gradient: "from-purple-600 to-violet-700",
    isOnline: true,
    statusText: "Hoạt động 5 phút trước",
    type: "DIRECT",
    lastMessageText: "Mai họp cán sự lớp đầu giờ chiều nhé các bạn.",
    lastMessageTime: "12:30",
    unreadCount: 0,
  },
  {
    id: "student-huong",
    name: "Trần Thị Hương",
    role: "Ban cán sự học tập",
    initials: "TH",
    gradient: "from-cyan-600 to-blue-600",
    isOnline: false,
    statusText: "Hoạt động 1 giờ trước",
    type: "DIRECT",
    lastMessageText: "Mình gửi bản tóm tắt bài giảng hôm nay qua file đính kèm rồi nha.",
    lastMessageTime: "11:20",
    unreadCount: 0,
  },
  {
    id: "student-long",
    name: "Lê Hoàng Long",
    role: "Nhóm trưởng Tin học",
    initials: "HL",
    gradient: "from-fuchsia-600 to-pink-600",
    isOnline: true,
    statusText: "Đang hoạt động",
    type: "DIRECT",
    lastMessageText: "Đề tài bài tập lớn nhóm mình chốt làm website học trực tuyến nhé!",
    lastMessageTime: "08:45",
    unreadCount: 0,
  },
];

const INITIAL_SHARED_MESSAGES: Record<string, SharedChatMessage[]> = {
  "teacher-1": [
    {
      id: "msg-t1-1",
      conversationId: "teacher-1",
      senderId: "teacher-1",
      senderName: "Hà Thị Lý",
      content: "Chào em, em cần hỗ trợ bài tập môn Toán hay thắc mắc về đề kiểm tra vừa rồi?",
      createdAt: "2026-10-26T20:00:00Z",
    },
    {
      id: "msg-t1-2",
      conversationId: "teacher-1",
      senderId: "teacher-1",
      senderName: "Hà Thị Lý",
      content: "Thầy/Cô đã nhận được câu hỏi của em. Em xem lại công thức ở mục 3 trang 45 nhé!",
      createdAt: "2026-10-26T20:02:00Z",
    },
  ],
  "student-hai": [
    {
      id: "msg-h1-1",
      conversationId: "student-hai",
      senderId: "current-user",
      senderName: "Tôi",
      content: "Hải ơi, chiều nay có học online ca 2 không bạn?",
      createdAt: "2026-10-26T17:35:00Z",
    },
    {
      id: "msg-h1-2",
      conversationId: "student-hai",
      senderId: "student-hai",
      senderName: "Phạm Ánh Hải",
      content: "Có nha, 15h vào phòng Zoom của thầy Nam nhé!",
      createdAt: "2026-10-26T17:36:00Z",
    },
    {
      id: "msg-h1-3",
      conversationId: "student-hai",
      senderId: "student-hai",
      senderName: "Phạm Ánh Hải",
      content: "Thầy bảo hôm nay có kiểm tra tiến độ 15 phút đầu giờ đó, ôn kỹ phần React Hooks nha.",
      createdAt: "2026-10-26T17:36:30Z",
    },
  ],
  "teacher-nam": [
    {
      id: "msg-tn-1",
      conversationId: "teacher-nam",
      senderId: "teacher-nam",
      senderName: "Vũ Thành Nam",
      content: "Chào em, bài thực hành em nộp chạy thử rất ổn. Nhớ chú ý tối ưu thuật toán thêm nhé.",
      createdAt: "2026-10-26T15:45:00Z",
    },
  ],
  "student-anime": [
    {
      id: "msg-tm-1",
      conversationId: "student-anime",
      senderId: "student-anime",
      senderName: "Nguyễn Thảo My",
      content: "Bạn ơi cho mình hỏi tài liệu ôn thi học kỳ tải ở mục nào vậy?",
      createdAt: "2026-10-26T19:40:00Z",
    },
  ],
  "class-web-k01": [
    {
      id: "msg-cw-1",
      conversationId: "class-web-k01",
      senderId: "teacher-nam",
      senderName: "Vũ Thành Nam",
      content: "Chào cả lớp, hôm nay lớp mình học bài Kiến trúc RESTful API & Next.js 15 nhé.",
      createdAt: "2026-10-26T08:30:00Z",
    },
    {
      id: "msg-cw-2",
      conversationId: "class-web-k01",
      senderId: "teacher-nam",
      senderName: "Vũ Thành Nam",
      content: "Thầy Nam: Hạn nộp bài tập Assignment 02 là trước 23h59 Chủ nhật tuần này.",
      createdAt: "2026-10-26T09:15:00Z",
    },
  ],
};

const STORAGE_KEY = "wind_shared_chat_store_v2";
const SYNC_EVENT = "wind-chat-sync-event";

/** Lấy toàn bộ bản đồ tin nhắn chia sẻ từ localStorage hoặc fallback mẫu */
export function getStoredChatMessages(): Record<string, SharedChatMessage[]> {
  if (typeof window === "undefined") return INITIAL_SHARED_MESSAGES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SHARED_MESSAGES));
      return INITIAL_SHARED_MESSAGES;
    }
    const parsed = JSON.parse(raw);
    return { ...INITIAL_SHARED_MESSAGES, ...parsed };
  } catch {
    return INITIAL_SHARED_MESSAGES;
  }
}

/** Lưu tin nhắn mới vào kho chung và phát sự kiện đồng bộ toàn ứng dụng */
export function appendSharedChatMessage(msg: SharedChatMessage): void {
  if (typeof window === "undefined") return;
  try {
    const current = getStoredChatMessages();
    const list = current[msg.conversationId] ? [...current[msg.conversationId]] : [];
    list.push(msg);
    current[msg.conversationId] = list;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { conversationId: msg.conversationId, message: msg } }));
  } catch {
    // Dự phòng lỗi lưu trữ
  }
}

/** Đăng ký lắng nghe sự kiện đồng bộ tin nhắn thời gian thực giữa các component */
export function subscribeSharedChat(callback: (event: CustomEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback(e as CustomEvent);
  window.addEventListener(SYNC_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SYNC_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
