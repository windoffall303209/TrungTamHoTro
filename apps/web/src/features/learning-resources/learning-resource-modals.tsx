"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  PhoneOff,
  Play,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

/** Dữ liệu ca học trực tuyến */
export interface LiveRoomData {
  id: string;
  title: string;
  subject?: string;
  instructorName?: string;
  startsAt?: string;
  endsAt?: string;
  status?: "LIVE" | "UPCOMING" | "COMPLETED" | string;
  canJoin?: boolean;
}

/** Dữ liệu tài liệu xem trước */
export interface DocumentViewerData {
  id: string;
  title: string;
  subject?: string;
  format?: string;
  size?: string;
  pagesCount?: number;
  uploadedAt?: string;
  downloadUrl?: string;
}

/** Dữ liệu bài giảng video */
export interface LecturePlayerData {
  id: string;
  title: string;
  subject?: string;
  instructor?: string;
  duration?: string;
  quality?: string;
  uploadedAt?: string;
  videoUrl?: string;
}

/** Kích hoạt tải tệp mẫu về máy người dùng */
export function triggerFileDownload(filename: string, content = "Wind EDU - Dữ liệu học liệu số bản quyền.") {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

interface LiveRoomModalProps {
  open: boolean;
  onClose: () => void;
  room: LiveRoomData | null;
}

/** Component Modal phòng học trực tuyến toàn màn hình hoặc thông báo lý do chưa vào được */
export function LiveRoomModal({ open, onClose, room }: LiveRoomModalProps) {
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ sender: string; text: string; time: string }>>([
    { sender: "Hệ thống", text: "Chào mừng bạn tham gia phòng học trực tuyến.", time: "19:30" },
    { sender: "GV. Nguyễn Văn Nam", text: "Chào cả lớp, các em mở tài liệu bài 4 chuẩn bị nhé.", time: "19:31" },
    { sender: "Trần Minh", text: "Thầy ơi em nghe rất rõ ạ!", time: "19:32" },
  ]);

  if (!open || !room) return null;

  const isLive = room.status === "LIVE" || room.status === "Hôm nay" || room.canJoin === true;

  // Xử lý gửi tin nhắn trong phòng học
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setChatMessages((prev) => [
      ...prev,
      { sender: "Bạn", text: chatInput.trim(), time: timeStr },
    ]);
    setChatInput("");
  };

  // Trường hợp CHƯA ĐẾN GIỜ VÀO PHÒNG: Hiển thị thông báo chi tiết lý do và thời gian
  if (!isLive) {
    return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4">
          <div className="size-16 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 grid place-items-center mx-auto">
            <Clock size={36} />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Chưa đến giờ vào phòng học
            </h3>
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
              {room.title}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
              Ca học này được lên lịch vào lúc{" "}
              <strong>{room.startsAt || "19:30"} - {room.endsAt || "21:00"}</strong>.
              Phòng học trực tuyến sẽ tự động mở trước giờ bắt đầu <strong>10 phút</strong> để học sinh ổn định micro và camera.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs text-left space-y-1.5">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Giảng viên phụ trách:</span>
              <strong className="text-slate-900 dark:text-slate-100">{room.instructorName || "Thầy Nguyễn Văn Nam"}</strong>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Trạng thái phòng:</span>
              <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold text-[10px]">
                Sắp diễn ra
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
          >
            Đã hiểu và quay lại sau
          </button>
        </div>
      </div>
    );
  }

  // Trường hợp ĐANG DIỄN RA: Mở giao diện phòng học trực tuyến đầy đủ
  return (
    <div className="fixed inset-0 z-[99999] flex flex-col bg-[#0f1015] text-white">
      {/* Header phòng học trực tuyến */}
      <header className="flex items-center justify-between px-5 py-3 bg-[#171821] border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-xs font-bold">
            <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
            TRỰC TIẾP
          </span>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              {room.title}
            </h2>
            <p className="text-xs text-slate-400">
              GV: {room.instructorName || "Thầy Nguyễn Văn Nam"} · Môn: {room.subject || "Toán nâng cao"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">
            <Users size={14} className="text-blue-400" />
            <span>34 học viên</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <PhoneOff size={14} />
            <span>Rời phòng</span>
          </button>
        </div>
      </header>

      {/* Vùng màn hình lớp học */}
      <div className="flex-1 flex overflow-hidden">
        {/* Màn hình giảng bài chính */}
        <main className="flex-1 flex flex-col items-center justify-center p-4 relative bg-[#0b0c10]">
          {/* Khung chia sẻ màn hình bài giảng */}
          <div className="w-full h-full max-w-5xl rounded-2xl bg-[#161722] border border-slate-800 flex flex-col overflow-hidden relative shadow-2xl">
            {/* Header màn hình trình chiếu */}
            <div className="px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <Monitor size={14} className="text-emerald-400" />
                <span>{room.instructorName || "Thầy Nguyễn Văn Nam"} đang chia sẻ màn hình bài giảng</span>
              </span>
              <span className="text-[11px] font-mono text-emerald-400">HD 1080p · 60fps</span>
            </div>

            {/* Nội dung bảng trình chiếu */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-gradient-to-b from-[#13141f] to-[#0c0d14]">
              <div className="size-20 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 grid place-items-center mx-auto shadow-inner">
                <BookOpen size={40} />
              </div>
              <div className="max-w-lg space-y-2">
                <h3 className="text-lg sm:text-xl font-bold text-white">
                  Chuyên đề: Phương pháp giải nhanh và tối ưu bài toán trọng tâm
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Đang trình chiếu Slide 12/28: Công thức đạo hàm và ứng dụng khảo sát biến thiên hàm số bậc ba.
                </p>
              </div>
            </div>

            {/* Khung camera giáo viên góc dưới */}
            <div className="absolute bottom-4 right-4 w-48 h-32 rounded-xl bg-slate-900/95 border border-slate-700 shadow-xl overflow-hidden flex flex-col items-center justify-center text-center p-2">
              <div className="size-10 rounded-full bg-blue-600 text-white font-bold grid place-items-center text-xs mb-1">
                NVN
              </div>
              <p className="text-[11px] font-bold text-white truncate max-w-full">
                {room.instructorName || "Thầy Nguyễn Văn Nam"}
              </p>
              <div className="flex items-center gap-1 text-[9px] text-emerald-400 mt-1">
                <Mic size={10} />
                <span>Đang nói...</span>
              </div>
            </div>
          </div>
        </main>

        {/* Khung chat trong lớp học (có thể toggle) */}
        {chatOpen && (
          <aside className="w-80 border-l border-slate-800 bg-[#161722] flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Trò chuyện lớp học
              </h3>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs">
              {chatMessages.map((msg, i) => (
                <div key={i} className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/50 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <strong className={msg.sender === "Bạn" ? "text-blue-400" : "text-emerald-400"}>
                      {msg.sender}
                    </strong>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-slate-200 leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendChat} className="p-3 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Gửi tin nhắn..."
                className="flex-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500"
              />
              <button
                type="submit"
                className="size-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white grid place-items-center transition-colors cursor-pointer"
              >
                <Send size={14} />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Thanh điều khiển dưới đáy phòng học */}
      <footer className="h-16 px-6 bg-[#171821] border-t border-slate-800 flex items-center justify-between shrink-0">
        <div className="text-xs text-slate-400">
          Thời gian tham gia: <strong className="text-white font-mono">00:24:18</strong>
        </div>

        {/* Nút bật/tắt thiết bị */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMicOn((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              micOn ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-rose-600/90 hover:bg-rose-700 text-white"
            }`}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            <span>{micOn ? "Bật Mic" : "Tắt Mic"}</span>
          </button>

          <button
            type="button"
            onClick={() => setCameraOn((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              cameraOn ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-rose-600/90 hover:bg-rose-700 text-white"
            }`}
          >
            {cameraOn ? <Video size={16} /> : <VideoOff size={16} />}
            <span>{cameraOn ? "Bật Cam" : "Tắt Cam"}</span>
          </button>

          <button
            type="button"
            onClick={() => setHandRaised((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              handRaised ? "bg-amber-500 text-slate-900" : "bg-slate-800 hover:bg-slate-700 text-slate-200"
            }`}
          >
            <span>✋</span>
            <span>{handRaised ? "Hạ tay" : "Giơ tay"}</span>
          </button>

          <button
            type="button"
            onClick={() => setChatOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              chatOpen ? "bg-blue-600 text-white" : "bg-slate-800 hover:bg-slate-700 text-slate-200"
            }`}
          >
            <Users size={16} />
            <span>Trò chuyện</span>
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
          >
            Đóng cửa sổ
          </button>
        </div>
      </footer>
    </div>
  );
}

interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  document: DocumentViewerData | null;
}

/** Component Modal xem trước tài liệu trực tiếp và hỗ trợ tải về máy */
export function DocumentViewerModal({ open, onClose, document: doc }: DocumentViewerModalProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);

  if (!open || !doc) return null;

  const totalPages = doc.pagesCount || 5;

/** Đảm nhiệm handleDownload trong phạm vi module hiện tại. */
  const handleDownload = () => {
    triggerFileDownload(`${doc.title}.${doc.format || "pdf"}`);
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-5 select-none">
      <div className="relative flex flex-col w-full max-w-5xl h-[92vh] rounded-2xl bg-white dark:bg-[#15161e] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header Modal xem tài liệu */}
        <header className="flex items-center justify-between px-5 py-3.5 bg-slate-50 dark:bg-[#1d1f2a] border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold uppercase">
              {doc.format || "PDF"}
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {doc.title}
              </h2>
              <p className="text-xs text-slate-500">
                Dung lượng: {doc.size || "2.4 MB"} · Chủ đề: {doc.subject || "Kiến thức trọng tâm"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} />
              <span>Tải về</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="size-9 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 grid place-items-center transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Vùng xem trang tài liệu */}
        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-[#0d0e14] p-4 sm:p-6 flex justify-center">
          <div
            style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}
            className="w-full max-w-2xl min-h-[600px] bg-white text-slate-900 rounded-xl shadow-xl border border-slate-200 p-8 sm:p-12 space-y-6 transition-transform"
          >
            {/* Giả lập tài liệu trang */}
            <div className="border-b border-slate-200 pb-4 text-center space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                Học liệu số chuẩn hóa · Wind EDU
              </span>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                {doc.title}
              </h1>
              <p className="text-xs text-slate-500">
                Môn học: {doc.subject || "Chuyên đề"} — Trang {currentPage}/{totalPages}
              </p>
            </div>

            <div className="space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
              <h3 className="font-bold text-slate-900 text-sm">
                I. TỔNG QUAN KIẾN THỨC VÀ NGUYÊN LÝ TRỌNG TÂM
              </h3>
              <p>
                Tài liệu này hệ thống hóa các định lý, công thức và phương pháp giải nhanh cho các dạng bài toán tiêu biểu. Học sinh cần nắm vững lý thuyết nền tảng trước khi áp dụng giải các bài tập nâng cao.
              </p>

              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 space-y-2 text-xs">
                <strong className="text-blue-900 block font-bold">Quy tắc ghi nhớ nhanh:</strong>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  <li>Xác định đúng tập xác định và điều kiện biên của bài toán.</li>
                  <li>Áp dụng định lý biến thiên hàm số và xét dấu đạo hàm cấp một.</li>
                  <li>Kiểm tra lại giá trị cực trị và lập bảng đối soát.</li>
                </ul>
              </div>

              <h3 className="font-bold text-slate-900 text-sm pt-2">
                II. CÁC BƯỚC THỰC HÀNH VÀ VÍ DỤ MINH HỌA
              </h3>
              <p>
                Bước 1: Phân tích giả thiết và tóm tắt dữ liệu đầu vào.
              </p>
              <p>
                Bước 2: Lập phương trình / hệ phương trình đặc trưng và rút gọn hệ số.
              </p>
              <p>
                Bước 3: Sử dụng phương pháp loại trừ hoặc biến đổi tương đương để tìm nghiệm chính xác.
              </p>
            </div>
          </div>
        </div>

        {/* Thanh công cụ xem trang và phóng to / thu nhỏ */}
        <footer className="h-14 px-5 bg-slate-50 dark:bg-[#1d1f2a] border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Trang {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(70, z - 10))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              title="Thu nhỏ"
            >
              <ZoomOut size={16} />
            </button>
            <span className="font-mono text-slate-600 dark:text-slate-400 w-12 text-center">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              title="Phóng to"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface LecturePlayerModalProps {
  open: boolean;
  onClose: () => void;
  lecture: LecturePlayerData | null;
}

/** Component Modal xem trước bài giảng video trực tiếp và hỗ trợ tải về máy */
export function LecturePlayerModal({ open, onClose, lecture }: LecturePlayerModalProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(25);

  if (!open || !lecture) return null;

  /** Tải tệp video của bài giảng về thiết bị người dùng. */
  const handleDownload = () => {
    triggerFileDownload(`${lecture.title}.mp4`);
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-5 select-none">
      <div className="relative flex flex-col w-full max-w-5xl h-[92vh] rounded-2xl bg-black border border-slate-800 shadow-2xl overflow-hidden text-white">
        {/* Header video player */}
        <header className="flex items-center justify-between px-5 py-3.5 bg-[#171821] border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-lg bg-purple-950/80 border border-purple-800/60 text-purple-300 text-xs font-bold uppercase">
              {lecture.quality || "HD 1080p"}
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                {lecture.title}
              </h2>
              <p className="text-xs text-slate-400">
                GV: {lecture.instructor || "Thầy Nguyễn Văn Nam"} · Thời lượng: {lecture.duration || "45 phút"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} />
              <span>Tải về</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="size-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white grid place-items-center transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Trình phát video giả lập */}
        <div className="flex-1 flex flex-col items-center justify-center relative bg-gradient-to-b from-[#111219] to-[#08090d] p-6">
          <div className="w-full max-w-3xl aspect-video rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
            {/* Hình nền phát video */}
            <div className="text-center space-y-3 p-6">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="size-16 rounded-full bg-purple-600 hover:bg-purple-700 text-white grid place-items-center mx-auto shadow-lg transition-transform hover:scale-105 cursor-pointer"
              >
                {isPlaying ? <span className="font-bold text-lg">❚❚</span> : <Play size={26} className="ml-1" />}
              </button>
              <h3 className="text-base font-bold text-white">
                {lecture.title}
              </h3>
              <p className="text-xs text-slate-400">
                Đang phát ở độ phân giải 1080p · Giảng viên {lecture.instructor || "Thầy Nguyễn Văn Nam"}
              </p>
            </div>

            {/* Thanh điều khiển video dưới khung phát */}
            <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 to-transparent space-y-2">
              {/* Thanh tiến trình */}
              <input
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />

              <div className="flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsPlaying((p) => !p)}
                    className="hover:text-white cursor-pointer"
                  >
                    {isPlaying ? "Tạm dừng" : "Phát"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    className="hover:text-white cursor-pointer"
                  >
                    {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <span className="font-mono text-[11px] text-slate-400">12:30 / 45:00</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-purple-400">
                    1080p 60fps
                  </span>
                  <span className="hover:text-white cursor-pointer">1.0x</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
