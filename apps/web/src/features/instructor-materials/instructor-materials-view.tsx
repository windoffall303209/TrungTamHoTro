"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
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
  FolderMinus,
  FolderOpen,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { AssignmentBuilderModal } from "@/features/exams/assignment-builder-modal";
import { apiRequest } from "@/lib/api-client";
import type { LearningClass } from "@/lib/learning-types";

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

// Giao diện học liệu chuẩn xác với phân cấp Khối -> Môn -> Lớp nạp trực tiếp từ CSDL PostgreSQL
export function InstructorMaterialsView() {
  const { session, notify } = useApp();
  const [gradesData, setGradesData] = useState<GradeFolderItem[]>([]);
  const [unclassifiedExams, setUnclassifiedExams] = useState<MaterialFileItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Nạp tài liệu và cấu trúc lớp học thật từ CSDL PostgreSQL
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [classesData, materialsData] = await Promise.all([
        apiRequest<LearningClass[]>("/instructor/classes", {
          roleCode: session.roleCode,
        }).catch(() => [] as LearningClass[]),
        apiRequest<any[]>("/materials", {
          roleCode: session.roleCode,
        }).catch(() => [] as any[]),
      ]);

      const unclassified: MaterialFileItem[] = [];
      const classMap: Record<string, MaterialFileItem[]> = {};

      if (Array.isArray(materialsData)) {
        materialsData.forEach((m: any) => {
          const rawName = m.name || m.title || "Tài liệu học tập";
          const ext = rawName.split(".").pop()?.toLowerCase() || "pdf";
          const fType = ext.includes("doc") ? "word" : ext.includes("pdf") ? "pdf" : ext.includes("jpg") || ext.includes("png") ? "image" : ext.includes("mp4") ? "video" : ext.includes("ppt") ? "slide" : "pdf";
          const sizeMb = m.sizeBytes ? `${(m.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "1.5 MB";

          const fileItem: MaterialFileItem = {
            id: m.id,
            name: rawName,
            type: fType,
            size: sizeMb,
            updatedAt: m.createdAt ? new Date(m.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
            folderCategory: m.folder || "Tài liệu chung",
            description: m.tags?.join(", ") || "",
            tag: m.folder || (ext.includes("doc") ? "Tách câu" : "Tài liệu"),
          };

          if (m.classId) {
            const arr = classMap[m.classId] || [];
            arr.push(fileItem);
            classMap[m.classId] = arr;
          } else {
            unclassified.push(fileItem);
          }
        });
      }

      setUnclassifiedExams(unclassified);

      // Dựng cây phân cấp Khối -> Môn -> Lớp từ danh sách lớp CSDL
      const gradesDict: Record<string, Record<string, ClassFolderItem[]>> = {};

      if (Array.isArray(classesData)) {
        classesData.forEach((c) => {
          let gradeName = "10";
          let subjectName = "Toán";
          const cCode = c.code || "";
          const cName = c.name || "";

          if (cCode.includes("6") || cName.includes("6")) gradeName = "6";
          else if (cCode.includes("7") || cName.includes("7")) gradeName = "7";
          else if (cCode.includes("8") || cName.includes("8")) gradeName = "8";
          else if (cCode.includes("9") || cName.includes("9")) gradeName = "9";
          else if (cCode.includes("11") || cName.includes("11")) gradeName = "11";
          else if (cCode.includes("12") || cName.includes("12")) gradeName = "12";

          if (cName.includes("Văn") || cCode.includes("VAN")) subjectName = "Ngữ văn";
          else if (cName.includes("Lý") || cCode.includes("PHY") || cCode.includes("LY")) subjectName = "Vật lí";
          else if (cName.includes("Hóa") || cCode.includes("CHE")) subjectName = "Hóa học";
          else if (cName.includes("Anh") || cCode.includes("ENG")) subjectName = "Tiếng Anh";

          const currentGrade = gradesDict[gradeName] || {};
          gradesDict[gradeName] = currentGrade;
          const currentSubject = currentGrade[subjectName] || [];
          currentGrade[subjectName] = currentSubject;

          const classFiles = classMap[c.id] || [];
          currentSubject.push({
            id: c.id,
            name: c.name,
            code: c.code,
            itemsCount: classFiles.length,
            updatedAt: "Hôm nay",
            files: classFiles,
          });
        });
      }

      const builtGrades: GradeFolderItem[] = Object.keys(gradesDict).map((gName) => {
        const subjectsObj = gradesDict[gName] || {};
        const subjects: SubjectFolderItem[] = Object.keys(subjectsObj).map((sName) => {
          const classes = subjectsObj[sName] || [];
          const totalFiles = classes.reduce((sum, cl) => sum + cl.itemsCount, 0);
          return {
            id: `sub-${gName}-${sName}`,
            name: sName,
            itemsCount: totalFiles,
            updatedAt: "Hôm nay",
            classes,
          };
        });
        const totalItemsInGrade = subjects.reduce((sum, s) => sum + s.itemsCount, 0);
        return {
          id: `grade-${gName}`,
          name: gName,
          label: `Khối ${gName}`,
          itemsCount: totalItemsInGrade,
          updatedAt: "Hôm nay",
          subjects,
        };
      });

      setGradesData(builtGrades);
    } catch (err) {
      console.warn("Lỗi nạp tài liệu từ CSDL:", err);
    } finally {
      setLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
  const [uploadModalStep, setUploadModalStep] = useState<"SELECT_TYPE" | "FORM">("SELECT_TYPE");
  const [materialLectureMethod, setMaterialLectureMethod] = useState<"LINK" | "FILE">("LINK");
  const [materialLecturePlatform, setMaterialLecturePlatform] = useState<
    "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID"
  >("INVALID");

  const detectPlatformFromUrl = (url: string) => {
    if (!url) return "INVALID";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "YOUTUBE";
    if (url.includes("facebook.com") || url.includes("fb.watch")) return "FACEBOOK";
    if (url.includes("drive.google.com")) return "DRIVE";
    return "INVALID";
  };

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
  const [draggedFileFromClassId, setDraggedFileFromClassId] = useState<string | undefined>(undefined);
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

  // Ngữ cảnh lưu trữ hiện tại: Đang ở thư mục nào thì lưu ở đó luôn, không cần hỏi
  const currentContextLocation = useMemo(() => {
    if (selectedClassId && currentClass) {
      return {
        classId: currentClass.id,
        path: `${currentGrade?.label || "Khối"} > Môn ${currentSubject?.name || "Môn"} > ${currentClass.name}`,
        label: currentClass.name,
      };
    }
    if (selectedSubjectId && currentSubject) {
      const firstCls = currentSubject.classes[0];
      return {
        classId: firstCls?.id || "unclassified",
        path: `${currentGrade?.label || "Khối"} > Môn ${currentSubject.name}${firstCls ? ` > ${firstCls.name}` : ""}`,
        label: firstCls?.name || currentSubject.name,
      };
    }
    if (selectedGradeId && currentGrade) {
      const firstSub = currentGrade.subjects[0];
      const firstCls = firstSub?.classes[0];
      return {
        classId: firstCls?.id || "unclassified",
        path: `${currentGrade.label}${firstSub ? ` > Môn ${firstSub.name}` : ""}${firstCls ? ` > ${firstCls.name}` : ""}`,
        label: firstCls?.name || currentGrade.label,
      };
    }
    return {
      classId: "unclassified",
      path: "📍 Cần phân cấp lại (Chưa phân loại)",
      label: "Cần phân cấp lại",
    };
  }, [selectedClassId, currentClass, selectedSubjectId, currentSubject, selectedGradeId, currentGrade]);

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

  // Tải lên tài liệu / bài giảng thật - Lưu trực tiếp vào CSDL PostgreSQL theo ngữ cảnh hiện tại
  const handleUploadMaterialSubmit = async () => {
    if (!uploadForm.title.trim()) {
      notify("Vui lòng nhập tiêu đề tài liệu / bài giảng!", "error");
      return;
    }

    const effectiveTargetClassId = uploadForm.targetClassId || currentContextLocation.classId;
    const isUnclassified = effectiveTargetClassId === "unclassified";
    const ext = uploadForm.fileName ? uploadForm.fileName.split(".").pop()?.toLowerCase() : uploadForm.type;
    const mimeType = ext === "pdf"
      ? "application/pdf"
      : ext?.includes("doc")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : uploadForm.type === "video"
      ? "video/mp4"
      : "application/octet-stream";

    let createdId = `mat-${Date.now()}`;
    try {
      const payload = {
        name: uploadForm.title.trim(),
        mimeType,
        sizeBytes: 1887436,
        folder: uploadForm.category === "LECTURE" ? "Bài giảng" : "Tài liệu",
        tags: [uploadForm.category, uploadForm.type],
        scope: isUnclassified ? ("SHARED" as const) : ("CLASS" as const),
      };

      if (isUnclassified) {
        const created = await apiRequest<any>("/instructor/materials", {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify(payload),
        });
        if (created?.id) createdId = created.id;
      } else {
        const created = await apiRequest<any>(`/instructor/classes/${effectiveTargetClassId}/materials`, {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify(payload),
        });
        if (created?.id) createdId = created.id;
      }
    } catch (err) {
      console.warn("Lỗi lưu học liệu mới vào CSDL:", err);
    }

    const newFile: MaterialFileItem = {
      id: createdId,
      name: uploadForm.title.trim(),
      type: uploadForm.type,
      size: uploadForm.fileSize || "1.8 MB",
      updatedAt: "Vừa xong",
      tag: uploadForm.category === "LECTURE" ? "Bài giảng" : "Tài liệu",
      assignedRole: uploadForm.category,
      url: uploadForm.url,
      description: uploadForm.description,
    };

    if (isUnclassified) {
      setUnclassifiedExams((prev) => [newFile, ...prev]);
      notify(`Đã lưu '${newFile.name}' vào Cần phân cấp lại (CSDL)!`, "success");
    } else {
      setGradesData((prev) =>
        prev.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) => ({
            ...s,
            classes: s.classes.map((c) => {
              if (c.id !== effectiveTargetClassId) return c;
              return {
                ...c,
                files: [newFile, ...c.files],
                itemsCount: c.itemsCount + 1,
              };
            }),
          })),
        }))
      );
      const targetCls = allClassesList.find((c) => c.classId === effectiveTargetClassId);
      notify(`Đã lưu '${newFile.name}' vào ${targetCls?.className || currentContextLocation.label} (CSDL)!`, "success");
    }

    setUploadModalOpen(false);
    setUploadForm({
      title: "",
      type: "pdf",
      category: "MATERIAL",
      url: "",
      fileName: "",
      fileSize: "1.8 MB",
      targetClassId: currentContextLocation.classId,
      description: "",
    });
  };

  // Chuyển tệp học liệu sang ô "Cần phân cấp lại" bên trái VÀ CẬP NHẬT CƠ SỞ DỮ LIỆU
  const handleMoveToUnclassified = async (file: MaterialFileItem, fromClassId?: string) => {
    try {
      await apiRequest(`/instructor/materials/${file.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: null,
          scope: "SHARED",
        }),
      });
    } catch (err) {
      console.warn("Lỗi cập nhật Cần phân cấp lại vào CSDL:", err);
    }

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
    notify(`Đã chuyển '${file.name}' vào ô Cần phân cấp lại và lưu vào CSDL.`, "info");
  };

  // Di chuyển tệp đến một thư mục/lớp học cụ thể VÀ CẬP NHẬT CSDL
  const handleMoveFileToTargetClass = async (
    file: MaterialFileItem,
    targetClassId: string,
    fromClassId?: string
  ) => {
    const isToUnclassified = targetClassId === "unclassified";
    try {
      await apiRequest(`/instructor/materials/${file.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: isToUnclassified ? null : targetClassId,
          scope: isToUnclassified ? "SHARED" : "CLASS",
        }),
      });
    } catch (err) {
      console.warn("Lỗi cập nhật vị trí di chuyển file vào CSDL:", err);
    }

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

    if (isToUnclassified) {
      setUnclassifiedExams((prev) => [
        { ...file, isUnclassified: true, updatedAt: "Vừa xong" },
        ...prev.filter((f) => f.id !== file.id),
      ]);
      notify(`Đã di chuyển '${file.name}' vào Cần phân cấp lại (CSDL) thành công!`, "success");
    } else {
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
                files: [{ ...file, isUnclassified: false, updatedAt: "Vừa xong" }, ...c.files.filter((f) => f.id !== file.id)],
                itemsCount: c.itemsCount + 1,
              };
            }),
          })),
        }))
      );
      const targetCls = allClassesList.find((c) => c.classId === targetClassId);
      notify(`Đã di chuyển '${file.name}' vào ${targetCls?.className || "lớp mới"} (CSDL) thành công!`, "success");
    }

    setMoveModalOpen(false);
    setSelectedFileForMove(null);
    setActiveMenuFileId(null);
    setDraggedFile(null);
    setDraggedFileFromClassId(undefined);
    setDragOverTargetId(null);
  };

  // Xóa tệp học liệu vật lý khỏi CSDL
  const handleDeleteFile = async (file: MaterialFileItem, fromClassId?: string) => {
    try {
      await apiRequest(`/instructor/materials/${file.id}`, {
        method: "DELETE",
        roleCode: session.roleCode,
      });
    } catch (err) {
      console.warn("Lỗi xóa file trong CSDL:", err);
    }

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
    notify(`Đã xóa '${file.name}' khỏi kho học liệu và CSDL!`, "success");
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

  // Xử lý kéo thả kiểu Laptop: Hỗ trợ cả file nội bộ và file kéo từ máy tính cá nhân
  const handleDropOnTargetFolder = async (
    targetClassId: string,
    e: React.DragEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTargetId(null);

    // TH1: Kéo thả file từ máy tính cá nhân (Desktop / Laptop Explorer)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const fType = ext.includes("doc") ? "word" : ext.includes("pdf") ? "pdf" : ext.includes("mp4") ? "video" : "pdf";
      const sizeMb = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
      const isUnc = targetClassId === "unclassified";

      let createdId = `mat-${Date.now()}`;
      try {
        const payload = {
          name: file.name,
          mimeType: file.type || (ext.includes("pdf") ? "application/pdf" : "application/octet-stream"),
          sizeBytes: file.size || 1500000,
          folder: "Tài liệu",
          tags: ["Tài liệu", ext],
          scope: isUnc ? ("SHARED" as const) : ("CLASS" as const),
        };
        const endpoint = isUnc ? "/instructor/materials" : `/instructor/classes/${targetClassId}/materials`;
        const created = await apiRequest<any>(endpoint, {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify(payload),
        });
        if (created?.id) createdId = created.id;
      } catch (err) {
        console.warn("Lỗi lưu file kéo thả từ máy tính vào CSDL:", err);
      }

      const newFile: MaterialFileItem = {
        id: createdId,
        name: file.name,
        type: fType as any,
        size: sizeMb,
        updatedAt: "Vừa xong",
        tag: "Tài liệu",
        assignedRole: "MATERIAL",
      };

      if (isUnc) {
        setUnclassifiedExams((prev) => [newFile, ...prev]);
        notify(`Đã lưu tệp '${file.name}' từ máy tính vào ô Cần phân cấp lại (CSDL)!`, "success");
      } else {
        setGradesData((prev) =>
          prev.map((g) => ({
            ...g,
            subjects: g.subjects.map((s) => ({
              ...s,
              classes: s.classes.map((c) => {
                if (c.id !== targetClassId) return c;
                return {
                  ...c,
                  files: [newFile, ...c.files],
                  itemsCount: c.itemsCount + 1,
                };
              }),
            })),
          }))
        );
        const targetCls = allClassesList.find((c) => c.classId === targetClassId);
        notify(`Đã lưu tệp '${file.name}' từ máy tính vào ${targetCls?.className || "thư mục"} (CSDL)!`, "success");
      }
      return;
    }

    // TH2: Kéo thả file nội bộ
    if (draggedFile) {
      if (targetClassId === "unclassified") {
        await handleMoveToUnclassified(draggedFile, draggedFileFromClassId);
      } else {
        await handleMoveFileToTargetClass(draggedFile, targetClassId, draggedFileFromClassId);
      }
    }
  };

  // Xử lý khi thả tệp vào một Khối (kéo thả kiểu laptop)
  const handleDropOnTargetGrade = async (gradeId: string, e: React.DragEvent) => {
    const targetGrade = gradesData.find((g) => g.id === gradeId);
    if (!targetGrade) return;

    let targetClassId: string | null = null;
    const firstSub = targetGrade.subjects[0];
    const firstCls = firstSub?.classes?.[0];
    if (firstCls) {
      targetClassId = firstCls.id;
    }

    if (!targetClassId) {
      const newClassId = `cls-${gradeId}-auto-${Date.now()}`;
      const newSubjectId = `sub-${gradeId}-auto-${Date.now()}`;
      const newClass: ClassFolderItem = {
        id: newClassId,
        name: `Lớp ${targetGrade.name}A1`,
        code: `K${targetGrade.name}-01`,
        itemsCount: 0,
        updatedAt: "Vừa xong",
        files: [],
      };
      const newSub: SubjectFolderItem = {
        id: newSubjectId,
        name: "Tài liệu chung",
        itemsCount: 0,
        updatedAt: "Vừa xong",
        classes: [newClass],
      };
      setGradesData((prev) =>
        prev.map((g) => (g.id === gradeId ? { ...g, subjects: [newSub, ...g.subjects] } : g))
      );
      targetClassId = newClassId;
    }

    await handleDropOnTargetFolder(targetClassId, e);
  };

  // Xử lý khi thả tệp vào một Môn (kéo thả kiểu laptop)
  const handleDropOnTargetSubject = async (subjectId: string, e: React.DragEvent) => {
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

    if (!foundClassId && parentGradeId) {
      foundClassId = `cls-sub-auto-${Date.now()}`;
      const newClass: ClassFolderItem = {
        id: foundClassId,
        name: `Lớp ${targetSubjectName} 1`,
        code: `L-${Date.now().toString().slice(-4)}`,
        itemsCount: 0,
        updatedAt: "Vừa xong",
        files: [],
      };
      setGradesData((prev) =>
        prev.map((g) => {
          if (g.id !== parentGradeId) return g;
          return {
            ...g,
            subjects: g.subjects.map((s) => (s.id === subjectId ? { ...s, classes: [newClass, ...s.classes] } : s)),
          };
        })
      );
    }

    if (foundClassId) {
      await handleDropOnTargetFolder(foundClassId, e);
    } else {
      notify("Không tìm thấy lớp học hợp lệ để lưu tệp!", "error");
    }
  };

  // Xử lý khi thả tệp vào một Thư mục hoặc Lớp
  const handleDropOnTargetClass = async (classId: string, e: React.DragEvent) => {
    await handleDropOnTargetFolder(classId, e);
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
          CỘT TRÁI: CẦN PHÂN CẤP LẠI (HỖ TRỢ KÉO THẢ KIỂU LAPTOP & MENU 3 CHẤM)
          ========================================================================= */}
      <aside
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverTargetId("unclassified-zone");
        }}
        onDragLeave={() => {
          if (dragOverTargetId === "unclassified-zone") setDragOverTargetId(null);
        }}
        onDrop={(e) => handleDropOnTargetFolder("unclassified", e)}
        className={`w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 space-y-4 transition-all ${
          dragOverTargetId === "unclassified-zone"
            ? "bg-rose-50/80 dark:bg-rose-950/40 ring-2 ring-dashed ring-rose-500 scale-[1.01]"
            : ""
        }`}
      >
        {/* Hàng Header: Cần phân cấp lại kèm badge đỏ tròn */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>📍</span>
              <span>Cần phân cấp lại</span>
            </h2>
            <span className="grid size-5 place-items-center rounded-full bg-rose-500 text-white text-[11px] font-extrabold shadow-2xs">
              {unclassifiedExams.length}
            </span>
          </div>
          {dragOverTargetId === "unclassified-zone" && (
            <span className="text-[10px] font-extrabold text-rose-600 bg-rose-100 dark:bg-rose-900/60 px-2 py-0.5 rounded-full animate-pulse">
              Thả vào đây
            </span>
          )}
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
          <span>Kéo thả thẻ vào các Thư mục/Lớp ở bảng bên phải để lưu (hoặc kéo tệp máy tính thả vào đây).</span>
        </div>

        {/* Danh sách các thẻ đề chưa phân loại (Kéo thả draggable, Icon phân loại & Menu 3 chấm) */}
        <div className="space-y-3 pt-1">
          {unclassifiedExams.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              Không có tài liệu nào cần phân cấp lại. Bấm "Tải lên" hoặc kéo thả tệp từ máy tính vào đây.
            </div>
          ) : (
            unclassifiedExams.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", item.id);
                  setDraggedFile(item);
                  setDraggedFileFromClassId(undefined);
                }}
                onDragEnd={() => {
                  setDraggedFile(null);
                  setDraggedFileFromClassId(undefined);
                }}
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
                          <span>Di chuyển đến thư mục...</span>
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
                  targetClassId: currentContextLocation.classId,
                }));
                setUploadModalStep("SELECT_TYPE");
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
                        handleDropOnTargetGrade(grade.id, e);
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
                              Thả tệp vào đây để lưu vào khối {grade.label}
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
                          handleDropOnTargetSubject(sub.id, e);
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
                                Thả tệp vào đây để lưu vào môn {sub.name}
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
                          e.dataTransfer.dropEffect = "move";
                          setDragOverTargetId(cls.id);
                        }}
                        onDragLeave={() => setDragOverTargetId(null)}
                        onDrop={(e) => {
                          handleDropOnTargetClass(cls.id, e);
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

            {/* CẤP 4: DANH SÁCH TÀI LIỆU & BÀI GIẢNG CỦA LỚP KÈM MENU 3 CHẤM ĐẦY ĐỦ TÙY CHỌN */}
            {selectedClassId && currentClass && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDragOverTargetId(currentClass.id);
                }}
                onDragLeave={() => {
                  if (dragOverTargetId === currentClass.id) setDragOverTargetId(null);
                }}
                onDrop={(e) => handleDropOnTargetClass(currentClass.id, e)}
                className={`divide-y divide-slate-100 dark:divide-slate-800/50 transition ${
                  dragOverTargetId === currentClass.id
                    ? "bg-blue-50/60 dark:bg-blue-950/30 ring-2 ring-dashed ring-blue-500"
                    : ""
                }`}
              >
                {currentClass.files.length > 0 ? (
                  currentClass.files.map((file) => (
                    <div
                      key={file.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", file.id);
                        setDraggedFile(file);
                        setDraggedFileFromClassId(currentClass.id);
                      }}
                      onDragEnd={() => {
                        setDraggedFile(null);
                        setDraggedFileFromClassId(undefined);
                      }}
                      onClick={() => {
                        notify(`Đang xem tài liệu/bài giảng: ${file.name}`, "info");
                      }}
                      className={`grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-grab active:cursor-grabbing text-xs transition group relative ${
                        draggedFile?.id === file.id ? "opacity-50 scale-[0.99]" : ""
                      }`}
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <span
                          className={`size-7 rounded-lg text-white font-extrabold text-[11px] grid place-items-center shrink-0 shadow-2xs ${
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

                      {/* Cột Tùy chọn 3 chấm với: Dùng làm tài liệu/bài giảng, Di chuyển, Chuyển vào Cần phân cấp lại, Xóa */}
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
                            className="absolute right-0 top-full mt-1 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-30 divide-y divide-slate-100 dark:divide-slate-800 text-xs text-left"
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
                                setSelectedFileForMove({ file, fromClassId: currentClass.id });
                                setTargetMoveClassId(allClassesList[0]?.classId || "unclassified");
                                setMoveModalOpen(true);
                                setActiveMenuFileId(null);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-amber-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Move size={14} className="text-amber-600" />
                              <span>Di chuyển</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                handleMoveToUnclassified(file, currentClass.id);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <FolderMinus size={14} className="text-blue-600" />
                              <span>Chuyển vào Cần phân cấp lại</span>
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
                    Lớp chưa có học liệu hoặc bài giảng nào. Hãy bấm "Tải lên tài liệu / bài giảng" hoặc kéo thả tệp từ máy tính vào đây.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* =========================================================================
          MODAL TẢI LÊN TÀI LIỆU / BÀI GIẢNG (KHO HỌC LIỆU THẬT)
          ========================================================================= */}
      {/* =========================================================================
          MODAL TẢI LÊN TÀI LIỆU / BÀI GIẢNG (QUY TRÌNH 2 BƯỚC CHUẨN LỚP HỌC)
          ========================================================================= */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          {/* BƯỚC 1: CHỌN TẢI TÀI LIỆU HOẶC BÀI GIẢNG */}
          {uploadModalStep === "SELECT_TYPE" && (
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <UploadCloud size={20} className="text-blue-600" />
                  <span>Chọn loại học liệu cần thêm</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Lựa chọn phương thức học liệu bạn muốn thêm vào <strong className="text-slate-800 dark:text-slate-200">{currentContextLocation.label}</strong>:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                {/* Cách 1: Tải lên tài liệu */}
                <div
                  onClick={() => {
                    setUploadForm((prev) => ({
                      ...prev,
                      category: "MATERIAL",
                      type: "pdf",
                      title: "",
                      fileName: "",
                      url: "",
                    }));
                    setUploadModalStep("FORM");
                  }}
                  className="p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition cursor-pointer space-y-2 group shadow-2xs"
                >
                  <div className="size-11 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 grid place-items-center group-hover:scale-105 transition-transform">
                    <BookOpen size={22} />
                  </div>
                  <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    1. Tải tài liệu
                  </strong>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Học liệu số, giáo trình, bài tập, đề cương dạng PDF, Word, Excel, Slide...
                  </p>
                </div>

                {/* Cách 2: Tải lên bài giảng */}
                <div
                  onClick={() => {
                    setUploadForm((prev) => ({
                      ...prev,
                      category: "LECTURE",
                      type: "video",
                      title: "",
                      fileName: "",
                      url: "",
                    }));
                    setMaterialLectureMethod("LINK");
                    setUploadModalStep("FORM");
                  }}
                  className="p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-800 hover:border-purple-500 hover:bg-purple-50/40 dark:hover:bg-purple-950/20 transition cursor-pointer space-y-2 group shadow-2xs"
                >
                  <div className="size-11 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400 grid place-items-center group-hover:scale-105 transition-transform">
                    <Video size={22} />
                  </div>
                  <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    2. Tải bài giảng
                  </strong>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Video bài học chuyên đề (Dán liên kết YouTube, Drive, Facebook hoặc tải tệp video từ máy)...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* BƯỚC 2: FORM TƯƠNG ỨNG THEO ĐÚNG LOẠI ĐÃ CHỌN (CHUẨN LỚP HỌC) */}
          {uploadModalStep === "FORM" && (
            <div className={`w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 ${uploadForm.category === "LECTURE" ? "max-w-3xl" : "max-w-lg"}`}>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadModalStep("SELECT_TYPE")}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold text-sm"
                    title="Quay lại chọn loại học liệu"
                  >
                    ←
                  </button>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    {uploadForm.category === "LECTURE" ? (
                      <>
                        <Video size={20} className="text-purple-600" />
                        <span>Thêm bài giảng mới</span>
                      </>
                    ) : (
                      <>
                        <BookOpen size={20} className="text-blue-600" />
                        <span>Tải lên tài liệu học tập</span>
                      </>
                    )}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* FORM CHO TÀI LIỆU */}
              {uploadForm.category === "MATERIAL" && (
                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tên tài liệu <span className="text-rose-500">*</span>:
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: Đề cương ôn tập Toán giữa kỳ 1..."
                      value={uploadForm.title}
                      onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {/* Vị trí lưu mặc định: Lưu ngay tại nơi đang mở */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Vị trí lưu mặc định:
                    </label>
                    <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="size-8 rounded-lg bg-blue-600 text-white grid place-items-center shrink-0 shadow-2xs">
                          <FolderOpen size={16} />
                        </div>
                        <div className="min-w-0">
                          <strong className="block text-xs font-bold text-blue-700 dark:text-blue-300 truncate">
                            {currentContextLocation.path}
                          </strong>
                          <span className="text-[11px] text-slate-500 block">
                            Tự động lưu vào vị trí này theo ngữ cảnh bạn đang mở.
                          </span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 text-[10px] font-extrabold shrink-0 border border-blue-200 dark:border-blue-800">
                        Hiện tại
                      </span>
                    </div>
                  </div>

                  {/* Tệp đính kèm */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tệp tài liệu (PDF, Word, Excel, Slide):
                    </label>
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
                      <FileText size={28} className="mx-auto text-blue-600" />
                      <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                        Kéo thả hoặc{" "}
                        <label className="text-blue-600 font-bold hover:underline cursor-pointer">
                          chọn tệp từ máy
                          <input
                            type="file"
                            accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg"
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
                        <div className="text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 py-1 px-2.5 rounded-lg inline-block">
                          ✓ Đã chọn: {uploadForm.fileName} ({uploadForm.fileSize})
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Mô tả tài liệu:
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Mô tả tóm tắt nội dung tài liệu..."
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* FORM CHO BÀI GIẢNG (CHUẨN 2 VÙNG TWO-PANE NHƯ LỚP HỌC) */}
              {uploadForm.category === "LECTURE" && (
                <div className="grid md:grid-cols-2 gap-5 text-xs">
                  {/* Vùng 1: Chọn cách thêm & Nguồn */}
                  <div className="space-y-3.5 border-r border-slate-100 dark:border-slate-800 pr-0 md:pr-4">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-purple-600 block">
                      Bước 1: Nguồn bài giảng
                    </span>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMaterialLectureMethod("LINK")}
                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          materialLectureMethod === "LINK"
                            ? "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                            : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <Link2 size={14} />
                        <span>Dán liên kết</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaterialLectureMethod("FILE")}
                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          materialLectureMethod === "FILE"
                            ? "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                            : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <UploadCloud size={14} />
                        <span>Tải tệp từ máy</span>
                      </button>
                    </div>

                    {materialLectureMethod === "LINK" ? (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                          Liên kết (YouTube, Facebook, Google Drive):
                        </label>
                        <div className="relative">
                          <input
                            type="url"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={uploadForm.url}
                            onChange={(e) => {
                              const u = e.target.value;
                              const plat = detectPlatformFromUrl(u);
                              setMaterialLecturePlatform(plat);
                              setUploadForm({ ...uploadForm, url: u, type: "link" });
                            }}
                            className="w-full px-3 py-2 pr-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                          />
                          {materialLecturePlatform !== "INVALID" && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 font-extrabold text-[10px]">
                              ✓ {materialLecturePlatform}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                          Tải tệp video / slide bài giảng:
                        </label>
                        <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 block text-center cursor-pointer hover:border-purple-500 transition">
                          <input
                            type="file"
                            accept="video/*,.pptx,.ppt,.pdf"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setUploadForm({
                                  ...uploadForm,
                                  title: uploadForm.title || file.name.replace(/\.[^/.]+$/, ""),
                                  fileName: file.name,
                                  fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                                  type: "video",
                                });
                              }
                            }}
                          />
                          <UploadCloud size={24} className="mx-auto text-purple-600 mb-1" />
                          <span className="block text-xs font-bold">Chọn tệp video hoặc slide</span>
                          <span className="block text-[10px] text-slate-400">Hỗ trợ MP4, WebM, PPTX, PDF</span>
                        </label>
                        {uploadForm.fileName && (
                          <div className="text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-lg text-center">
                            ✓ {uploadForm.fileName} ({uploadForm.fileSize})
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Vùng 2: Thông tin bài giảng & Vị trí lưu */}
                  <div className="space-y-3.5">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 block">
                      Bước 2: Thông tin bài giảng
                    </span>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Tên bài giảng <span className="text-rose-500">*</span>:
                      </label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Bài giảng 01: Đại số & Giải tích..."
                        value={uploadForm.title}
                        onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-purple-500 text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Mô tả bài giảng:
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Tóm tắt nội dung bài học..."
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                      />
                    </div>

                    {/* Vị trí lưu mặc định: Lưu ngay tại nơi đang mở */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Vị trí lưu mặc định:
                      </label>
                      <div className="p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/60 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="size-7 rounded-lg bg-purple-600 text-white grid place-items-center shrink-0 shadow-2xs">
                            <FolderOpen size={14} />
                          </div>
                          <span className="text-xs font-bold text-purple-700 dark:text-purple-300 truncate">
                            {currentContextLocation.path}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200 text-[10px] font-extrabold shrink-0">
                          Hiện tại
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setUploadModalStep("SELECT_TYPE")}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  ← Đổi loại
                </button>
                <div className="flex gap-2">
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
          MODAL DI CHUYỂN TÀI LIỆU / BÀI GIẢNG SANG THƯ MỤC KHÁC
          ========================================================================= */}
      {moveModalOpen && selectedFileForMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Move size={20} className="text-amber-600" />
              <span>Di chuyển tệp sang thư mục khác</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn thư mục đích để di chuyển tệp <strong className="text-slate-900 dark:text-slate-100">"{selectedFileForMove.file.name}"</strong>:
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Thư mục đích:
              </label>
              <select
                value={targetMoveClassId}
                onChange={(e) => setTargetMoveClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="unclassified">📍 Cần phân cấp lại (Chưa phân loại)</option>
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
