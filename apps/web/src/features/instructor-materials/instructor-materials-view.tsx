"use client";

import { useState, useMemo } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  Folder,
  FolderPlus,
  Grid,
  List as ListIcon,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { AssignmentBuilderModal } from "@/features/exams/assignment-builder-modal";

export interface MaterialFileItem {
  id: string;
  name: string;
  type: "word" | "pdf" | "image" | "folder";
  size: string;
  updatedAt: string;
  folderCategory?: string;
  isUnclassified?: boolean;
  tag?: string;
}

export interface ClassFolderItem {
  id: string;
  name: string;
  code: string;
  itemsCount: number;
  updatedAt: string;
  files: MaterialFileItem[];
}

export interface SubjectFolderItem {
  id: string;
  name: string;
  itemsCount: number;
  updatedAt: string;
  classes: ClassFolderItem[];
}

export interface GradeFolderItem {
  id: string;
  name: string; // "6", "7", "Đại học", v.v.
  label: string; // "Khối 6", "Khối 7", "Đại học"
  itemsCount: number;
  updatedAt: string;
  subjects: SubjectFolderItem[];
}

// Dữ liệu học liệu phân cấp hoàn chỉnh theo Khối -> Môn -> Lớp và các tệp bên trong
const INITIAL_GRADES_DATA: GradeFolderItem[] = [
  {
    id: "grade-6",
    name: "6",
    label: "Khối 6",
    itemsCount: 1,
    updatedAt: "26 tháng 10 lúc 17:45",
    subjects: [
      {
        id: "sub-6-toan",
        name: "Toán",
        itemsCount: 2,
        updatedAt: "26 tháng 10 lúc 17:45",
        classes: [
          {
            id: "cls-6A1",
            name: "Lớp 6A1",
            code: "TOAN-6A1",
            itemsCount: 3,
            updatedAt: "26 tháng 10 lúc 17:45",
            files: [
              {
                id: "f-1",
                name: "Test bài tập ôn tập số học chương 1.docx",
                type: "word",
                size: "1.4 MB",
                updatedAt: "26 tháng 10 lúc 17:45",
                tag: "Tách câu",
              },
              {
                id: "f-2",
                name: "Trac_nghiem_Toan_lop_6_Phep_cong_tru.docx",
                type: "word",
                size: "1.2 MB",
                updatedAt: "25 tháng 10 lúc 11:15",
                tag: "Tách câu",
              },
              {
                id: "f-3",
                name: "Phieu_bai_tap_hinh_hoc_truc_quan.pdf",
                type: "pdf",
                size: "2.8 MB",
                updatedAt: "24 tháng 10 lúc 09:30",
                tag: "Tự luận",
              },
            ],
          },
          {
            id: "cls-6A2",
            name: "Lớp 6A2",
            code: "TOAN-6A2",
            itemsCount: 2,
            updatedAt: "25 tháng 10 lúc 14:20",
            files: [
              {
                id: "f-4",
                name: "De_kiem_tra_15_phut_phan_so.docx",
                type: "word",
                size: "950 KB",
                updatedAt: "25 tháng 10 lúc 14:20",
                tag: "Tách câu",
              },
              {
                id: "f-5",
                name: "Bai_tap_tu_luan_hinh_chu_nhat.pdf",
                type: "pdf",
                size: "1.6 MB",
                updatedAt: "22 tháng 10 lúc 16:00",
                tag: "Tự luận",
              },
            ],
          },
        ],
      },
      {
        id: "sub-6-van",
        name: "Ngữ văn",
        itemsCount: 1,
        updatedAt: "25 tháng 10 lúc 10:20",
        classes: [
          {
            id: "cls-6A1-van",
            name: "Lớp 6A1",
            code: "VAN-6A1",
            itemsCount: 2,
            updatedAt: "25 tháng 10 lúc 10:20",
            files: [
              {
                id: "f-6",
                name: "De_kiem_tra_giua_ky_Ngu_van_6.docx",
                type: "word",
                size: "1.1 MB",
                updatedAt: "25 tháng 10 lúc 10:20",
                tag: "Tự luận",
              },
              {
                id: "f-7",
                name: "Tai_lieu_doc_hieu_van_ban_co_tich.pdf",
                type: "pdf",
                size: "3.2 MB",
                updatedAt: "23 tháng 10 lúc 15:40",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "grade-7",
    name: "7",
    label: "Khối 7",
    itemsCount: 0,
    updatedAt: "27 tháng 10 lúc 19:43",
    subjects: [
      {
        id: "sub-7-toan",
        name: "Toán",
        itemsCount: 1,
        updatedAt: "27 tháng 10 lúc 19:43",
        classes: [
          {
            id: "cls-7A1",
            name: "Lớp 7A1",
            code: "TOAN-7A1",
            itemsCount: 1,
            updatedAt: "27 tháng 10 lúc 19:43",
            files: [
              {
                id: "f-8",
                name: "Chuyen_de_so_huu_ti_va_so_thuc.docx",
                type: "word",
                size: "1.3 MB",
                updatedAt: "27 tháng 10 lúc 19:43",
                tag: "Tách câu",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "grade-daihoc",
    name: "Đại học",
    label: "Đại học",
    itemsCount: 0,
    updatedAt: "27 tháng 10 lúc 19:43",
    subjects: [],
  },
  {
    id: "grade-8",
    name: "8",
    label: "Khối 8",
    itemsCount: 2,
    updatedAt: "26 tháng 10 lúc 14:10",
    subjects: [],
  },
  {
    id: "grade-9",
    name: "9",
    label: "Khối 9",
    itemsCount: 3,
    updatedAt: "25 tháng 10 lúc 09:15",
    subjects: [],
  },
  {
    id: "grade-10",
    name: "10",
    label: "Khối 10",
    itemsCount: 4,
    updatedAt: "27 tháng 10 lúc 16:30",
    subjects: [
      {
        id: "sub-10-toan",
        name: "Toán",
        itemsCount: 2,
        updatedAt: "27 tháng 10 lúc 16:30",
        classes: [
          {
            id: "cls-10A1",
            name: "Lớp 10A1",
            code: "TOAN-10A1",
            itemsCount: 2,
            updatedAt: "27 tháng 10 lúc 16:30",
            files: [
              {
                id: "f-9",
                name: "Trac_nghiem_Menh_de_va_Tap_hop.docx",
                type: "word",
                size: "1.5 MB",
                updatedAt: "27 tháng 10 lúc 16:30",
                tag: "Tách câu",
              },
              {
                id: "f-10",
                name: "Bat_phuong_trinh_bac_hai_mot_an.pdf",
                type: "pdf",
                size: "2.0 MB",
                updatedAt: "26 tháng 10 lúc 10:00",
                tag: "Tự luận",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "grade-11",
    name: "11",
    label: "Khối 11",
    itemsCount: 1,
    updatedAt: "22 tháng 10 lúc 11:00",
    subjects: [],
  },
  {
    id: "grade-12",
    name: "12",
    label: "Khối 12",
    itemsCount: 5,
    updatedAt: "27 tháng 10 lúc 18:20",
    subjects: [],
  },
];

// Danh sách đề chưa phân loại ở cột trái (Ảnh 1)
const INITIAL_UNCLASSIFIED_EXAMS: MaterialFileItem[] = [
  {
    id: "unc-1",
    name: "Test bài tập",
    type: "word",
    size: "1.4 MB",
    updatedAt: "27 tháng 10 lúc 18:00",
    tag: "Tách câu",
  },
  {
    id: "unc-2",
    name: "Trac_nghiem_Toan_lop_4_...",
    type: "word",
    size: "1.8 MB",
    updatedAt: "26 tháng 10 lúc 15:30",
    tag: "Tách câu",
  },
];

// Giao diện học liệu chuẩn xác theo Ảnh 1 với phân cấp Khối -> Môn -> Lớp
export function InstructorMaterialsView() {
  const { notify } = useApp();
  const [gradesData, setGradesData] = useState<GradeFolderItem[]>(INITIAL_GRADES_DATA);
  const [unclassifiedExams, setUnclassifiedExams] = useState<MaterialFileItem[]>(INITIAL_UNCLASSIFIED_EXAMS);

  // Điều hướng phân cấp (Breadcrumb: Khối -> Môn -> Lớp)
  const [selectedGradeId, setSelectedGradeId] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  // Bộ lọc & Toggle UI
  const [showDetail, setShowDetail] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Modal tạo bài tập / đề thi
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [targetAssignmentClassName, setTargetAssignmentClassName] = useState("Lớp 6A1");

  // Modal tạo Khối / Môn / Lớp mới
  const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Tìm đối tượng đang được chọn trong cây thư mục
  const currentGrade = useMemo(() => {
    return gradesData.find((g) => g.id === selectedGradeId) || null;
  }, [gradesData, selectedGradeId]);

  const currentSubject = useMemo(() => {
    if (!currentGrade) return null;
    return currentGrade.subjects.find((s) => s.id === selectedSubjectId) || null;
  }, [currentGrade, selectedSubjectId]);

  const currentClass = useMemo(() => {
    if (!currentSubject) return null;
    return currentSubject.classes.find((c) => c.id === selectedClassId) || null;
  }, [currentSubject, selectedClassId]);

  // Xử lý tạo mới Khối / Môn / Lớp tùy theo vị trí đang đứng
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      notify("Vui lòng nhập tên thư mục!", "error");
      return;
    }

    if (!selectedGradeId) {
      // Đang ở cấp Khối: Tạo Khối mới
      const newGrade: GradeFolderItem = {
        id: `grade-${Date.now()}`,
        name: newFolderName.trim(),
        label: `Khối ${newFolderName.trim()}`,
        itemsCount: 0,
        updatedAt: "Vừa xong",
        subjects: [],
      };
      setGradesData([...gradesData, newGrade]);
      notify(`Đã tạo khối '${newFolderName}' thành công!`, "success");
    } else if (selectedGradeId && !selectedSubjectId) {
      // Đang ở cấp Môn: Tạo Môn mới cho Khối
      const newSubject: SubjectFolderItem = {
        id: `sub-${Date.now()}`,
        name: newFolderName.trim(),
        itemsCount: 0,
        updatedAt: "Vừa xong",
        classes: [],
      };
      setGradesData((prev) =>
        prev.map((g) =>
          g.id === selectedGradeId
            ? { ...g, subjects: [...g.subjects, newSubject], itemsCount: g.itemsCount + 1 }
            : g
        )
      );
      notify(`Đã tạo môn '${newFolderName}' cho ${currentGrade?.label}!`, "success");
    } else if (selectedSubjectId && !selectedClassId) {
      // Đang ở cấp Lớp: Tạo Lớp mới cho Môn
      const newClass: ClassFolderItem = {
        id: `cls-${Date.now()}`,
        name: newFolderName.trim().startsWith("Lớp") ? newFolderName.trim() : `Lớp ${newFolderName.trim()}`,
        code: `CLS-${Date.now().toString().slice(-4)}`,
        itemsCount: 0,
        updatedAt: "Vừa xong",
        files: [],
      };
      setGradesData((prev) =>
        prev.map((g) => {
          if (g.id !== selectedGradeId) return g;
          return {
            ...g,
            subjects: g.subjects.map((s) => {
              if (s.id !== selectedSubjectId) return s;
              return { ...s, classes: [...s.classes, newClass], itemsCount: s.itemsCount + 1 };
            }),
          };
        })
      );
      notify(`Đã tạo lớp '${newClass.name}' thành công!`, "success");
    }

    setNewFolderName("");
    setCreateFolderModalOpen(false);
  };

  // Nhận bài tập vừa tạo từ modal và đưa vào đúng Lớp
  const handleSaveCreatedAssignment = (data: any) => {
    const newFile: MaterialFileItem = {
      id: `file-${Date.now()}`,
      name: `${data.title}.${data.attachedFile ? "docx" : "docx"}`,
      type: "word",
      size: data.attachedFile?.size || "1.5 MB",
      updatedAt: "Vừa xong",
      tag: data.type === "MULTIPLE_CHOICE" ? "Tách câu" : "Tự luận",
    };

    if (selectedClassId && selectedSubjectId && selectedGradeId) {
      // Gán vào lớp đang mở
      setGradesData((prev) =>
        prev.map((g) => {
          if (g.id !== selectedGradeId) return g;
          return {
            ...g,
            subjects: g.subjects.map((s) => {
              if (s.id !== selectedSubjectId) return s;
              return {
                ...s,
                classes: s.classes.map((c) => {
                  if (c.id !== selectedClassId) return c;
                  return { ...c, files: [newFile, ...c.files], itemsCount: c.itemsCount + 1 };
                }),
              };
            }),
          };
        })
      );
    } else {
      // Thêm vào danh sách đề chưa phân loại ở cột trái
      setUnclassifiedExams([newFile, ...unclassifiedExams]);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-80px)] w-full bg-slate-50/50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100">
      {/* =========================================================================
          CỘT TRÁI: ĐỀ CHƯA PHÂN LOẠI (CHUẨN 100% ẢNH 1)
          ========================================================================= */}
      <aside className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 space-y-4">
        {/* Hàng Header: Đề chưa phân loại kèm badge đỏ tròn */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Đề chưa phân loại
            </h2>
            <span className="grid size-5 place-items-center rounded-full bg-rose-500 text-white text-[11px] font-extrabold shadow-2xs">
              {unclassifiedExams.length}
            </span>
          </div>
        </div>

        {/* Nút Mới nhất với icon sắp xếp */}
        <div>
          <button
            type="button"
            className="w-full py-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer"
          >
            <span>1=</span>
            <span>Mới nhất</span>
          </button>
        </div>

        {/* Switch: Hiển thị chi tiết học liệu */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            Hiển thị chi tiết học liệu
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showDetail}
              onChange={(e) => setShowDetail(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {/* Danh sách các thẻ đề chưa phân loại (Icon Word xanh W, tag Tách câu, nút :::) */}
        <div className="space-y-3 pt-2">
          {unclassifiedExams.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                setTargetAssignmentClassName("Kho học liệu");
                setAssignmentModalOpen(true);
              }}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-2xs space-y-2 hover:border-blue-400 transition cursor-pointer group"
            >
              {/* Dòng 1: Icon tag Học liệu và 6 chấm kéo thả */}
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-1 font-semibold text-slate-500">
                  <span>📍</span>
                  <span>Học liệu</span>
                </div>
                <span className="text-slate-400 group-hover:text-slate-600 text-xs">:::</span>
              </div>

              {/* Dòng 2: Icon W màu xanh dương, tên đề và tag Tách câu */}
              <div className="flex items-start gap-2.5">
                <div className="size-7 rounded-lg bg-blue-600 text-white font-extrabold text-xs grid place-items-center shrink-0 mt-0.5 shadow-xs">
                  W
                </div>
                <div className="min-w-0 flex-1">
                  <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 transition">
                    {item.name}
                  </strong>
                  <span className="inline-block text-[10px] text-slate-500 mt-0.5 font-medium">
                    {item.tag || "Tách câu"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* =========================================================================
          CỘT PHẢI: BẢNG HỌC LIỆU PHÂN CẤP (KHỐI -> MÔN -> LỚP) CHUẨN 100% ẢNH 1
          ========================================================================= */}
      <main className="flex-1 p-5 sm:p-6 space-y-4 overflow-y-auto">
        {/* Header hàng trên: Tiêu đề Học liệu & Breadcrumb + Icon view + Nút Tải lên */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1
              onClick={() => {
                setSelectedGradeId(null);
                setSelectedSubjectId(null);
                setSelectedClassId(null);
              }}
              className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 cursor-pointer"
            >
              Học liệu
            </h1>

            {/* Breadcrumb drill-down Khối */}
            {currentGrade && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSubjectId(null);
                    setSelectedClassId(null);
                  }}
                  className="text-sm font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  {currentGrade.label}
                </button>
              </>
            )}

            {/* Breadcrumb drill-down Môn */}
            {currentSubject && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <button
                  type="button"
                  onClick={() => setSelectedClassId(null)}
                  className="text-sm font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Môn {currentSubject.name}
                </button>
              </>
            )}

            {/* Breadcrumb drill-down Lớp */}
            {currentClass && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {currentClass.name}
                </span>
              </>
            )}
          </div>

          {/* Icon view toggle + Nút Tải lên chuẩn Ảnh 1 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  viewMode === "list" ? "bg-slate-100 dark:bg-slate-800 text-blue-600" : "text-slate-400"
                }`}
              >
                <ListIcon size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  viewMode === "grid" ? "bg-slate-100 dark:bg-slate-800 text-blue-600" : "text-slate-400"
                }`}
              >
                <Grid size={16} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setTargetAssignmentClassName(currentClass?.name || "Kho học liệu");
                setAssignmentModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer shadow-2xs"
            >
              Tải lên
            </button>
          </div>
        </div>

        {/* Thanh tìm kiếm dài toàn chiều ngang bo góc kèm icon kính lúp */}
        <div className="relative">
          <input
            type="text"
            placeholder="Tìm kiếm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 shadow-2xs focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* =====================================================================
            BẢNG DANH SÁCH MỤC (TABLE VIEW CHUẨN ẢNH 1)
            ===================================================================== */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs">
          {/* Hàng Header bảng chuẩn Ảnh 1 */}
          <div className="grid grid-cols-12 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-xs font-semibold text-slate-500">
            <div className="col-span-6 flex items-center gap-1">
              <span>
                {!selectedGradeId
                  ? "Tên khối"
                  : !selectedSubjectId
                  ? "Tên môn"
                  : !selectedClassId
                  ? "Tên lớp"
                  : "Tên tệp"}
              </span>
              <span>↑</span>
            </div>
            <div className="col-span-3 text-left">Kích thước tệp</div>
            <div className="col-span-2 flex items-center gap-1 text-left">
              <span>Sửa đổi lần cuối</span>
              <Filter size={12} className="text-slate-400" />
            </div>
            <div className="col-span-1 text-right"></div>
          </div>

          {/* Hàng hành động đầu tiên: Nút Tạo mới có icon Folder xanh dấu cộng (+) */}
          <div
            onClick={() => setCreateFolderModalOpen(true)}
            className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer text-xs font-bold text-blue-600 transition"
          >
            <div className="size-6 rounded bg-blue-600 text-white grid place-items-center text-xs shadow-2xs">
              +
            </div>
            <span>
              {!selectedGradeId
                ? "Tạo khối mới"
                : !selectedSubjectId
                ? `Tạo môn mới cho ${currentGrade?.label}`
                : !selectedClassId
                ? `Tạo lớp mới cho môn ${currentSubject?.name}`
                : `Thêm bài tập / học liệu cho ${currentClass?.name}`}
            </span>
          </div>

          {/* DANH SÁCH NỘI DUNG THEO TỪNG CẤP ĐỘ */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {/* CẤP 1: DANH SÁCH KHỐI (6, 7, Đại học...) NẾU CHƯA CHỌN KHỐI */}
            {!selectedGradeId &&
              gradesData
                .filter((g) => !searchQuery || g.label.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((grade) => (
                  <div
                    key={grade.id}
                    onClick={() => setSelectedGradeId(grade.id)}
                    className="grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer text-xs transition group"
                  >
                    <div className="col-span-6 flex items-center gap-3">
                      <Folder size={18} className="text-slate-800 dark:text-slate-200 fill-slate-800 dark:fill-slate-200" />
                      <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                        {grade.name}
                      </strong>
                    </div>
                    <div className="col-span-3 text-slate-500">{grade.itemsCount} mục</div>
                    <div className="col-span-2 text-slate-500">{grade.updatedAt}</div>
                    <div className="col-span-1 text-right text-slate-400">...</div>
                  </div>
                ))}

            {/* CẤP 2: DANH SÁCH MÔN HỌC (NẾU ĐÃ CHỌN KHỐI) */}
            {selectedGradeId && !selectedSubjectId && currentGrade && (
              <>
                {currentGrade.subjects.length > 0 ? (
                  currentGrade.subjects.map((sub) => (
                    <div
                      key={sub.id}
                      onClick={() => setSelectedSubjectId(sub.id)}
                      className="grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer text-xs transition group"
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <Folder size={18} className="text-slate-800 dark:text-slate-200 fill-slate-800 dark:fill-slate-200" />
                        <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                          Môn {sub.name}
                        </strong>
                      </div>
                      <div className="col-span-3 text-slate-500">{sub.classes.length} lớp</div>
                      <div className="col-span-2 text-slate-500">{sub.updatedAt}</div>
                      <div className="col-span-1 text-right text-slate-400">...</div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Khối này chưa có môn học nào. Hãy bấm "+ Tạo môn mới" ở trên để bổ sung.
                  </div>
                )}
              </>
            )}

            {/* CẤP 3: DANH SÁCH LỚP HỌC (NẾU ĐÃ CHỌN MÔN) */}
            {selectedSubjectId && !selectedClassId && currentSubject && (
              <>
                {currentSubject.classes.length > 0 ? (
                  currentSubject.classes.map((cls) => (
                    <div
                      key={cls.id}
                      onClick={() => setSelectedClassId(cls.id)}
                      className="grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer text-xs transition group"
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <Folder size={18} className="text-blue-600 fill-blue-600" />
                        <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                          {cls.name} ({cls.code})
                        </strong>
                      </div>
                      <div className="col-span-3 text-slate-500">{cls.files.length} tệp</div>
                      <div className="col-span-2 text-slate-500">{cls.updatedAt}</div>
                      <div className="col-span-1 text-right text-slate-400">...</div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Môn này chưa có lớp học nào. Hãy bấm "+ Tạo lớp mới" ở trên để mở lớp.
                  </div>
                )}
              </>
            )}

            {/* CẤP 4: DANH SÁCH TÀI LIỆU & BÀI TẬP CỦA LỚP */}
            {selectedClassId && currentClass && (
              <>
                {currentClass.files.length > 0 ? (
                  currentClass.files.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => {
                        notify(`Đang mở xem bài tập: ${file.name}`, "info");
                      }}
                      className="grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer text-xs transition group"
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <span className={`size-7 rounded-lg text-white font-extrabold text-[11px] grid place-items-center shrink-0 ${
                          file.type === "word" ? "bg-blue-600" : "bg-rose-600"
                        }`}>
                          {file.type === "word" ? "W" : "PDF"}
                        </span>
                        <div>
                          <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition block truncate">
                            {file.name}
                          </strong>
                          {file.tag && (
                            <span className="text-[10px] text-blue-600 font-semibold">{file.tag}</span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 text-slate-500">{file.size}</div>
                      <div className="col-span-2 text-slate-500">{file.updatedAt}</div>
                      <div className="col-span-1 text-right text-slate-400">...</div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Lớp chưa có học liệu hoặc bài tập nào. Hãy bấm "+ Thêm bài tập / học liệu" để thêm ngay.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* =========================================================================
          MODAL TẠO BÀI TẬP / ĐỀ THI TOÀN DIỆN
          ========================================================================= */}
      <AssignmentBuilderModal
        open={assignmentModalOpen}
        onClose={() => setAssignmentModalOpen(false)}
        targetClassName={targetAssignmentClassName}
        onSaveAssignment={handleSaveCreatedAssignment}
      />

      {/* =========================================================================
          MODAL TẠO KHỐI / MÔN / LỚP MỚI
          ========================================================================= */}
      {createFolderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              {!selectedGradeId
                ? "Tạo khối mới"
                : !selectedSubjectId
                ? `Tạo môn mới cho ${currentGrade?.label}`
                : `Tạo lớp mới cho môn ${currentSubject?.name}`}
            </h3>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tên thư mục / Khối / Môn / Lớp:
              </label>
              <input
                type="text"
                placeholder="Ví dụ: Khối 12 hoặc Môn Vật lí hoặc Lớp 6A3..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCreateFolderModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
              >
                Tạo thư mục
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
