"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  FileText,
  Video,
  Folder,
  MessageSquare,
  Users,
  Search,
  ArrowUpDown,
  Play,
  Download,
  Eye,
  CheckCircle2,
  Clock,
  Sparkles,
  MessageCircle,
  X,
  ThumbsUp,
  Share2,
  Send,
  Image as ImageIcon,
  MoreHorizontal,
  ChevronDown,
  LayoutGrid,
  List,
} from "lucide-react";
import type { LearningClass, Course } from "@/lib/learning-types";
import { ExamTakingModal, type ExamTakingData } from "./exam-taking-modal";

interface LearnerClassWorkspaceProps {
  item: LearningClass;
  course: Course | null;
  teacherName?: string;
  onBack?: () => void;
}

type SubTab = "feed" | "schedule" | "members" | "assignments" | "lectures" | "materials";

interface PostComment {
  id: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  createdAt: string;
  isAnonymous?: boolean;
}

interface ClassPost {
  id: string;
  authorName: string;
  authorAvatar?: string;
  authorRole: string;
  createdAt: string;
  content: string;
  images?: string[];
  likes: number;
  isLiked?: boolean;
  comments: PostComment[];
}

interface AssignmentItem {
  id: string;
  title: string;
  type: "EXAM" | "ESSAY";
  durationMinutes: number;
  dueAt: string;
  status: "PENDING" | "SUBMITTED" | "GRADED";
  score?: number;
  totalQuestions?: number;
}

interface LectureItem {
  id: string;
  title: string;
  fileType: "mp4" | "mp3" | "pptx";
  duration: string;
  teacher: string;
  uploadedAt: string;
}

interface MaterialItem {
  id: string;
  title: string;
  fileType: "pdf" | "doc" | "word" | "xlsx";
  size: string;
  uploadedAt: string;
}

/** Component Không gian Chi tiết Lớp học dành cho Học sinh theo phong cách SHub Classroom */
export function LearnerClassWorkspace({
  item,
  course,
  teacherName = "Wind Fall",
  onBack,
}: LearnerClassWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SubTab>("feed");

  // State cho Bảng tin lớp học
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostImages, setNewPostImages] = useState<string[]>([]);
  const [selectedPostForModal, setSelectedPostForModal] = useState<ClassPost | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [modalCommentText, setModalCommentText] = useState("");

  const [posts, setPosts] = useState<ClassPost[]>([
    {
      id: "post-1",
      authorName: teacherName,
      authorAvatar: "WF",
      authorRole: "Giáo viên",
      createdAt: "15 phút trước",
      content:
        "Chào cả lớp, Thầy đã cập nhật đề cương ôn tập và bài kiểm tra 15 phút tuần này lên mục Bài tập. Các em lưu ý hoàn thành trước 22:00 Chủ nhật nhé. Nếu có thắc mắc bài nào thì cứ bình luận ngay bên dưới để cùng trao đổi!",
      images: [
        "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&auto=format&fit=crop&q=60",
        "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800&auto=format&fit=crop&q=60",
        "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=800&auto=format&fit=crop&q=60",
      ],
      likes: 12,
      isLiked: false,
      comments: [
        {
          id: "cmt-1",
          authorName: "Vũ Thành Nam",
          authorAvatar: "TN",
          content: "Dạ vâng Thầy ơi, đề kiểm tra có tính điểm vào hệ số 1 không ạ?",
          createdAt: "10 phút trước",
        },
        {
          id: "cmt-2",
          authorName: teacherName,
          authorAvatar: "WF",
          content: "Có em nhé, bài này lấy điểm rèn luyện thường xuyên.",
          createdAt: "5 phút trước",
        },
      ],
    },
    {
      id: "post-2",
      authorName: "Trần Minh Anh",
      authorAvatar: "MA",
      authorRole: "Học sinh",
      createdAt: "2 giờ trước",
      content:
        "Mọi người ơi cho mình hỏi ở bài tập số 3 phần bài tập về nhà môn Toán có bạn nào ra kết quả x = 5 không ạ? Mình giải mãi mà đang bị vướng chỗ điều kiện xác định của hàm số phân thức bậc nhất.",
      images: [
        "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&auto=format&fit=crop&q=60",
      ],
      likes: 5,
      isLiked: true,
      comments: [
        {
          id: "cmt-3",
          authorName: "Nguyễn Hoàng Long",
          authorAvatar: "HL",
          content: "Đúng rồi bạn nhé, x = 5 thỏa mãn điều kiện x > 2.",
          createdAt: "1 giờ trước",
        },
      ],
    },
  ]);

  // State cho Lịch học: Dạng Tuần (Lưới) hoặc Dạng Tháng (Danh sách)
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");

  // State cho Bài tập & Kiểm tra
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentSort, setAssignmentSort] = useState<"alpha" | "newest" | "due">("alpha");
  const [activeExamForTaking, setActiveExamForTaking] = useState<ExamTakingData | null>(null);

  const assignmentsList: AssignmentItem[] = useMemo(
    () => [
      {
        id: "exam-1",
        title: "Kiểm tra 15 phút: Hàm số và Đồ thị nâng cao",
        type: "EXAM",
        durationMinutes: 15,
        dueAt: "2026-10-30T22:00:00Z",
        status: "PENDING",
        totalQuestions: 10,
      },
      {
        id: "exam-2",
        title: "Bài tập rèn luyện: Phương trình lượng giác cơ bản",
        type: "EXAM",
        durationMinutes: 30,
        dueAt: "2026-11-02T23:59:00Z",
        status: "PENDING",
        totalQuestions: 15,
      },
      {
        id: "essay-1",
        title: "Bài tập tự luận chuyên đề 3: Khảo sát sự biến thiên",
        type: "ESSAY",
        durationMinutes: 45,
        dueAt: "2026-11-05T18:00:00Z",
        status: "PENDING",
        totalQuestions: 4,
      },
      {
        id: "exam-3",
        title: "Đề thi thử giữa kỳ 1: Tổ hợp và Xác suất toán học",
        type: "EXAM",
        durationMinutes: 45,
        dueAt: "2026-11-15T20:00:00Z",
        status: "PENDING",
        totalQuestions: 25,
      },
    ],
    [],
  );

  // State cho Bài giảng
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureSort, setLectureSort] = useState<"alpha" | "newest" | "type">("alpha");

  const lecturesList: LectureItem[] = useMemo(
    () => [
      {
        id: "lec-1",
        title: "Bài giảng 01: Đại cương về Hàm số bậc nhất và bậc hai",
        fileType: "mp4",
        duration: "45 phút",
        teacher: teacherName,
        uploadedAt: "2026-10-20",
      },
      {
        id: "lec-2",
        title: "Bài giảng 02: Kỹ thuật phân tích đồ thị và tương giao hàm số",
        fileType: "mp4",
        duration: "52 phút",
        teacher: teacherName,
        uploadedAt: "2026-10-22",
      },
      {
        id: "lec-3",
        title: "Audio Podcast: Tóm tắt lý thuyết và các lỗi sai thường gặp",
        fileType: "mp3",
        duration: "25 phút",
        teacher: teacherName,
        uploadedAt: "2026-10-24",
      },
      {
        id: "lec-4",
        title: "Slide bài giảng chuyên đề: Phương pháp tọa độ trong mặt phẳng",
        fileType: "pptx",
        duration: "35 trang",
        teacher: teacherName,
        uploadedAt: "2026-10-25",
      },
    ],
    [teacherName],
  );

  // State cho Tài liệu
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialSort, setMaterialSort] = useState<"alpha" | "newest" | "type">("alpha");

  const materialsList: MaterialItem[] = useMemo(
    () => [
      {
        id: "mat-1",
        title: "Đề cương ôn tập kiểm tra giữa học kỳ 1 Toán học",
        fileType: "pdf",
        size: "3.2 MB",
        uploadedAt: "2026-10-18",
      },
      {
        id: "mat-2",
        title: "Tuyển tập 100 câu hỏi trắc nghiệm chuyên đề Hàm số",
        fileType: "doc",
        size: "1.8 MB",
        uploadedAt: "2026-10-21",
      },
      {
        id: "mat-3",
        title: "Bảng tra cứu công thức lượng giác và đạo hàm toàn diện",
        fileType: "pdf",
        size: "850 KB",
        uploadedAt: "2026-10-23",
      },
      {
        id: "mat-4",
        title: "File biểu đồ phân tích số liệu và bài tập thực hành",
        fileType: "xlsx",
        size: "520 KB",
        uploadedAt: "2026-10-24",
      },
    ],
    [],
  );

  // Danh sách thành viên lớp học
  const membersList = useMemo(
    () => [
      {
        id: "teacher-1",
        name: teacherName,
        role: "Giáo viên",
        email: "giaovien@windedu.vn",
        isTeacher: true,
      },
      {
        id: "learner-1",
        name: "Vũ Thành Nam",
        role: "Học sinh",
        email: "nam.vu@student.windedu.vn",
        isTeacher: false,
      },
      {
        id: "learner-2",
        name: "Trần Minh Anh",
        role: "Học sinh",
        email: "minhanh.tran@student.windedu.vn",
        isTeacher: false,
      },
      {
        id: "learner-3",
        name: "Nguyễn Hoàng Long",
        role: "Học sinh",
        email: "long.nguyen@student.windedu.vn",
        isTeacher: false,
      },
      {
        id: "learner-4",
        name: "Lê Thị Bích Ngọc",
        role: "Học sinh",
        email: "bichngoc.le@student.windedu.vn",
        isTeacher: false,
      },
    ],
    [teacherName],
  );

  /** Kích hoạt mở Chat Mini Size trực tiếp với một thành viên */
  const handleOpenChatWithMember = (member: { id: string; name: string; role: string }) => {
    window.dispatchEvent(
      new CustomEvent("open-mini-chat", {
        detail: {
          id: member.id,
          name: member.name,
          role: member.role === "Giáo viên" ? "INSTRUCTOR" : "LEARNER",
        },
      }),
    );
  };

  /** Đăng bài viết mới vào bảng tin lớp học kèm tối đa 5 ảnh */
  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostContent.trim() && newPostImages.length === 0) return;

    const newPost: ClassPost = {
      id: `post-${Date.now()}`,
      authorName: "Vũ Thành Nam",
      authorAvatar: "TN",
      authorRole: "Học sinh",
      createdAt: "Vừa xong",
      content: newPostContent.trim(),
      images: newPostImages.length > 0 ? [...newPostImages] : undefined,
      likes: 0,
      isLiked: false,
      comments: [],
    };

    setPosts([newPost, ...posts]);
    setNewPostContent("");
    setNewPostImages([]);
  };

  /** Thêm ảnh mẫu khi người dùng nhấn nút đính kèm ảnh */
  const handleAddSampleImage = () => {
    if (newPostImages.length >= 5) {
      alert("Chỉ được đính kèm tối đa 5 hình ảnh trong một bài viết.");
      return;
    }
    const sampleUrls = [
      "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&auto=format&fit=crop&q=60",
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800&auto=format&fit=crop&q=60",
      "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=800&auto=format&fit=crop&q=60",
      "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&auto=format&fit=crop&q=60",
    ];
    const nextImg = sampleUrls[newPostImages.length % sampleUrls.length];
    setNewPostImages([...newPostImages, nextImg]);
  };

  /** Thêm bình luận vào bài viết trong Modal nổi kiểu Facebook */
  const handleAddModalComment = () => {
    if (!selectedPostForModal || !modalCommentText.trim()) return;

    const newCmt: PostComment = {
      id: `cmt-${Date.now()}`,
      authorName: "Vũ Thành Nam",
      authorAvatar: "TN",
      content: modalCommentText.trim(),
      createdAt: "Vừa xong",
    };

    const updatedPosts = posts.map((p) => {
      if (p.id === selectedPostForModal.id) {
        return {
          ...p,
          comments: [...p.comments, newCmt],
        };
      }
      return p;
    });

    setPosts(updatedPosts);
    setSelectedPostForModal({
      ...selectedPostForModal,
      comments: [...selectedPostForModal.comments, newCmt],
    });
    setModalCommentText("");
  };

  /** Bật/tắt trạng thái Like của một bài viết */
  const handleToggleLike = (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const isLiked = !p.isLiked;
          return {
            ...p,
            isLiked,
            likes: isLiked ? p.likes + 1 : Math.max(0, p.likes - 1),
          };
        }
        return p;
      }),
    );
  };

  // Lọc và sắp xếp Bài tập
  const filteredAssignments = useMemo(() => {
    let result = [...assignmentsList];
    if (assignmentSearch.trim()) {
      const q = assignmentSearch.toLowerCase().trim();
      result = result.filter((item) => item.title.toLowerCase().includes(q));
    }
    if (assignmentSort === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (assignmentSort === "newest") {
      result.sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());
    } else if (assignmentSort === "due") {
      result.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    }
    return result;
  }, [assignmentsList, assignmentSearch, assignmentSort]);

  // Lọc và sắp xếp Bài giảng
  const filteredLectures = useMemo(() => {
    let result = [...lecturesList];
    if (lectureSearch.trim()) {
      const q = lectureSearch.toLowerCase().trim();
      result = result.filter((item) => item.title.toLowerCase().includes(q));
    }
    if (lectureSort === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lectureSort === "type") {
      result.sort((a, b) => a.fileType.localeCompare(b.fileType));
    } else if (lectureSort === "newest") {
      result.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
    return result;
  }, [lecturesList, lectureSearch, lectureSort]);

  // Lọc và sắp xếp Tài liệu
  const filteredMaterials = useMemo(() => {
    let result = [...materialsList];
    if (materialSearch.trim()) {
      const q = materialSearch.toLowerCase().trim();
      result = result.filter((item) => item.title.toLowerCase().includes(q));
    }
    if (materialSort === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (materialSort === "type") {
      result.sort((a, b) => a.fileType.localeCompare(b.fileType));
    } else if (materialSort === "newest") {
      result.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
    return result;
  }, [materialsList, materialSearch, materialSort]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      {/* KHUNG BỐ CỤC LỚP HỌC 2 CỘT PHONG CÁCH SHUB */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* CỘT DỌC BÊN TRÁI: SIDEBAR LỚP HỌC (THEO ĐÚNG ẢNH 3 CỦA NGƯỜI DÙNG) */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
            {/* Nút quay lại danh sách lớp */}
            <button
              type="button"
              onClick={onBack || (() => router.push("/courses"))}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors mb-3"
            >
              <ArrowLeft size={14} />
              <span>Quay lại danh sách lớp</span>
            </button>

            {/* Thông tin lớp học */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3.5 mb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                {item.name || item.code}
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code}</strong>
              </p>

              <div className="mt-3 flex items-center gap-2">
                <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 grid place-items-center text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">
                  {teacherName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Giáo viên</span>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    {teacherName}
                  </p>
                </div>
              </div>
            </div>

            {/* Danh mục 6 chức năng con */}
            <nav className="space-y-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
                Danh mục
              </p>
              {[
                { id: "feed" as const, label: "Bảng tin", icon: MessageSquare },
                { id: "schedule" as const, label: "Lịch học", icon: CalendarDays },
                { id: "members" as const, label: "Thành viên", icon: Users },
                { id: "assignments" as const, label: "Bài tập", icon: FileText },
                { id: "lectures" as const, label: "Bài giảng", icon: Video },
                { id: "materials" as const, label: "Tài liệu", icon: Folder },
              ].map(({ id, label, icon: Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                      active
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-blue-600 dark:text-blue-400" : "text-slate-400"} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* CỘT NỘI DUNG CHÍNH BÊN PHẢI (THEO TỪNG TAB CON) */}
        <main className="lg:col-span-9 space-y-5">
          {/* ================= TAB 1: BẢNG TIN LỚP HỌC (FACEBOOK STYLE) ================= */}
          {activeTab === "feed" && (
            <div className="space-y-4">
              {/* Form đăng bài tối giản có đính kèm ảnh (tối đa 5 ảnh) */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-full bg-blue-600 grid place-items-center text-white text-xs font-bold shrink-0">
                    TN
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newPostContent}
                      onChange={(e) => setNewPostContent(e.target.value)}
                      placeholder="Chia sẻ bài viết, câu hỏi hoặc tài liệu với lớp học..."
                      rows={2}
                      className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 resize-none"
                    />
                  </div>
                </div>

                {/* Danh sách ảnh đính kèm xem trước */}
                {newPostImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {newPostImages.map((imgUrl, i) => (
                      <div key={i} className="relative size-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 group">
                        <img src={imgUrl} alt={`Ảnh đính kèm ${i + 1}`} className="size-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setNewPostImages(newPostImages.filter((_, idx) => idx !== i))}
                          className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {newPostImages.length < 5 && (
                      <button
                        type="button"
                        onClick={handleAddSampleImage}
                        className="size-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400 hover:text-blue-500 text-[10px]"
                      >
                        <span>+ Thêm ảnh</span>
                        <span>({newPostImages.length}/5)</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={handleAddSampleImage}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <ImageIcon size={15} className="text-emerald-500" />
                    <span>Đính kèm ảnh ({newPostImages.length}/5)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCreatePost}
                    disabled={!newPostContent.trim() && newPostImages.length === 0}
                    className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-40"
                  >
                    Đăng bài
                  </button>
                </div>
              </div>

              {/* Danh sách các bài đăng trong lớp */}
              <div className="space-y-4">
                {posts.map((post) => {
                  const isExpanded = Boolean(expandedPostIds[post.id]);
                  const isLongText = post.content.length > 180;
                  const displayContent = isLongText && !isExpanded
                    ? `${post.content.slice(0, 180)}...`
                    : post.content;

                  return (
                    <article
                      key={post.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs space-y-3"
                    >
                      {/* Header bài viết */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="size-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 grid place-items-center text-white text-xs font-bold">
                            {post.authorAvatar || post.authorName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <strong className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                {post.authorName}
                              </strong>
                              <span className="px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                {post.authorRole}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">{post.createdAt}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedPostForModal(post)}
                          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      {/* Nội dung text bài viết */}
                      <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                        <p>{displayContent}</p>
                        {isLongText && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPostIds({
                                ...expandedPostIds,
                                [post.id]: !isExpanded,
                              })
                            }
                            className="text-xs font-bold text-blue-600 hover:underline mt-1"
                          >
                            {isExpanded ? "Ẩn bớt" : "Xem thêm"}
                          </button>
                        )}
                      </div>

                      {/* Hình ảnh bài viết: Tối đa 2 ảnh ngoài feed, ảnh 2 có +X nếu còn ảnh */}
                      {post.images && post.images.length > 0 && (
                        <div
                          onClick={() => setSelectedPostForModal(post)}
                          className={`grid gap-2 cursor-pointer rounded-xl overflow-hidden ${
                            post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"
                          }`}
                        >
                          <div className="h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100">
                            <img
                              src={post.images[0]}
                              alt="Ảnh bài đăng"
                              className="size-full object-cover hover:scale-102 transition-transform duration-200"
                            />
                          </div>

                          {post.images.length >= 2 && (
                            <div className="relative h-56 sm:h-64 overflow-hidden rounded-xl bg-slate-100">
                              <img
                                src={post.images[1]}
                                alt="Ảnh bài đăng 2"
                                className="size-full object-cover hover:scale-102 transition-transform duration-200"
                              />
                              {post.images.length > 2 && (
                                <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white text-2xl font-bold">
                                  +{post.images.length - 2}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Thống kê và Nút tương tác Like / Comment */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                        <div className="flex items-center gap-1">
                          <span className="size-4 rounded-full bg-blue-600 grid place-items-center text-white text-[9px]">
                            👍
                          </span>
                          <span>{post.likes}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedPostForModal(post)}
                          className="hover:underline"
                        >
                          {post.comments.length} bình luận
                        </button>
                      </div>

                      <div className="pt-1 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
                        <button
                          type="button"
                          onClick={() => handleToggleLike(post.id)}
                          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                            post.isLiked ? "text-blue-600 dark:text-blue-400" : ""
                          }`}
                        >
                          <ThumbsUp size={15} fill={post.isLiked ? "currentColor" : "none"} />
                          <span>Thích</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedPostForModal(post)}
                          className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <MessageCircle size={15} />
                          <span>Bình luận</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= TAB 2: LỊCH HỌC LỚP NÀY (DẠNG TUẦN & DẠNG THÁNG) ================= */}
          {activeTab === "schedule" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Lịch học của {item.name || item.code}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Theo dõi các ca học và thời khóa biểu của lớp học.
                  </p>
                </div>

                {/* Nút chuyển đổi: Dạng tuần (Lưới) & Dạng tháng (Danh sách) */}
                <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setScheduleView("week")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      scheduleView === "week"
                        ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    <LayoutGrid size={14} />
                    <span>Dạng tuần (Lưới)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleView("month")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      scheduleView === "month"
                        ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    <List size={14} />
                    <span>Dạng tháng (Danh sách)</span>
                  </button>
                </div>
              </div>

              {scheduleView === "week" ? (
                /* CHẾ ĐỘ DẠNG TUẦN: HIỂN THỊ DẠNG LƯỚI */
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2">
                  {[
                    { day: "Thứ 2", date: "26/10", hasClass: true, time: "19:30 - 21:00", title: "Phương trình lượng giác" },
                    { day: "Thứ 3", date: "27/10", hasClass: false },
                    { day: "Thứ 4", date: "28/10", hasClass: true, time: "19:30 - 21:00", title: "Hình học không gian" },
                    { day: "Thứ 5", date: "29/10", hasClass: false },
                    { day: "Thứ 6", date: "30/10", hasClass: true, time: "19:30 - 21:00", title: "Ôn tập và Kiểm tra 15p" },
                    { day: "Thứ 7", date: "31/10", hasClass: false },
                    { day: "Chủ nhật", date: "01/11", hasClass: false },
                  ].map((col, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border flex flex-col justify-between min-h-36 ${
                        col.hasClass
                          ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60"
                          : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-1.5 mb-2">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{col.day}</span>
                          <span className="text-[10px] text-slate-400">{col.date}</span>
                        </div>

                        {col.hasClass ? (
                          <div className="space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold block w-fit">
                              Trực tuyến
                            </span>
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                              {col.title}
                            </p>
                            <p className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock size={11} /> {col.time}
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic pt-4 text-center">Nghỉ</p>
                        )}
                      </div>

                      {col.hasClass && (
                        <button
                          type="button"
                          onClick={() => router.push("/live-classes")}
                          className="w-full mt-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors"
                        >
                          Vào phòng
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* CHẾ ĐỘ DẠNG THÁNG: HIỂN THỊ DẠNG DANH SÁCH */
                <div className="space-y-3 pt-2">
                  {[
                    { date: "26/10/2026", time: "19:30 - 21:00", title: "Buổi 01: Đại số - Phương trình lượng giác nâng cao", status: "Hôm nay" },
                    { date: "28/10/2026", time: "19:30 - 21:00", title: "Buổi 02: Hình học - Vị trí tương đối và quan hệ vuông góc", status: "Sắp diễn ra" },
                    { date: "30/10/2026", time: "19:30 - 21:00", title: "Buổi 03: Chữa bài tập và Làm bài kiểm tra 15 phút", status: "Sắp diễn ra" },
                    { date: "02/11/2026", time: "19:30 - 21:00", title: "Buổi 04: Giải tích - Đạo hàm và ứng dụng thực tiễn", status: "Sắp diễn ra" },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.status === "Hôm nay"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                          }`}>
                            {row.status}
                          </span>
                          <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                            {row.title}
                          </strong>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-2">
                          <span>Ngày: {row.date}</span>
                          <span>·</span>
                          <span>Thời gian: {row.time}</span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => router.push("/live-classes")}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shrink-0"
                      >
                        <Play size={13} />
                        <span>Vào phòng học</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 3: THÀNH VIÊN (KÈM NÚT CHAT CẠNH TỪNG NGƯỜI) ================= */}
          {activeTab === "members" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Thành viên lớp ({membersList.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Danh sách giáo viên phụ trách và học sinh trong lớp. Nhấn nút Nhắn tin để trò chuyện trực tiếp.
                </p>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {membersList.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`size-10 rounded-full grid place-items-center text-xs font-bold text-white shrink-0 ${
                        member.isTeacher
                          ? "bg-gradient-to-tr from-purple-600 to-indigo-600"
                          : "bg-gradient-to-tr from-blue-600 to-cyan-500"
                      }`}>
                        {member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {member.name}
                          </strong>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            member.isTeacher
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}>
                            {member.role}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">{member.email}</p>
                      </div>
                    </div>

                    {/* NÚT CHAT CẠNH TỪNG NGƯỜI ĐỂ MỞ MINI CHAT */}
                    <button
                      type="button"
                      onClick={() => handleOpenChatWithMember(member)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                      title={`Nhắn tin với ${member.name}`}
                    >
                      <MessageCircle size={14} />
                      <span className="hidden sm:inline">Nhắn tin</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= TAB 4: BÀI TẬP & ĐỀ KIỂM TRA ================= */}
          {activeTab === "assignments" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài tập & Đề thi
                  </h3>
                  <p className="text-xs text-slate-500">
                    Danh sách các bài rèn luyện và bài kiểm tra có bấm giờ.
                  </p>
                </div>

                {/* THANH TÌM KIẾM VÀ THANH SẮP XẾP */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={assignmentSearch}
                      onChange={(e) => setAssignmentSearch(e.target.value)}
                      placeholder="Tìm kiếm bài tập..."
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={assignmentSort}
                    onChange={(e) => setAssignmentSort(e.target.value as any)}
                    className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="alpha">Tên A-Z (Mặc định)</option>
                    <option value="newest">Mới nhất</option>
                    <option value="due">Hạn nộp gần nhất</option>
                  </select>
                </div>
              </div>

              {/* Danh sách bài tập */}
              <div className="space-y-3">
                {filteredAssignments.map((assign) => (
                  <div
                    key={assign.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          assign.type === "EXAM"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                        }`}>
                          {assign.type === "EXAM" ? "Trắc nghiệm bấm giờ" : "Bài tập tự luận"}
                        </span>
                        <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                          {assign.title}
                        </strong>
                      </div>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <Clock size={12} />
                        <span>Thời lượng: {assign.durationMinutes} phút</span>
                        <span>·</span>
                        <span>Hạn nộp: {new Date(assign.dueAt).toLocaleDateString()}</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setActiveExamForTaking({
                          id: assign.id,
                          title: assign.title,
                          durationMinutes: assign.durationMinutes,
                          totalQuestions: assign.totalQuestions || 10,
                        })
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors shrink-0 cursor-pointer"
                    >
                      <Play size={14} />
                      <span>Làm bài</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= TAB 5: BÀI GIẢNG ================= */}
          {activeTab === "lectures" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài giảng lớp học
                  </h3>
                  <p className="text-xs text-slate-500">
                    Video bài học chuyên đề, slide trình chiếu và audio ghi âm.
                  </p>
                </div>

                {/* THANH TÌM KIẾM VÀ THANH SẮP XẾP */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={lectureSearch}
                      onChange={(e) => setLectureSearch(e.target.value)}
                      placeholder="Tìm kiếm bài giảng..."
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={lectureSort}
                    onChange={(e) => setLectureSort(e.target.value as any)}
                    className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="alpha">Tên A-Z (Mặc định)</option>
                    <option value="type">Loại tệp (mp4, mp3, pptx)</option>
                    <option value="newest">Mới nhất</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {filteredLectures.map((lec) => (
                  <div
                    key={lec.id}
                    className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 text-[10px] font-bold uppercase">
                          {lec.fileType} · {lec.duration}
                        </span>
                        <span className="text-[10px] text-slate-400">{lec.uploadedAt}</span>
                      </div>
                      <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block line-clamp-2">
                        {lec.title}
                      </strong>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400">GV: {lec.teacher}</span>
                      <button
                        type="button"
                        onClick={() => alert(`Đang mở xem bài giảng: ${lec.title}`)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        <Play size={12} />
                        <span>Xem bài giảng</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= TAB 6: TÀI LIỆU (THEO ĐÚNG ẢNH 3 CỦA NGƯỜI DÙNG) ================= */}
          {activeTab === "materials" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Tài liệu
                  </h3>
                  <p className="text-xs text-slate-500">
                    Học liệu số, giáo trình và tài liệu tham khảo của lớp.
                  </p>
                </div>

                {/* THANH TÌM KIẾM VÀ THANH SẮP XẾP ĐÚNG THEO ẢNH 3 */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={materialSearch}
                      onChange={(e) => setMaterialSearch(e.target.value)}
                      placeholder="Tìm kiếm..."
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={materialSort}
                    onChange={(e) => setMaterialSort(e.target.value as any)}
                    className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="alpha">Sắp xếp... (A-Z mặc định)</option>
                    <option value="type">Theo loại tệp (PDF, Word, Excel)</option>
                    <option value="newest">Thời gian mới nhất</option>
                  </select>
                </div>
              </div>

              {filteredMaterials.length === 0 ? (
                /* GIAO DIỆN KHI CHƯA CÓ TÀI LIỆU THEO ĐÚNG ẢNH 3 */
                <div className="py-16 text-center space-y-2">
                  <div className="size-20 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-500 grid place-items-center mx-auto mb-3">
                    <Folder size={36} />
                  </div>
                  <strong className="text-sm font-bold text-slate-800 dark:text-slate-200 block">
                    Chưa có tài liệu nào trong lớp này
                  </strong>
                  <p className="text-xs text-slate-400">
                    Giáo viên sẽ đưa học liệu lên lớp học.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredMaterials.map((mat) => (
                    <div
                      key={mat.id}
                      className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            mat.fileType === "pdf"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          }`}>
                            {mat.fileType} · {mat.size}
                          </span>
                          <span className="text-[10px] text-slate-400">{mat.uploadedAt}</span>
                        </div>
                        <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block line-clamp-2">
                          {mat.title}
                        </strong>
                      </div>

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => alert(`Đang tải tài liệu: ${mat.title}`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors"
                        >
                          <Download size={12} />
                          <span>Tải xuống</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ================= MODAL BÀI VIẾT NỔI GIỐNG FACEBOOK (THEO ĐÚNG ẢNH 2 CỦA NGƯỜI DÙNG) ================= */}
      {selectedPostForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-5">
          <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl bg-[#1c1d22] border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            {/* Header Modal */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#26272e] border-b border-slate-700/80">
              <div className="w-8" />
              <h3 className="text-sm sm:text-base font-bold text-white text-center">
                Bài viết của {selectedPostForModal.authorName}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedPostForModal(null)}
                className="size-8 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Nội dung chi tiết bài viết và danh sách bình luận */}
            <div className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4">
              {/* Tác giả */}
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 grid place-items-center text-white text-xs font-bold">
                  {selectedPostForModal.authorAvatar || selectedPostForModal.authorName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <strong className="text-sm font-bold text-white">
                      {selectedPostForModal.authorName}
                    </strong>
                    <span className="text-slate-400 text-xs">trong {item.name || item.code}</span>
                  </div>
                  <span className="text-[11px] text-slate-400">{selectedPostForModal.createdAt}</span>
                </div>
              </div>

              {/* Text bài viết */}
              <p className="text-sm text-slate-100 leading-relaxed font-normal">
                {selectedPostForModal.content}
              </p>

              {/* Toàn bộ hình ảnh trong modal bài viết nổi */}
              {selectedPostForModal.images && selectedPostForModal.images.length > 0 && (
                <div className="space-y-2">
                  {selectedPostForModal.images.map((img, idx) => (
                    <div key={idx} className="rounded-xl overflow-hidden border border-slate-700 bg-black/40">
                      <img src={img} alt={`Ảnh ${idx + 1}`} className="w-full max-h-96 object-contain" />
                    </div>
                  ))}
                </div>
              )}

              {/* Lượt tương tác */}
              <div className="pt-3 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-1">
                  <span>👍</span>
                  <span>{selectedPostForModal.likes}</span>
                </div>
                <span>{selectedPostForModal.comments.length} bình luận</span>
              </div>

              {/* Danh sách bình luận */}
              <div className="pt-2 border-t border-slate-700/80 space-y-3">
                <p className="text-xs font-bold text-slate-400">Bình luận phù hợp nhất</p>
                {selectedPostForModal.comments.map((cmt) => (
                  <div key={cmt.id} className="flex items-start gap-2.5">
                    <div className="size-8 rounded-full bg-slate-700 grid place-items-center text-xs font-bold text-white shrink-0">
                      {cmt.authorAvatar || cmt.authorName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="p-2.5 rounded-2xl bg-[#2a2b33] border border-slate-700/60 text-xs inline-block">
                        <strong className="font-bold text-white block mb-0.5">{cmt.authorName}</strong>
                        <p className="text-slate-200 leading-relaxed">{cmt.content}</p>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 pl-2">
                        <span>{cmt.createdAt}</span>
                        <button type="button" className="hover:underline font-bold text-slate-300">Thích</button>
                        <button type="button" className="hover:underline font-bold text-slate-300">Trả lời</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Thanh nhập bình luận dưới cùng */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddModalComment();
              }}
              className="p-3 bg-[#26272e] border-t border-slate-700 flex items-center gap-2"
            >
              <div className="size-8 rounded-full bg-blue-600 grid place-items-center text-white text-xs font-bold shrink-0">
                TN
              </div>
              <input
                type="text"
                value={modalCommentText}
                onChange={(e) => setModalCommentText(e.target.value)}
                placeholder="Viết câu trả lời..."
                className="flex-1 py-2 px-3 rounded-full bg-[#18191e] border border-slate-700 text-xs text-white placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!modalCommentText.trim()}
                className="p-2 rounded-full text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL LÀM BÀI KIỂM TRA (MODULE 5) ================= */}
      {activeExamForTaking && (
        <ExamTakingModal
          open={Boolean(activeExamForTaking)}
          onClose={() => setActiveExamForTaking(null)}
          exam={activeExamForTaking}
          onSubmitted={(result) => {
            alert(`Chúc mừng! Bạn đã hoàn thành bài thi với điểm số: ${result.score}/10`);
          }}
        />
      )}
    </div>
  );
}
