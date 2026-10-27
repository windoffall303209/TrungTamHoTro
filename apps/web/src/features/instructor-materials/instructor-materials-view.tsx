"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
  MoreVertical,
  Plus,
  Search,
  Share2,
  Trash2,
  Upload,
  UploadCloud,
  Move,
  BookOpen,
  Video,
  Link2,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { AssignmentBuilderModal } from "@/features/exams/assignment-builder-modal";

export interface MaterialFileItem {
  id: string;
  name: string;
  type: "word" | "pdf" | "image" | "folder" | "video" | "slide" | "link";
  size: string;
  updatedAt: string;
  folderCategory?: string;
  isUnclassified?: boolean;
  tag?: string;
  url?: string;
  description?: string;
  assignedRole?: "MATERIAL" | "LECTURE";
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

  // State Modal Tải lên Tài liệu / Bài giảng (Tải lên học liệu thật)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    type: "pdf" as "word" | "pdf" | "slide" | "video" | "link",
    category: "MATERIAL" as "MATERIAL" | "LECTURE",
    url: "",
    fileName: "",
    fileSize: "1.8 MB",
    targetClassId: "cls-6A1",
    description: "",
  });

  // State Modal Gán vai trò (Dùng làm tài liệu / bài giảng)
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedFileForAssign, setSelectedFileForAssign] = useState<{
    file: MaterialFileItem;
    fromClassId?: string;
  } | null>(null);

  // State Modal Phân loại / Di chuyển sang thư mục
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [selectedFileForMove, setSelectedFileForMove] = useState<{
    file: MaterialFileItem;
    fromClassId?: string;
  } | null>(null);
  const [targetMoveClassId, setTargetMoveClassId] = useState<string>("cls-6A1");

  // State menu 3 chấm đang mở
  const [activeMenuFileId, setActiveMenuFileId] = useState<string | null>(null);

  // Kéo thả (Drag & Drop)
  const [draggedFile, setDraggedFile] = useState<MaterialFileItem | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);

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

  // Danh sách phẳng tất cả các lớp để thuận tiện chọn vị trí tải lên / di chuyển
  const allClassesList = useMemo(() => {
    const list: { classId: string; className: string; path: string }[] = [];
    gradesData.forEach((grade) => {
      grade.subjects.forEach((sub) => {
        sub.classes.forEach((cls) => {
          list.push({
            classId: cls.id,
            className: cls.name,
            path: `${grade.label} > ${sub.name} > ${cls.name}`,
          });
        });
      });
    });
    return list;
  }, [gradesData]);

  // Xử lý tạo mới Khối / Môn / Lớp tùy theo vị trí đang đứng
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      notify("Vui lòng nhập tên thư mục!", "error");
      return;
    }

    if (!selectedGradeId) {
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

  // Tải lên tài liệu / bài giảng thật
  const handleUploadMaterialSubmit = () => {
    if (!uploadForm.title.trim()) {
      notify("Vui lòng nhập tiêu đề tài liệu / bài giảng!", "error");
      return;
    }

    const newFile: MaterialFileItem = {
      id: `mat-${Date.now()}`,
      name: uploadForm.title.trim(),
      type: uploadForm.type,
      size: uploadForm.fileSize || "2.1 MB",
      updatedAt: "Vừa xong",
      tag: uploadForm.category === "LECTURE" ? "Bài giảng" : "Tài liệu",
      assignedRole: uploadForm.category,
      url: uploadForm.url,
      description: uploadForm.description,
    };

    if (uploadForm.targetClassId === "unclassified") {
      setUnclassifiedExams((prev) => [newFile, ...prev]);
      notify(`Đã tải lên '${newFile.name}' vào danh sách Chưa phân loại!`, "success");
    } else {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== uploadForm.targetClassId) return c;
              return {
                ...c,
                files: [newFile, ...c.files],
                itemsCount: c.itemsCount + 1,
              };
            }),
          })),
        }))
      );
      const targetCls = allClassesList.find((c) => c.classId === uploadForm.targetClassId);
      notify(`Đã tải lên '${newFile.name}' vào ${targetCls?.className || "lớp học"}!`, "success");
    }

    setUploadModalOpen(false);
    setUploadForm({
      title: "",
      type: "pdf",
      category: "MATERIAL",
      url: "",
      fileName: "",
      fileSize: "1.8 MB",
      targetClassId: currentClass?.id || "cls-6A1",
      description: "",
    });
  };

  // Chuyển tệp học liệu sang cột "Chưa phân loại" bên trái để sẵn sàng kéo thả
  const handleMoveToUnclassified = (file: MaterialFileItem, fromClassId?: string) => {
    if (fromClassId) {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== fromClassId) return c;
              return {
                ...c,
                files: c.files.filter((f) => f.id !== file.id),
                itemsCount: Math.max(0, c.itemsCount - 1),
              };
            }),
          })),
        }))
      );
    }
    const unclassifiedFile: MaterialFileItem = {
      ...file,
      isUnclassified: true,
      updatedAt: "Vừa xong",
    };
    setUnclassifiedExams((prev) => [
      unclassifiedFile,
      ...prev.filter((f) => f.id !== file.id),
    ]);
    setActiveMenuFileId(null);
    notify(`Đã chuyển '${file.name}' sang danh sách Chưa phân loại ở cột trái. Bạn có thể kéo thả vào thư mục khác.`, "info");
  };

  // Di chuyển tệp đến một lớp học cụ thể (từ popup hoặc kéo thả)
  const handleMoveFileToTargetClass = (
    file: MaterialFileItem,
    targetClassId: string,
    fromClassId?: string
  ) => {
    // Xóa ở vị trí cũ
    if (fromClassId) {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== fromClassId) return c;
              return {
                ...c,
                files: c.files.filter((f) => f.id !== file.id),
                itemsCount: Math.max(0, c.itemsCount - 1),
              };
            }),
          })),
        }))
      );
    } else {
      setUnclassifiedExams((prev) => prev.filter((f) => f.id !== file.id));
    }

    // Thêm vào lớp đích
    setGradesData((prev) =>
      prev.map((g) => ({
        ...g,
        subjects: g.subjects.map((s) => ({
          ...s,
          classes: s.classes.map((c) => {
            if (c.id !== targetClassId) return c;
            return {
              ...c,
              files: [{ ...file, isUnclassified: false, updatedAt: "Vừa xong" }, ...c.files],
              itemsCount: c.itemsCount + 1,
            };
          }),
        })),
      }))
    );

    const targetCls = allClassesList.find((c) => c.classId === targetClassId);
    notify(`Đã di chuyển '${file.name}' vào ${targetCls?.className || "lớp mới"} thành công!`, "success");
    setMoveModalOpen(false);
    setSelectedFileForMove(null);
    setActiveMenuFileId(null);
    setDraggedFile(null);
    setDragOverTargetId(null);
  };

  // Xóa tệp học liệu
  const handleDeleteFile = (file: MaterialFileItem, fromClassId?: string) => {
    if (fromClassId) {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== fromClassId) return c;
              return {
                ...c,
                files: c.files.filter((f) => f.id !== file.id),
                itemsCount: Math.max(0, c.itemsCount - 1),
              };
            }),
          })),
        }))
      );
    } else {
      setUnclassifiedExams((prev) => prev.filter((f) => f.id !== file.id));
    }
    setActiveMenuFileId(null);
    notify(`Đã xóa '${file.name}' khỏi kho học liệu!`, "success");
  };

  // Xác nhận Dùng làm tài liệu hoặc bài giảng
  const handleAssignRoleConfirm = (role: "MATERIAL" | "LECTURE") => {
    if (!selectedFileForAssign) return;
    const { file, fromClassId } = selectedFileForAssign;
    const updatedFile: MaterialFileItem = {
      ...file,
      assignedRole: role,
      tag: role === "LECTURE" ? "Bài giảng" : "Tài liệu",
    };

    if (fromClassId) {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== fromClassId) return c;
              return {
                ...c,
                files: c.files.map((f) => (f.id === file.id ? updatedFile : f)),
              };
            }),
          })),
        }))
      );
    } else {
      setUnclassifiedExams((prev) =>
        prev.map((f) => (f.id === file.id ? updatedFile : f))
      );
    }

    notify(
      `Đã thiết lập '${file.name}' làm ${role === "LECTURE" ? "Bài giảng" : "Tài liệu học tập"}!`,
      "success"
    );
    setAssignModalOpen(false);
    setSelectedFileForAssign(null);
    setActiveMenuFileId(null);
  };

  // Xử lý khi thả tệp vào một Khối (Tự động khởi tạo môn/lớp nếu chưa có để đảm bảo luôn nhận tệp thành công)
  const handleDropOnTargetGrade = (gradeId: string) => {
    if (!draggedFile) return;
    const targetGrade = gradesData.find((g) => g.id === gradeId);
    if (!targetGrade) return;

    if (targetGrade.subjects.length === 0) {
      const newClassId = `cls-${gradeId}-auto-${Date.now()}`;
      const newSubjectId = `sub-${gradeId}-auto-${Date.now()}`;
      const newClass: ClassFolderItem = {
        id: newClassId,
        name: `Lớp ${targetGrade.name}A1`,
        code: `K${targetGrade.name}-01`,
        itemsCount: 1,
        updatedAt: "Vừa xong",
        files: [{ ...draggedFile, isUnclassified: false, updatedAt: "Vừa xong" }],
      };
      const newSub: SubjectFolderItem = {
        id: newSubjectId,
        name: "Tài liệu chung",
        itemsCount: 1,
        updatedAt: "Vừa xong",
        classes: [newClass],
      };

      setGradesData((prev) =>
        prev.map((g) => (g.id === gradeId ? { ...g, itemsCount: g.itemsCount + 1, subjects: [newSub, ...g.subjects] } : g))
      );
      setUnclassifiedExams((prev) => prev.filter((f) => f.id !== draggedFile.id));
      notify(`Đã di chuyển '${draggedFile.name}' vào Khối ${targetGrade.label} thành công!`, "success");
      setDraggedFile(null);
      setDragOverTargetId(null);
      return;
    }

    const firstSubject = targetGrade.subjects[0];
    if (!firstSubject || firstSubject.classes.length === 0) {
      const newClassId = `cls-${gradeId}-sub-auto-${Date.now()}`;
      const newClass: ClassFolderItem = {
        id: newClassId,
        name: `Lớp ${targetGrade.name}A1`,
        code: `K${targetGrade.name}-01`,
        itemsCount: 1,
        updatedAt: "Vừa xong",
        files: [{ ...draggedFile, isUnclassified: false, updatedAt: "Vừa xong" }],
      };
      setGradesData((prev) =>
        prev.map((g) => {
          if (g.id !== gradeId) return g;
          return {
            ...g,
            itemsCount: g.itemsCount + 1,
            subjects: g.subjects.map((s, idx) => (idx === 0 ? { ...s, itemsCount: s.itemsCount + 1, classes: [newClass, ...s.classes] } : s)),
          };
        })
      );
      setUnclassifiedExams((prev) => prev.filter((f) => f.id !== draggedFile.id));
      notify(`Đã di chuyển '${draggedFile.name}' vào Khối ${targetGrade.label} thành công!`, "success");
      setDraggedFile(null);
      setDragOverTargetId(null);
      return;
    }

    const targetClass = firstSubject.classes[0];
    if (targetClass) {
      handleMoveFileToTargetClass(draggedFile, targetClass.id);
    }
  };

  // Xử lý khi thả tệp vào một Môn (Tự động khởi tạo lớp nếu môn chưa có lớp)
  const handleDropOnTargetSubject = (subjectId: string) => {
    if (!draggedFile) return;
    let foundClassId: string | null = null;
    let parentGradeId: string | null = null;
    let targetSubjectName = "môn học";

    gradesData.forEach((g) => {
      g.subjects.forEach((s) => {
        if (s.id === subjectId) {
          parentGradeId = g.id;
          targetSubjectName = s.name;
          if (s.classes.length > 0 && s.classes[0]) {
            foundClassId = s.classes[0].id;
          }
        }
      });
    });

    if (foundClassId) {
      handleMoveFileToTargetClass(draggedFile, foundClassId);
      return;
    }

    if (parentGradeId) {
      const newClassId = `cls-sub-auto-${Date.now()}`;
      const newClass: ClassFolderItem = {
        id: newClassId,
        name: `Lớp ${targetSubjectName} 1`,
        code: `L-${Date.now().toString().slice(-4)}`,
        itemsCount: 1,
        updatedAt: "Vừa xong",
        files: [{ ...draggedFile, isUnclassified: false, updatedAt: "Vừa xong" }],
      };
      setGradesData((prev) =>
        prev.map((g) => {
          if (g.id !== parentGradeId) return g;
          return {
            ...g,
            itemsCount: g.itemsCount + 1,
            subjects: g.subjects.map((s) => (s.id === subjectId ? { ...s, itemsCount: s.itemsCount + 1, classes: [newClass, ...s.classes] } : s)),
          };
        })
      );
      setUnclassifiedExams((prev) => prev.filter((f) => f.id !== draggedFile.id));
      notify(`Đã di chuyển '${draggedFile.name}' vào môn ${targetSubjectName} thành công!`, "success");
      setDraggedFile(null);
      setDragOverTargetId(null);
      return;
    }

    notify("Không tìm thấy thông tin môn học để lưu tệp!", "error");
  };

  // Xử lý khi thả tệp vào một Thư mục hoặc Lớp
  const handleDropOnTargetClass = (classId: string) => {
    if (!draggedFile) return;
    handleMoveFileToTargetClass(draggedFile, classId);
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
      setUnclassifiedExams([newFile, ...unclassifiedExams]);
    }
  };

  return (
    <div
      onClick={() => setActiveMenuFileId(null)}
      className="flex flex-col lg:flex-row min-h-[calc(100vh-80px)] w-full bg-slate-50/50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100"
    >
      {/* =========================================================================
          CỘT TRÁI: ĐỀ / TÀI LIỆU CHƯA PHÂN LOẠI (HỖ TRỢ KÉO THẢ & MENU 3 CHẤM 3 LỰA CHỌN)
          ========================================================================= */}
      <aside className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 space-y-4">
        {/* Hàng Header: Đề chưa phân loại kèm badge đỏ tròn */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Đề / Tài liệu chưa phân loại
            </h2>
            <span className="grid size-5 place-items-center rounded-full bg-rose-500 text-white text-[11px] font-extrabold shadow-2xs">
              {unclassifiedExams.length}
            </span>
          </div>
        </div>

        {/* Switch: Hiển thị chi tiết học liệu */}
        <div className="flex items-center justify-between pt-1 pb-1 border-b border-slate-100 dark:border-slate-800">
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

        {/* Hướng dẫn kéo thả trực quan */}
        <div className="px-3 py-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 text-[11px] text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <Move size={14} className="shrink-0 animate-pulse text-blue-600" />
          <span>Kéo thả thẻ bên dưới vào các Lớp ở bảng bên phải để di chuyển thư mục.</span>
        </div>

        {/* Danh sách các thẻ đề chưa phân loại (Kéo thả draggable, Icon phân loại & Menu 3 chấm) */}
        <div className="space-y-3 pt-1">
          {unclassifiedExams.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              Không có tài liệu nào chưa phân loại. Bấm "Tải lên" ở góc trên để bổ sung.
            </div>
          ) : (
            unclassifiedExams.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", item.id);
                  setDraggedFile(item);
                }}
                onDragEnd={() => setDraggedFile(null)}
                className={`relative rounded-2xl border bg-white dark:bg-slate-900 p-3 shadow-2xs space-y-2 hover:border-blue-400 transition cursor-grab active:cursor-grabbing group ${
                  draggedFile?.id === item.id
                    ? "opacity-50 border-blue-500 scale-[0.98]"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                {/* Dòng 1: Tag học liệu, vai trò gán và Nút 3 chấm */}
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-500">
                    <span>📍</span>
                    <span>Học liệu</span>
                    {item.assignedRole && (
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${
                        item.assignedRole === "LECTURE"
                          ? "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300"
                          : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                      }`}>
                        {item.assignedRole === "LECTURE" ? "Bài giảng" : "Tài liệu"}
                      </span>
                    )}
                  </div>

                  {/* Nút 3 chấm và Dropdown Popover */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuFileId(activeMenuFileId === item.id ? null : item.id);
                      }}
                      className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                      title="Tùy chọn học liệu"
                    >
                      <MoreVertical size={15} />
                    </button>

                    {activeMenuFileId === item.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-30 divide-y divide-slate-100 dark:divide-slate-800 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFileForAssign({ file: item });
                            setAssignModalOpen(true);
                            setActiveMenuFileId(null);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                        >
                          <BookOpen size={14} className="text-blue-600" />
                          <span>Dùng làm tài liệu/bài giảng</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFileForMove({ file: item });
                            setMoveModalOpen(true);
                            setActiveMenuFileId(null);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-amber-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                        >
                          <Move size={14} className="text-amber-600" />
                          <span>Phân loại lại tài liệu</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteFile(item);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center gap-2 cursor-pointer font-medium"
                        >
                          <Trash2 size={14} />
                          <span>Xóa</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dòng 2: Icon loại file, tên đề và tag */}
                <div className="flex items-start gap-2.5">
                  <div className={`size-7 rounded-lg text-white font-extrabold text-xs grid place-items-center shrink-0 mt-0.5 shadow-xs ${
                    item.type === "word"
                      ? "bg-blue-600"
                      : item.type === "pdf"
                      ? "bg-rose-600"
                      : item.type === "video"
                      ? "bg-purple-600"
                      : "bg-emerald-600"
                  }`}>
                    {item.type === "word" ? "W" : item.type === "pdf" ? "PDF" : item.type === "video" ? "MP4" : "DOC"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 transition">
                      {item.name}
                    </strong>
                    {showDetail && (
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                        <span>{item.size}</span>
                        <span>•</span>
                        <span>{item.updatedAt}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* =========================================================================
          CỘT PHẢI: BẢNG HỌC LIỆU PHÂN CẤP (KHỐI -> MÔN -> LỚP)
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

          {/* Icon view toggle + Nút Tải lên tài liệu/bài giảng */}
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

            {/* Nút Tải lên học liệu (Tài liệu / Bài giảng) */}
            <button
              type="button"
              onClick={() => {
                setUploadForm((prev) => ({
                  ...prev,
                  targetClassId: currentClass?.id || "cls-6A1",
                }));
                setUploadModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Upload size={14} />
              <span>Tải lên tài liệu / bài giảng</span>
            </button>
          </div>
        </div>

        {/* Thanh tìm kiếm dài toàn chiều ngang bo góc kèm icon kính lúp */}
        <div className="relative">
          <input
            type="text"
            placeholder="Tìm kiếm học liệu, tài liệu, bài giảng..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 shadow-2xs focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* =====================================================================
            BẢNG DANH SÁCH MỤC (TABLE VIEW HỖ TRỢ THẢ KÉO THAY ĐỔI THƯ MỤC)
            ===================================================================== */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs">
          {/* Hàng Header bảng chuẩn */}
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
            <div className="col-span-1 text-right">Tùy chọn</div>
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
                : `Thêm tài liệu / bài giảng mới cho ${currentClass?.name}`}
            </span>
          </div>

          {/* DANH SÁCH NỘI DUNG THEO TỪNG CẤP ĐỘ */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {/* CẤP 1: DANH SÁCH KHỐI (6, 7, Đại học...) NẾU CHƯA CHỌN KHỐI (HỖ TRỢ NHẬN THẢ FILE) */}
            {!selectedGradeId &&
              gradesData
                .filter((g) => !searchQuery || g.label.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((grade) => {
                  const isDragOver = dragOverTargetId === grade.id;
                  return (
                    <div
                      key={grade.id}
                      onClick={() => setSelectedGradeId(grade.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverTargetId(grade.id);
                      }}
                      onDragLeave={() => setDragOverTargetId(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDropOnTargetGrade(grade.id);
                      }}
                      className={`grid grid-cols-12 px-4 py-3.5 items-center cursor-pointer text-xs transition group ${
                        isDragOver
                          ? "bg-blue-100/80 dark:bg-blue-900/40 border-2 border-dashed border-blue-500 scale-[1.01]"
                          : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <Folder size={18} className="text-slate-800 dark:text-slate-200 fill-slate-800 dark:fill-slate-200" />
                        <div>
                          <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                            {grade.name}
                          </strong>
                          {isDragOver && (
                            <span className="block text-[11px] font-bold text-blue-600 animate-pulse">
                              Thả tệp vào đây để chuyển vào khối {grade.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 text-slate-500">{grade.itemsCount} mục</div>
                      <div className="col-span-2 text-slate-500">{grade.updatedAt}</div>
                      <div className="col-span-1 text-right text-slate-400">...</div>
                    </div>
                  );
                })}

            {/* CẤP 2: DANH SÁCH MÔN HỌC (NẾU ĐÃ CHỌN KHỐI - HỖ TRỢ NHẬN THẢ FILE) */}
            {selectedGradeId && !selectedSubjectId && currentGrade && (
              <>
                {currentGrade.subjects.length > 0 ? (
                  currentGrade.subjects.map((sub) => {
                    const isDragOver = dragOverTargetId === sub.id;
                    return (
                      <div
                        key={sub.id}
                        onClick={() => setSelectedSubjectId(sub.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverTargetId(sub.id);
                        }}
                        onDragLeave={() => setDragOverTargetId(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDropOnTargetSubject(sub.id);
                        }}
                        className={`grid grid-cols-12 px-4 py-3.5 items-center cursor-pointer text-xs transition group ${
                          isDragOver
                            ? "bg-blue-100/80 dark:bg-blue-900/40 border-2 border-dashed border-blue-500 scale-[1.01]"
                            : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        }`}
                      >
                        <div className="col-span-6 flex items-center gap-3">
                          <Folder size={18} className="text-slate-800 dark:text-slate-200 fill-slate-800 dark:fill-slate-200" />
                          <div>
                            <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                              Môn {sub.name}
                            </strong>
                            {isDragOver && (
                              <span className="block text-[11px] font-bold text-blue-600 animate-pulse">
                                Thả tệp vào đây để chuyển vào môn {sub.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 text-slate-500">{sub.classes.length} lớp</div>
                        <div className="col-span-2 text-slate-500">{sub.updatedAt}</div>
                        <div className="col-span-1 text-right text-slate-400">...</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Khối này chưa có môn học nào. Hãy bấm "+ Tạo môn mới" ở trên để bổ sung.
                  </div>
                )}
              </>
            )}

            {/* CẤP 3: DANH SÁCH LỚP HỌC (HỖ TRỢ THẢ KÉO ĐỂ PHÂN LOẠI FILE VÀO LỚP) */}
            {selectedSubjectId && !selectedClassId && currentSubject && (
              <>
                {currentSubject.classes.length > 0 ? (
                  currentSubject.classes.map((cls) => {
                    const isDragOver = dragOverTargetId === cls.id;
                    return (
                      <div
                        key={cls.id}
                        onClick={() => setSelectedClassId(cls.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverTargetId(cls.id);
                        }}
                        onDragLeave={() => setDragOverTargetId(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDropOnTargetClass(cls.id);
                        }}
                        className={`grid grid-cols-12 px-4 py-3.5 items-center cursor-pointer text-xs transition group ${
                          isDragOver
                            ? "bg-blue-100/70 dark:bg-blue-900/40 border-2 border-dashed border-blue-500 scale-[1.01]"
                            : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        }`}
                      >
                        <div className="col-span-6 flex items-center gap-3">
                          <Folder size={18} className="text-blue-600 fill-blue-600" />
                          <div>
                            <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition">
                              {cls.name} ({cls.code})
                            </strong>
                            {isDragOver && (
                              <span className="block text-[11px] font-bold text-blue-600 animate-pulse">
                                Thả tệp vào đây để di chuyển vào lớp này
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 text-slate-500">{cls.files.length} tệp</div>
                        <div className="col-span-2 text-slate-500">{cls.updatedAt}</div>
                        <div className="col-span-1 text-right text-slate-400">...</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Môn này chưa có lớp học nào. Hãy bấm "+ Tạo lớp mới" ở trên để mở lớp.
                  </div>
                )}
              </>
            )}

            {/* CẤP 4: DANH SÁCH TÀI LIỆU & BÀI GIẢNG CỦA LỚP KÈM MENU 3 CHẤM ĐẦY ĐỦ 3 CHỨC NĂNG */}
            {selectedClassId && currentClass && (
              <>
                {currentClass.files.length > 0 ? (
                  currentClass.files.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => {
                        notify(`Đang xem tài liệu/bài giảng: ${file.name}`, "info");
                      }}
                      className="grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer text-xs transition group relative"
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <span
                          className={`size-7 rounded-lg text-white font-extrabold text-[11px] grid place-items-center shrink-0 ${
                            file.type === "word"
                              ? "bg-blue-600"
                              : file.type === "pdf"
                              ? "bg-rose-600"
                              : file.type === "video"
                              ? "bg-purple-600"
                              : "bg-emerald-600"
                          }`}
                        >
                          {file.type === "word" ? "W" : file.type === "pdf" ? "PDF" : file.type === "video" ? "MP4" : "DOC"}
                        </span>
                        <div className="min-w-0">
                          <strong className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition block truncate">
                            {file.name}
                          </strong>
                          <div className="flex items-center gap-2 mt-0.5">
                            {file.tag && (
                              <span className="text-[10px] text-blue-600 font-semibold">{file.tag}</span>
                            )}
                            {file.assignedRole && (
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold ${
                                file.assignedRole === "LECTURE"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                              }`}>
                                {file.assignedRole === "LECTURE" ? "Bài giảng" : "Tài liệu học tập"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-3 text-slate-500">{file.size}</div>
                      <div className="col-span-2 text-slate-500">{file.updatedAt}</div>

                      {/* Cột Tùy chọn 3 chấm với 3 hành động: Dùng làm tài liệu/bài giảng, Phân loại lại tài liệu, Xóa */}
                      <div className="col-span-1 text-right relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuFileId(activeMenuFileId === file.id ? null : file.id);
                          }}
                          className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                          title="Tùy chọn"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {activeMenuFileId === file.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-30 divide-y divide-slate-100 dark:divide-slate-800 text-xs text-left"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFileForAssign({ file, fromClassId: currentClass.id });
                                setAssignModalOpen(true);
                                setActiveMenuFileId(null);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <BookOpen size={14} className="text-blue-600" />
                              <span>Dùng làm tài liệu/bài giảng</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                handleMoveToUnclassified(file, currentClass.id);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-amber-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Move size={14} className="text-amber-600" />
                              <span>Phân loại lại tài liệu</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                handleDeleteFile(file, currentClass.id);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Trash2 size={14} />
                              <span>Xóa</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Lớp chưa có học liệu hoặc bài giảng nào. Hãy bấm "Tải lên tài liệu / bài giảng" để bổ sung ngay.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* =========================================================================
          MODAL TẢI LÊN TÀI LIỆU / BÀI GIẢNG (KHO HỌC LIỆU THẬT)
          ========================================================================= */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <UploadCloud size={20} className="text-blue-600" />
                <span>Tải lên tài liệu / bài giảng</span>
              </h3>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Chọn mục đích: Tài liệu học tập hoặc Bài giảng */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mục đích sử dụng:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadForm({ ...uploadForm, category: "MATERIAL", type: "pdf" })}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                      uploadForm.category === "MATERIAL"
                        ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600"
                        : "border-slate-200 dark:border-slate-800 text-slate-600"
                    }`}
                  >
                    <BookOpen size={16} />
                    <span>Tài liệu học tập</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadForm({ ...uploadForm, category: "LECTURE", type: "video" })}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                      uploadForm.category === "LECTURE"
                        ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-600"
                        : "border-slate-200 dark:border-slate-800 text-slate-600"
                    }`}
                  >
                    <Video size={16} />
                    <span>Bài giảng (Video / Link)</span>
                  </button>
                </div>
              </div>

              {/* Tên tiêu đề */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tiêu đề tài liệu / bài giảng: <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đề cương ôn tập Toán giữa kỳ 1 hoặc Bài giảng Số nguyên..."
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Vị trí lưu: Chọn Lớp hoặc Chưa phân loại */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Vị trí phân loại vào lớp / thư mục:
                </label>
                <select
                  value={uploadForm.targetClassId}
                  onChange={(e) => setUploadForm({ ...uploadForm, targetClassId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="unclassified">📍 Kho chưa phân loại (ở cột trái)</option>
                  {allClassesList.map((item) => (
                    <option key={item.classId} value={item.classId}>
                      📁 {item.path}
                    </option>
                  ))}
                </select>
              </div>

              {/* Định dạng tệp / Liên kết */}
              {uploadForm.category === "LECTURE" ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Liên kết Video (YouTube, Google Drive):
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      placeholder="https://www.youtube.com/watch?v=... hoặc Google Drive link"
                      value={uploadForm.url}
                      onChange={(e) => setUploadForm({ ...uploadForm, url: e.target.value, type: "link" })}
                      className="w-full px-3 py-2 pr-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                    />
                    <Link2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tệp đính kèm (PDF, Word, PowerPoint, Ảnh):
                  </label>
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
                    <FileText size={28} className="mx-auto text-blue-600" />
                    <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                      Kéo thả hoặc{" "}
                      <label className="text-blue-600 font-bold hover:underline cursor-pointer">
                        chọn tệp từ máy
                        <input
                          type="file"
                          accept=".pdf,.docx,.doc,.pptx,.ppt,.png,.jpg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const ext = file.name.split(".").pop()?.toLowerCase();
                              setUploadForm({
                                ...uploadForm,
                                title: uploadForm.title || file.name.replace(/\.[^/.]+$/, ""),
                                fileName: file.name,
                                fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                                type: ext === "pdf" ? "pdf" : "word",
                              });
                            }
                          }}
                        />
                      </label>
                    </div>
                    {uploadForm.fileName && (
                      <div className="text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 py-1 px-2 rounded-lg inline-block">
                        ✓ Đã chọn: {uploadForm.fileName} ({uploadForm.fileSize})
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUploadMaterialSubmit}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Check size={14} />
                <span>Hoàn tất & Lưu vào kho</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL GÁN VAI TRÒ (DÙNG LÀM TÀI LIỆU / BÀI GIẢNG)
          ========================================================================= */}
      {assignModalOpen && selectedFileForAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BookOpen size={20} className="text-blue-600" />
              <span>Dùng làm tài liệu / bài giảng</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn vai trò áp dụng cho tệp <strong className="text-slate-900 dark:text-slate-100">"{selectedFileForAssign.file.name}"</strong>:
            </p>

            <div className="space-y-2 pt-1">
              <div
                onClick={() => handleAssignRoleConfirm("MATERIAL")}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 cursor-pointer transition flex items-center gap-3"
              >
                <div className="size-9 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 grid place-items-center shrink-0">
                  <FileText size={18} />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                    Dùng làm Tài liệu tham khảo
                  </strong>
                  <span className="text-[11px] text-slate-500">
                    Xuất hiện ở danh sách Tài liệu học tập để học sinh tải về ôn luyện.
                  </span>
                </div>
              </div>

              <div
                onClick={() => handleAssignRoleConfirm("LECTURE")}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 cursor-pointer transition flex items-center gap-3"
              >
                <div className="size-9 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-600 grid place-items-center shrink-0">
                  <Video size={18} />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                    Dùng làm Bài giảng
                  </strong>
                  <span className="text-[11px] text-slate-500">
                    Gắn vào hệ thống Bài giảng trực tuyến cho học sinh theo dõi video và lý thuyết.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL PHÂN LOẠI LẠI TÀI LIỆU / DI CHUYỂN SANG THƯ MỤC KHÁC
          ========================================================================= */}
      {moveModalOpen && selectedFileForMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Move size={20} className="text-amber-600" />
              <span>Phân loại lại / Di chuyển tệp</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn thư mục / lớp đích để chuyển tệp <strong className="text-slate-900 dark:text-slate-100">"{selectedFileForMove.file.name}"</strong>:
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Thư mục lớp đích:
              </label>
              <select
                value={targetMoveClassId}
                onChange={(e) => setTargetMoveClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                {allClassesList.map((item) => (
                  <option key={item.classId} value={item.classId}>
                    📁 {item.path}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMoveModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  handleMoveFileToTargetClass(
                    selectedFileForMove.file,
                    targetMoveClassId,
                    selectedFileForMove.fromClassId
                  );
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                Xác nhận di chuyển
              </button>
            </div>
          </div>
        </div>
      )}

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
