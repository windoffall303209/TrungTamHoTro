"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid,
  List as ListIcon,
  MoreVertical,
  Move,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { Modal, Pagination } from "@/shared/ui/ui";
import { useServerPagination } from "@/shared/hooks/use-server-pagination";
import { InlineFilePreview } from "@/features/academic/inline-file-preview";
import { apiRequest, downloadApiFile } from "@/lib/api-client";
import {
  loadMaterialSummary,
  searchMaterialsPage,
  type MaterialSummaryBucket,
} from "@/lib/materials";
import type { LearningClass, Material } from "@/lib/learning-types";

export type FolderKind = "materials" | "lectures";

export interface ClassFoldersResponse {
  materials: string[];
  lectures: string[];
  assignments: string[];
}

export interface FolderEntry {
  kind: FolderKind;
  name: string;
}

export interface MaterialFileItem {
  id: string;
  classId: string;
  name: string;
  mimeType: string;
  type: "word" | "pdf" | "image" | "video" | "slide";
  size: string;
  updatedAt: string;
  folder: string;
  kind: FolderKind;
  visibility: "PUBLISHED" | "HIDDEN";
  tags: string[];
}

interface ClassTreeItem {
  id: string;
  courseId: string;
  name: string;
  code: string;
  status: LearningClass["status"];
  instructorIds: string[];
  itemsCount: number;
}

interface SubjectTreeItem {
  id: string;
  name: string;
  itemsCount: number;
  classes: ClassTreeItem[];
}

export interface GradeTreeItem {
  id: string;
  name: string;
  label: string;
  itemsCount: number;
  subjects: SubjectTreeItem[];
}

// Khớp quy tắc phân loại bài giảng và tài liệu trên máy chủ.
function isLectureContent(tags: readonly string[], mimeType = ""): boolean {
  return (
    /^(audio|video)\//.test(mimeType) ||
    tags.some((tag) => /lecture|video|bài giảng/i.test(tag))
  );
}

// Hiển thị dung lượng tệp từ số byte thật do API trả về.
function formatMaterialSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Không rõ";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Phân loại biểu tượng theo MIME và phần mở rộng của tên tệp thật.
function getMaterialFileType(name: string, mimeType = ""): MaterialFileItem["type"] {
  const extension = name.split(".").pop()?.toLowerCase();
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg"].includes(extension ?? "")) return "image";
  if (mimeType.startsWith("video/") || extension === "mp4" || mimeType === "text/uri-list") return "video";
  if (extension === "ppt" || extension === "pptx") return "slide";
  if (extension === "doc" || extension === "docx") return "word";
  return "pdf";
}

// Định dạng mốc thời gian cập nhật học liệu theo ngôn ngữ hiển thị hiện hành.
function formatMaterialUpdatedAt(
  raw: string,
  locale: string,
  translate: (value: string) => string,
): string {
  if (!raw) return translate("Hôm nay");
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString(locale);
}

// Suy ra tên khối hiển thị từ thông tin lớp khi dữ liệu chưa tách riêng trường grade.
function resolveGradeName(cls: LearningClass): string {
  if (cls.grade != null) return String(cls.grade);
  const combined = `${cls.code || ""} ${cls.name || ""}`;
  for (const grade of ["12", "11", "10", "9", "8", "7", "6"]) {
    if (combined.includes(grade)) return grade;
  }
  return "Khác";
}

// Suy ra tên môn hiển thị từ thông tin lớp khi trường subject đang trống.
function resolveSubjectName(cls: LearningClass): string {
  if (cls.subject?.trim()) return cls.subject.trim();
  const cName = cls.name || "";
  const cCode = cls.code || "";
  if (cName.includes("Văn") || cCode.includes("VAN")) return "Ngữ văn";
  if (cName.includes("Lý") || cCode.includes("PHY") || cCode.includes("LY")) return "Vật lí";
  if (cName.includes("Hóa") || cCode.includes("CHE")) return "Hóa học";
  if (cName.includes("Anh") || cCode.includes("ENG")) return "Tiếng Anh";
  return "Môn chung";
}

// Định dạng nhãn môn học tránh lặp chữ "Môn" khi tên mặc định đã có tiền tố.
function formatSubjectLabel(subjectName: string): string {
  return subjectName.startsWith("Môn ") ? subjectName : `Môn ${subjectName}`;
}

// Ánh xạ bản ghi học liệu từ API phân trang sang dòng tệp hiển thị trên UI.
function mapMaterialToFileItem(m: Material & { title?: string }): MaterialFileItem {
  const rawName = m.name || m.title || "Tài liệu học tập";
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const kind: FolderKind = isLectureContent(tags, m.mimeType) ? "lectures" : "materials";
  return {
    id: m.id,
    classId: m.classId ?? "",
    name: rawName,
    mimeType: m.mimeType,
    type: getMaterialFileType(rawName, m.mimeType),
    size: formatMaterialSize(m.sizeBytes),
    updatedAt: m.createdAt ?? "",
    folder: m.folder || (kind === "lectures" ? "Bài giảng chung" : "Tài liệu chung"),
    kind,
    visibility: m.visibility === "HIDDEN" ? "HIDDEN" : "PUBLISHED",
    tags,
  };
}

// Dựng cây phân cấp Khối -> Môn -> Lớp từ dữ liệu lớp và thống kê tổng hợp từ DB.
function buildGradeTree(
  classesData: LearningClass[],
  summaryBuckets: MaterialSummaryBucket[],
): { grades: GradeTreeItem[]; allClasses: ClassTreeItem[] } {
  const classCountMap = new Map<string, number>();
  for (const bucket of summaryBuckets) {
    classCountMap.set(bucket.classId, (classCountMap.get(bucket.classId) ?? 0) + bucket.count);
  }

  const gradesDict: Record<string, Record<string, ClassTreeItem[]>> = {};
  const allClasses: ClassTreeItem[] = [];
  for (const c of classesData) {
    const gradeName = resolveGradeName(c);
    const subjectName = resolveSubjectName(c);
    const classItem: ClassTreeItem = {
      id: c.id,
      courseId: c.courseId,
      name: c.name,
      code: c.code,
      status: c.status,
      instructorIds: Array.isArray(c.instructorIds) ? c.instructorIds : [],
      itemsCount: classCountMap.get(c.id) ?? 0,
    };
    allClasses.push(classItem);
    gradesDict[gradeName] = gradesDict[gradeName] ?? {};
    gradesDict[gradeName][subjectName] = gradesDict[gradeName][subjectName] ?? [];
    gradesDict[gradeName][subjectName].push(classItem);
  }

  const grades: GradeTreeItem[] = Object.keys(gradesDict)
    .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }))
    .map((gName) => {
      const subjectsObj = gradesDict[gName] ?? {};
      const subjects: SubjectTreeItem[] = Object.keys(subjectsObj)
        .sort((a, b) => a.localeCompare(b, "vi"))
        .map((sName) => {
          const classes = (subjectsObj[sName] ?? []).sort((a, b) => a.name.localeCompare(b.name, "vi"));
          return {
            id: `sub-${gName}-${sName}`,
            name: sName,
            itemsCount: classes.reduce((sum, cl) => sum + cl.itemsCount, 0),
            classes,
          };
        });
      return {
        id: `grade-${gName}`,
        name: gName,
        label: gName === "Khác" ? "Khối khác" : `Khối ${gName}`,
        itemsCount: subjects.reduce((sum, s) => sum + s.itemsCount, 0),
        subjects,
      };
    });

  return { grades, allClasses };
}

/** Trang Học liệu trên thanh điều hướng ngang: Khối → Môn → Lớp → Thư mục → Tệp. */
export function InstructorMaterialsView() {
  const { session, notify } = useApp();
  const { t, locale } = useI18n();
  const [gradesData, setGradesData] = useState<GradeTreeItem[]>([]);
  const [allClasses, setAllClasses] = useState<ClassTreeItem[]>([]);
  const [summaryBuckets, setSummaryBuckets] = useState<MaterialSummaryBucket[]>([]);
  const [folderFiles, setFolderFiles] = useState<MaterialFileItem[]>([]);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadRequestRef = useRef(0);
  const filesRequestRef = useRef(0);
  const filePagination = useServerPagination(20);
  const { page: filePage, pageSize: filePageSize, syncResponse: syncFilePage } = filePagination;

  // Điều hướng 5 cấp: Khối → Môn → Lớp → Thư mục → Tệp
  const [selectedGradeId, setSelectedGradeId] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<FolderEntry | null>(null);

  // Thư mục 1 cấp của lớp đang chọn theo bảng class_folders
  const [classFolders, setClassFolders] = useState<ClassFoldersResponse>({
    materials: [],
    lectures: [],
    assignments: [],
  });
  const [foldersLoading, setFoldersLoading] = useState(false);

  // Tìm kiếm & chế độ hiển thị
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [activeMenuFileId, setActiveMenuFileId] = useState<string | null>(null);

  // Modal tạo thư mục mới ở cấp Lớp
  const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderKind, setNewFolderKind] = useState<FolderKind>("materials");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Modal tải tệp vào đúng lớp và thư mục đang mở
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadVisibility, setUploadVisibility] = useState<"PUBLISHED" | "HIDDEN">("PUBLISHED");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Modal chỉnh sửa metadata hoặc thay tệp đơn lẻ
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<MaterialFileItem | null>(null);
  const [editingFile, setEditingFile] = useState<MaterialFileItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editVisibility, setEditVisibility] = useState<"PUBLISHED" | "HIDDEN">("PUBLISHED");
  const [replaceFileObj, setReplaceFileObj] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Modal di chuyển tệp sang lớp/thư mục khác thuộc quyền giảng dạy
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [movingFile, setMovingFile] = useState<MaterialFileItem | null>(null);
  const [moveTargetClassId, setMoveTargetClassId] = useState("");
  const [moveTargetFolder, setMoveTargetFolder] = useState("");
  const [moveTargetFolders, setMoveTargetFolders] = useState<string[]>([]);
  const [loadingMoveFolders, setLoadingMoveFolders] = useState(false);
  const [savingMove, setSavingMove] = useState(false);

  // Nạp danh sách lớp và thống kê học liệu tổng hợp (GROUP BY SQL) mà không tải toàn bộ bảng materials.
  const loadData = useCallback(async (): Promise<boolean> => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const classesPath =
        session.roleCode === "INSTRUCTOR"
          ? "/instructor/classes"
          : session.roleCode === "LEARNER"
            ? "/learner/classes"
            : "/classes";
      const [classesData, summaryData] = await Promise.all([
        apiRequest<LearningClass[]>(classesPath, { roleCode: session.roleCode }),
        loadMaterialSummary({ roleCode: session.roleCode }),
      ]);
      if (requestId !== loadRequestRef.current) return false;
      const safeClasses = Array.isArray(classesData) ? classesData : [];
      const safeSummary = Array.isArray(summaryData) ? summaryData : [];
      const tree = buildGradeTree(safeClasses, safeSummary);
      setSummaryBuckets(safeSummary);
      setGradesData(tree.grades);
      setAllClasses(tree.allClasses);
      return true;
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        notify(err instanceof Error ? err.message : "Không thể tải danh sách học liệu.", "error");
      }
      return false;
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [notify, session.roleCode]);

  useEffect(() => {
    void loadData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadData]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setDebouncedSearch("");
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(trimmed), 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Nạp một trang tệp thuộc đúng lớp, loại nội dung và thư mục đang mở từ máy chủ.
  const loadFolderFiles = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedClassId || !selectedFolder) {
        setFolderFiles([]);
        return;
      }
      const requestId = ++filesRequestRef.current;
      setFolderFilesLoading(true);
      try {
        const result = await searchMaterialsPage<Material & { title?: string }>(
          {
            classId: selectedClassId,
            folder: selectedFolder.name,
            folderExact: true,
            kind: selectedFolder.kind,
            query: debouncedSearch || undefined,
            page: filePage,
            pageSize: filePageSize,
          },
          { roleCode: session.roleCode, signal },
        );
        if (requestId !== filesRequestRef.current || signal?.aborted) return;
        setFolderFiles(result.items.map(mapMaterialToFileItem));
        syncFilePage(result);
      } catch (err) {
        if (requestId === filesRequestRef.current && !signal?.aborted) {
          setFolderFiles([]);
          notify(err instanceof Error ? err.message : "Không thể tải danh sách học liệu.", "error");
        }
      } finally {
        if (requestId === filesRequestRef.current && !signal?.aborted) {
          setFolderFilesLoading(false);
        }
      }
    },
    [
      debouncedSearch,
      filePage,
      filePageSize,
      notify,
      selectedClassId,
      selectedFolder,
      session.roleCode,
      syncFilePage,
    ],
  );

  useEffect(() => {
    if (!selectedClassId || !selectedFolder) {
      filesRequestRef.current += 1;
      setFolderFiles([]);
      setFolderFilesLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadFolderFiles(controller.signal);
    return () => {
      filesRequestRef.current += 1;
      controller.abort();
    };
  }, [selectedClassId, selectedFolder, loadFolderFiles]);

  // Nạp thư mục một cấp từ class_folders khi người dùng chọn một lớp cụ thể
  const loadFoldersForClass = useCallback(
    async (classId: string, signal?: AbortSignal) => {
      setFoldersLoading(true);
      try {
        const res = await apiRequest<ClassFoldersResponse>(
          `/classes/${encodeURIComponent(classId)}/folders`,
          { roleCode: session.roleCode, signal },
        );
        if (!signal?.aborted) {
          setClassFolders({
            materials: Array.isArray(res?.materials) ? res.materials : [],
            lectures: Array.isArray(res?.lectures) ? res.lectures : [],
            assignments: Array.isArray(res?.assignments) ? res.assignments : [],
          });
        }
      } catch (err) {
        if (!signal?.aborted) {
          setClassFolders({ materials: [], lectures: [], assignments: [] });
          notify(err instanceof Error ? err.message : "Không tải được thư mục của lớp.", "error");
        }
      } finally {
        if (!signal?.aborted) setFoldersLoading(false);
      }
    },
    [notify, session.roleCode],
  );

  useEffect(() => {
    if (!selectedClassId) {
      setClassFolders({ materials: [], lectures: [], assignments: [] });
      setSelectedFolder(null);
      return;
    }
    const controller = new AbortController();
    void loadFoldersForClass(selectedClassId, controller.signal);
    return () => controller.abort();
  }, [selectedClassId, loadFoldersForClass]);

  const currentGrade = useMemo(
    () => gradesData.find((g) => g.id === selectedGradeId) ?? null,
    [gradesData, selectedGradeId],
  );

  const currentSubject = useMemo(
    () => currentGrade?.subjects.find((s) => s.id === selectedSubjectId) ?? null,
    [currentGrade, selectedSubjectId],
  );

  const currentClass = useMemo(
    () => currentSubject?.classes.find((c) => c.id === selectedClassId) ?? null,
    [currentSubject, selectedClassId],
  );

  // Chỉ giảng viên được phân công trong class_instructors của lớp chưa đóng mới có quyền ghi
  const canManageClass = useCallback(
    (cls: ClassTreeItem | null): boolean =>
      Boolean(
        cls &&
          session.roleCode === "INSTRUCTOR" &&
          cls.status !== "CLOSED" &&
          cls.instructorIds.includes(session.user.id),
      ),
    [session.roleCode, session.user.id],
  );

  const canManageCurrentClass = canManageClass(currentClass);
  const canUploadInOpenFolder = Boolean(currentClass && selectedFolder && canManageCurrentClass);

  // Danh sách các lớp giảng viên đang phụ trách (chưa đóng) để chọn khi di chuyển tệp
  const movableClasses = useMemo(
    () => allClasses.filter((cls) => canManageClass(cls)),
    [allClasses, canManageClass],
  );

  // Danh sách thư mục 1 cấp của lớp hiện tại kèm số lượng tệp đúng loại nội dung từ summary
  const currentClassFolderItems = useMemo(() => {
    if (!currentClass) return [];
    const bucketCount = new Map<string, number>();
    for (const bucket of summaryBuckets) {
      if (bucket.classId === currentClass.id) {
        bucketCount.set(`${bucket.kind}\u0000${bucket.folder}`, bucket.count);
      }
    }
    const items: Array<FolderEntry & { count: number }> = [];
    for (const name of classFolders.materials) {
      items.push({
        kind: "materials",
        name,
        count: bucketCount.get(`materials\u0000${name}`) ?? 0,
      });
    }
    for (const name of classFolders.lectures) {
      items.push({
        kind: "lectures",
        name,
        count: bucketCount.get(`lectures\u0000${name}`) ?? 0,
      });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [currentClass, classFolders, summaryBuckets]);

  // Tải danh sách thư mục hợp lệ cho lớp đích trong modal Di chuyển
  useEffect(() => {
    if (!moveModalOpen || !movingFile || !moveTargetClassId) {
      setMoveTargetFolders([]);
      setMoveTargetFolder("");
      return;
    }
    const controller = new AbortController();
    setLoadingMoveFolders(true);
    apiRequest<ClassFoldersResponse>(`/classes/${encodeURIComponent(moveTargetClassId)}/folders`, {
      roleCode: session.roleCode,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        const candidates = movingFile.kind === "lectures" ? res.lectures : res.materials;
        setMoveTargetFolders(candidates);
        setMoveTargetFolder((prev) =>
          candidates.includes(prev) ? prev : (candidates[0] ?? ""),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMoveTargetFolders([]);
          setMoveTargetFolder("");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMoveFolders(false);
      });
    return () => controller.abort();
  }, [moveModalOpen, movingFile, moveTargetClassId, session.roleCode]);

  // Làm mới dữ liệu trang, thư mục và trang tệp hiện hành sau thao tác ghi.
  const refreshAfterMutation = async (message: string) => {
    const ok = await loadData();
    if (selectedClassId) {
      await loadFoldersForClass(selectedClassId);
    }
    if (selectedClassId && selectedFolder) {
      await loadFolderFiles();
    }
    notify(ok ? message : `${message} Hãy tải lại trang nếu danh sách chưa cập nhật.`, ok ? "success" : "info");
  };

  // Mở hộp thoại tải tệp cố định theo đúng lớp và thư mục đang mở.
  const openUploadModal = () => {
    if (!canUploadInOpenFolder) return;
    setUploadTitle("");
    setUploadVisibility("PUBLISHED");
    setSelectedUploadFile(null);
    setUploadModalOpen(true);
  };

  // Tạo thư mục một cấp mới trong class_folders cho lớp đang chọn.
  const handleCreateFolderSubmit = async () => {
    if (!currentClass || !canManageCurrentClass || creatingFolder) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      notify("Vui lòng nhập tên thư mục.", "error");
      return;
    }
    setCreatingFolder(true);
    try {
      const updated = await apiRequest<ClassFoldersResponse>(
        `/instructor/classes/${encodeURIComponent(currentClass.id)}/folders`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ kind: newFolderKind, name: trimmed }),
        },
      );
      setClassFolders(updated);
      setCreateFolderModalOpen(false);
      setNewFolderName("");
      notify(`Đã tạo thư mục '${trimmed}'.`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể tạo thư mục.", "error");
    } finally {
      setCreatingFolder(false);
    }
  };

  // Tải tệp lên đúng lớp và thư mục đang mở, không cho phép chọn nơi lưu khác.
  const handleUploadSubmit = async () => {
    if (isUploading || !currentClass || !selectedFolder || !canManageCurrentClass) return;
    if (!selectedUploadFile) {
      notify("Vui lòng chọn tệp từ máy để tải lên.", "error");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedUploadFile);
      formData.append("folder", selectedFolder.name);
      formData.append("tags", selectedFolder.kind === "lectures" ? "LECTURE" : "MATERIAL");
      formData.append("scope", "CLASS");
      formData.append("visibility", uploadVisibility);

      const created = await apiRequest<Material>(
        `/instructor/classes/${encodeURIComponent(currentClass.id)}/material-uploads`,
        { method: "POST", roleCode: session.roleCode, body: formData },
      );
      if (!created?.id) throw new Error("API không trả về ID học liệu mới.");

      const customName = uploadTitle.trim();
      if (customName && customName !== created.name) {
        await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(created.id)}`, {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({ name: customName, visibility: uploadVisibility }),
        });
      }

      setUploadModalOpen(false);
      setSelectedUploadFile(null);
      await refreshAfterMutation(`Đã tải lên '${customName || created.name}'.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể tải lên học liệu.", "error");
    } finally {
      setIsUploading(false);
    }
  };

  // Mở xem hoặc tải tệp bằng URL đã ký kiểm tra quyền trên máy chủ.
  const handleAccessFile = async (file: MaterialFileItem, action: "PREVIEW" | "DOWNLOAD") => {
    if (action === "PREVIEW") {
      setPreviewFile(file);
      return;
    }
    try {
      const access = await apiRequest<{ url: string }>(
        `/materials/${encodeURIComponent(file.id)}/access?action=DOWNLOAD`,
        { roleCode: session.roleCode },
      );
      await downloadApiFile(access.url, session.roleCode);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể mở tệp học liệu.", "error");
    }
  };

  // Bật/tắt trạng thái hiển thị học liệu đối với học viên trong lớp.
  const handleToggleVisibility = async (file: MaterialFileItem) => {
    const nextVisibility = file.visibility === "HIDDEN" ? "PUBLISHED" : "HIDDEN";
    try {
      await apiRequest(`/instructor/materials/${encodeURIComponent(file.id)}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      setActiveMenuFileId(null);
      await refreshAfterMutation(
        nextVisibility === "HIDDEN"
          ? `Đã ẩn '${file.name}' với học sinh.`
          : `Đã hiển thị '${file.name}' cho học sinh.`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể đổi trạng thái hiển thị.", "error");
    }
  };

  // Mở modal chỉnh sửa tên, trạng thái hiển thị hoặc thay thế tệp đơn lẻ.
  const openEditModal = (file: MaterialFileItem) => {
    setEditingFile(file);
    setEditTitle(file.name);
    setEditVisibility(file.visibility);
    setReplaceFileObj(null);
    setEditModalOpen(true);
    setActiveMenuFileId(null);
  };

  // Lưu thay đổi tên, trạng thái hoặc thay tệp mới cho học liệu hiện tại.
  const handleSaveEditSubmit = async () => {
    if (!editingFile || savingEdit) return;
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle && !replaceFileObj) {
      notify("Vui lòng nhập tên học liệu.", "error");
      return;
    }
    setSavingEdit(true);
    try {
      if (replaceFileObj) {
        const form = new FormData();
        form.append("file", replaceFileObj);
        form.append("folder", editingFile.folder);
        form.append(
          "tags",
          editingFile.tags.length > 0
            ? editingFile.tags.join(",")
            : editingFile.kind === "lectures"
              ? "LECTURE"
              : "MATERIAL",
        );
        form.append("visibility", editVisibility);
        await apiRequest(`/instructor/materials/${encodeURIComponent(editingFile.id)}/file`, {
          method: "PUT",
          roleCode: session.roleCode,
          body: form,
        });
      }
      await apiRequest(`/instructor/materials/${encodeURIComponent(editingFile.id)}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          name: trimmedTitle || editingFile.name,
          visibility: editVisibility,
        }),
      });
      setEditModalOpen(false);
      setEditingFile(null);
      setReplaceFileObj(null);
      await refreshAfterMutation("Đã cập nhật học liệu.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể cập nhật học liệu.", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Mở modal di chuyển tệp sang lớp và thư mục hợp lệ khác trong phạm vi phân công.
  const openMoveModal = (file: MaterialFileItem) => {
    const defaultClass = movableClasses.find((cls) => cls.id !== file.classId) ?? movableClasses[0];
    setMovingFile(file);
    setMoveTargetClassId(defaultClass?.id ?? "");
    setMoveTargetFolder("");
    setMoveModalOpen(true);
    setActiveMenuFileId(null);
  };

  // Thực hiện di chuyển tệp đến lớp và thư mục đích đã xác thực.
  const handleMoveSubmit = async () => {
    if (!movingFile || savingMove) return;
    if (!moveTargetClassId || !moveTargetFolder) {
      notify("Vui lòng chọn lớp và thư mục đích hợp lệ.", "error");
      return;
    }
    setSavingMove(true);
    try {
      await apiRequest(`/instructor/materials/${encodeURIComponent(movingFile.id)}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: moveTargetClassId,
          scope: "CLASS",
          folder: moveTargetFolder,
        }),
      });
      const destCls = movableClasses.find((cls) => cls.id === moveTargetClassId);
      setMoveModalOpen(false);
      setMovingFile(null);
      await refreshAfterMutation(
        `Đã chuyển '${movingFile.name}' vào ${destCls?.name ?? "lớp"} (${moveTargetFolder}).`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể di chuyển học liệu.", "error");
    } finally {
      setSavingMove(false);
    }
  };

  // Xóa hẳn học liệu khỏi lớp học sau khi xác nhận thao tác.
  const handleDeleteFile = async (file: MaterialFileItem) => {
    try {
      await apiRequest(`/instructor/materials/${encodeURIComponent(file.id)}`, {
        method: "DELETE",
        roleCode: session.roleCode,
      });
      setActiveMenuFileId(null);
      await refreshAfterMutation(`Đã xóa '${file.name}'.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không thể xóa học liệu.", "error");
    }
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredGrades = useMemo(
    () =>
      gradesData.filter(
        (g) => !normalizedSearch || g.label.toLowerCase().includes(normalizedSearch),
      ),
    [gradesData, normalizedSearch],
  );
  const filteredSubjects = useMemo(
    () =>
      (currentGrade?.subjects ?? []).filter(
        (s) => !normalizedSearch || s.name.toLowerCase().includes(normalizedSearch),
      ),
    [currentGrade, normalizedSearch],
  );
  const filteredClasses = useMemo(
    () =>
      (currentSubject?.classes ?? []).filter(
        (c) =>
          !normalizedSearch ||
          c.name.toLowerCase().includes(normalizedSearch) ||
          c.code.toLowerCase().includes(normalizedSearch),
      ),
    [currentSubject, normalizedSearch],
  );
  const filteredFolders = useMemo(
    () =>
      currentClassFolderItems.filter(
        (f) => !normalizedSearch || f.name.toLowerCase().includes(normalizedSearch),
      ),
    [currentClassFolderItems, normalizedSearch],
  );

  const currentLevel: "GRADE" | "SUBJECT" | "CLASS" | "FOLDER" | "FILE" = !selectedGradeId
    ? "GRADE"
    : !selectedSubjectId
      ? "SUBJECT"
      : !selectedClassId
        ? "CLASS"
        : !selectedFolder
          ? "FOLDER"
          : "FILE";

  const firstColLabel =
    currentLevel === "GRADE"
      ? "Tên khối"
      : currentLevel === "SUBJECT"
        ? "Tên môn"
        : currentLevel === "CLASS"
          ? "Tên lớp"
          : currentLevel === "FOLDER"
            ? "Tên thư mục"
            : "Tên tệp";

  return (
    <div
      onClick={() => setActiveMenuFileId(null)}
      className="min-h-[calc(100vh-80px)] w-full bg-slate-50/50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100"
    >
      <main className="mx-auto max-w-6xl p-5 sm:p-6 space-y-4">
        {/* Header: Breadcrumb Khối → Môn → Lớp → Thư mục → Tệp + Nút tạo thư mục & tải tệp */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Điều hướng học liệu" className="flex flex-wrap items-center gap-1.5">
            <h1 className="m-0 flex items-center text-base sm:text-lg font-bold">
              <button
                type="button"
                onClick={() => {
                  setSelectedGradeId(null);
                  setSelectedSubjectId(null);
                  setSelectedClassId(null);
                  setSelectedFolder(null);
                }}
                className="text-slate-900 dark:text-slate-100 hover:text-blue-600 cursor-pointer"
              >
                Học liệu
              </button>
            </h1>

            {currentGrade && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSubjectId(null);
                    setSelectedClassId(null);
                    setSelectedFolder(null);
                  }}
                  className="text-sm font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  {currentGrade.label}
                </button>
              </>
            )}

            {currentSubject && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClassId(null);
                    setSelectedFolder(null);
                  }}
                  className="text-sm font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  {formatSubjectLabel(currentSubject.name)}
                </button>
              </>
            )}

            {currentClass && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <button
                  type="button"
                  onClick={() => setSelectedFolder(null)}
                  className={`text-sm font-bold cursor-pointer ${
                    selectedFolder ? "text-blue-600 hover:underline" : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {currentClass.name}
                </button>
              </>
            )}

            {selectedFolder && (
              <>
                <ChevronRight size={15} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedFolder.name}
                </span>
              </>
            )}
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5">
              <button
                type="button"
                aria-label="Chế độ danh sách"
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  viewMode === "list" ? "bg-slate-100 dark:bg-slate-800 text-blue-600" : "text-slate-400"
                }`}
              >
                <ListIcon size={16} />
              </button>
              <button
                type="button"
                aria-label="Chế độ lưới"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  viewMode === "grid" ? "bg-slate-100 dark:bg-slate-800 text-blue-600" : "text-slate-400"
                }`}
              >
                <Grid size={16} />
              </button>
            </div>

            {currentClass && !selectedFolder && canManageCurrentClass && (
              <button
                type="button"
                onClick={() => {
                  setNewFolderName("");
                  setNewFolderKind("materials");
                  setCreateFolderModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <FolderPlus size={14} className="text-blue-600" />
                <span>Tạo thư mục</span>
              </button>
            )}

            <button
              type="button"
              disabled={!canUploadInOpenFolder}
              onClick={openUploadModal}
              title={
                canUploadInOpenFolder
                  ? "Tải tài liệu / bài giảng vào thư mục đang mở"
                  : "Hãy mở một thư mục cụ thể thuộc lớp được phân công để tải lên"
              }
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Upload size={14} />
              <span>Tải tài liệu / bài giảng</span>
            </button>
          </div>
        </div>

        {/* Thanh tìm kiếm */}
        <div className="relative">
          <input
            type="text"
            placeholder="Tìm theo tên khối, môn, lớp, thư mục hoặc tệp..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (selectedFolder) filePagination.resetPage();
            }}
            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 shadow-2xs focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {!selectedFolder && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Mở thư mục trong lớp để tải học liệu lên.
          </p>
        )}

        {/* Nội dung chính */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs">
          {viewMode === "list" && currentLevel !== "FOLDER" && (
            <div className="grid grid-cols-12 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-xs font-semibold text-slate-500">
              <div className="col-span-6">{firstColLabel}</div>
              <div className="col-span-3">{currentLevel === "FILE" ? "Kích thước tệp" : "Số lượng"}</div>
              <div className="col-span-2">{currentLevel === "FILE" ? "Cập nhật" : "Loại"}</div>
              <div className="col-span-1 text-right">Tùy chọn</div>
            </div>
          )}

          {loading ? (
            <div className="p-10 text-center text-xs text-slate-500">Đang tải danh sách học liệu...</div>
          ) : (
            <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4" : "divide-y divide-slate-100 dark:divide-slate-800/50"}>
              {/* CẤP 1: KHỐI */}
              {currentLevel === "GRADE" &&
                (filteredGrades.length > 0 ? (
                  filteredGrades.map((grade) => (
                    <button
                      key={grade.id}
                      type="button"
                      onClick={() => setSelectedGradeId(grade.id)}
                      className={
                        viewMode === "grid"
                          ? "rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-left hover:border-blue-400 transition space-y-2 cursor-pointer"
                          : "w-full grid grid-cols-12 px-4 py-3.5 items-center text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-xs transition cursor-pointer"
                      }
                    >
                      <div className={viewMode === "grid" ? "flex items-center gap-2.5" : "col-span-6 flex items-center gap-3"}>
                        <Folder size={18} className="text-slate-700 dark:text-slate-200 shrink-0" />
                        <strong className="font-bold text-slate-900 dark:text-slate-100">{grade.label}</strong>
                      </div>
                      <div className={viewMode === "grid" ? "text-[11px] text-slate-500" : "col-span-3 text-slate-500"}>
                        {t(`${grade.itemsCount} mục`)}
                      </div>
                      {viewMode === "list" && (
                        <>
                          <div className="col-span-2 text-slate-400">Khối học</div>
                          <div className="col-span-1 text-right text-slate-400">→</div>
                        </>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400">
                    Chưa có khối học nào khả dụng.
                  </div>
                ))}

              {/* CẤP 2: MÔN */}
              {currentLevel === "SUBJECT" &&
                (filteredSubjects.length > 0 ? (
                  filteredSubjects.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSelectedSubjectId(sub.id)}
                      className={
                        viewMode === "grid"
                          ? "rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-left hover:border-blue-400 transition space-y-2 cursor-pointer"
                          : "w-full grid grid-cols-12 px-4 py-3.5 items-center text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-xs transition cursor-pointer"
                      }
                    >
                      <div className={viewMode === "grid" ? "flex items-center gap-2.5" : "col-span-6 flex items-center gap-3"}>
                        <Folder size={18} className="text-slate-700 dark:text-slate-200 shrink-0" />
                        <strong className="font-bold text-slate-900 dark:text-slate-100">{formatSubjectLabel(sub.name)}</strong>
                      </div>
                      <div className={viewMode === "grid" ? "text-[11px] text-slate-500" : "col-span-3 text-slate-500"}>
                        {t(`${sub.classes.length} lớp`)}
                      </div>
                      {viewMode === "list" && (
                        <>
                          <div className="col-span-2 text-slate-400">Môn học</div>
                          <div className="col-span-1 text-right text-slate-400">→</div>
                        </>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400">
                    Khối này chưa có môn học nào.
                  </div>
                ))}

              {/* CẤP 3: LỚP */}
              {currentLevel === "CLASS" &&
                (filteredClasses.length > 0 ? (
                  filteredClasses.map((cls) => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => setSelectedClassId(cls.id)}
                      className={
                        viewMode === "grid"
                          ? "rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-left hover:border-blue-400 transition space-y-2 cursor-pointer"
                          : "w-full grid grid-cols-12 px-4 py-3.5 items-center text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-xs transition cursor-pointer"
                      }
                    >
                      <div className={viewMode === "grid" ? "flex items-center gap-2.5" : "col-span-6 flex items-center gap-3"}>
                        <Folder size={18} className="text-blue-600 shrink-0" />
                        <div className="min-w-0">
                          <strong className="font-bold text-slate-900 dark:text-slate-100 truncate block">
                            {cls.name} ({cls.code})
                          </strong>
                          {cls.status === "CLOSED" && (
                            <span className="text-[10px] text-amber-600 font-semibold">Lớp đã đóng (chỉ đọc)</span>
                          )}
                        </div>
                      </div>
                      <div className={viewMode === "grid" ? "text-[11px] text-slate-500" : "col-span-3 text-slate-500"}>
                        {t(`${cls.itemsCount} tệp`)}
                      </div>
                      {viewMode === "list" && (
                        <>
                          <div className="col-span-2 text-slate-400">Lớp học</div>
                          <div className="col-span-1 text-right text-slate-400">→</div>
                        </>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400">
                    Môn này chưa có lớp học nào.
                  </div>
                ))}

              {/* CẤP 4: THƯ MỤC MỘT CẤP TRONG LỚP (class_folders) */}
              {currentLevel === "FOLDER" &&
                (foldersLoading ? (
                  <div className="col-span-full p-8 text-center text-xs text-slate-500">
                    Đang tải danh sách thư mục của lớp...
                  </div>
                ) : filteredFolders.length > 0 ? (
                  (["materials", "lectures"] as const).map((kind) => {
                    const folders = filteredFolders.filter((folder) => folder.kind === kind);
                    if (!folders.length) return null;
                    const title = kind === "lectures" ? "Bài giảng" : "Tài liệu";
                    return (
                      <section key={kind} aria-label={t(title)} className="col-span-full min-w-0">
                        <h3 className="flex items-baseline gap-2 bg-slate-50 px-4 py-2 text-sm font-semibold dark:bg-slate-800">
                          {t(title)} <span className="text-xs font-normal tabular-nums text-slate-500 dark:text-slate-300">({folders.length})</span>
                        </h3>
                        <div className={viewMode === "grid" ? "grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3" : "divide-y divide-slate-100 dark:divide-slate-800"}>
                          {folders.map((folder) => (
                            <button key={folder.name} type="button"
                              onClick={() => {
                                filePagination.resetPage();
                                setSelectedFolder({ kind, name: folder.name });
                              }}
                              className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800 ${viewMode === "grid" ? "rounded-lg border border-slate-200 dark:border-slate-700" : ""}`}>
                              <FolderOpen aria-hidden="true" size={18} className={kind === "lectures" ? "shrink-0 text-purple-600" : "shrink-0 text-amber-600"} />
                              <span className="min-w-0 flex-1 break-words text-sm font-medium">{folder.name}</span>
                              <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-300">{t(`${folder.count} tệp`)}</span>
                              <span aria-hidden="true" className="text-slate-500">›</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400">
                    {canManageCurrentClass
                      ? "Lớp chưa có thư mục nào. Hãy bấm \"Tạo thư mục\" trước khi tải học liệu lên."
                      : "Lớp chưa có thư mục học liệu nào."}
                  </div>
                ))}

              {/* CẤP 5: DANH SÁCH TỆP TRONG THƯ MỤC ĐANG MỞ */}
              {currentLevel === "FILE" &&
                (folderFilesLoading ? (
                  <div className="col-span-full p-8 text-center text-xs text-slate-500">
                    Đang tải danh sách học liệu...
                  </div>
                ) : folderFiles.length > 0 ? (
                  folderFiles.map((file) => (
                    <div
                      key={file.id}
                      className={
                        viewMode === "grid"
                          ? "rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 relative"
                          : "grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-xs transition relative"
                      }
                    >
                      <div className={viewMode === "grid" ? "flex items-start gap-2.5" : "col-span-6 flex items-center gap-3 min-w-0"}>
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
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => void handleAccessFile(file, "PREVIEW")}
                            className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 truncate block text-left w-full cursor-pointer"
                          >
                            {file.name}
                          </button>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                                file.kind === "lectures"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                              }`}
                            >
                              {file.kind === "lectures" ? "Bài giảng" : "Tài liệu"}
                            </span>
                            {file.visibility === "HIDDEN" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                <EyeOff size={10} />
                                <span>Đã ẩn</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className={viewMode === "grid" ? "text-[11px] text-slate-500 flex items-center justify-between" : "col-span-3 text-slate-500"}>
                        <span>{file.size}</span>
                        {viewMode === "grid" && (
                          <span>{formatMaterialUpdatedAt(file.updatedAt, locale, t)}</span>
                        )}
                      </div>

                      {viewMode === "list" && (
                        <div className="col-span-2 text-slate-500">
                          {formatMaterialUpdatedAt(file.updatedAt, locale, t)}
                        </div>
                      )}

                      <div className={viewMode === "grid" ? "flex items-center justify-end gap-1.5" : "col-span-1 text-right relative"}>
                        <button
                          type="button"
                          onClick={() => void handleAccessFile(file, "DOWNLOAD")}
                          title="Tải xuống"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 cursor-pointer inline-flex items-center"
                        >
                          <Download size={14} />
                        </button>

                        {canManageCurrentClass && (
                          <div className="relative inline-block">
                            <button
                              type="button"
                              aria-label="Tùy chọn học liệu"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuFileId(activeMenuFileId === file.id ? null : file.id);
                              }}
                              className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
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
                                  onClick={() => openEditModal(file)}
                                  className="w-full px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer font-medium"
                                >
                                  <span>Chỉnh sửa / Thay tệp</span>
                                  <Edit3 size={14} className="text-blue-600 shrink-0" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void handleToggleVisibility(file)}
                                  className="w-full px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer font-medium"
                                >
                                  <span>{file.visibility === "HIDDEN" ? "Hiển thị học liệu" : "Ẩn học liệu"}</span>
                                  {file.visibility === "HIDDEN" ? (
                                    <Eye size={14} className="text-emerald-600 shrink-0" />
                                  ) : (
                                    <EyeOff size={14} className="text-slate-500 shrink-0" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openMoveModal(file)}
                                  className="w-full px-3.5 py-2.5 hover:bg-amber-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer font-medium"
                                >
                                  <span>Di chuyển đến lớp/thư mục</span>
                                  <Move size={14} className="text-amber-600 shrink-0" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void handleDeleteFile(file)}
                                  className="w-full px-3.5 py-2.5 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center justify-between gap-2 cursor-pointer font-medium"
                                >
                                  <span>Xóa</span>
                                  <Trash2 size={14} className="shrink-0" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400">
                    {canManageCurrentClass
                      ? "Thư mục này chưa có tệp nào. Hãy bấm \"Tải tài liệu / bài giảng\" để thêm tệp mới."
                      : "Thư mục này chưa có tệp nào."}
                  </div>
                ))}
            </div>
          )}
          {!loading && currentLevel === "FILE" && filePagination.totalItems > 0 && (
            <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <Pagination
                totalItems={filePagination.totalItems}
                page={filePagination.displayPage}
                pageSize={filePagination.pageSize}
                onPageChange={filePagination.setPage}
                onPageSizeChange={filePagination.setPageSize}
                itemLabel="tệp"
              />
            </div>
          )}
        </div>
      </main>

      {/* MODAL TẠO THƯ MỤC Ở CẤP LỚP */}
      {previewFile && <Modal open title={previewFile.name} onClose={() => setPreviewFile(null)}>
        <InlineFilePreview key={previewFile.id} materialId={previewFile.id} title={previewFile.name} />
        <button type="button" className="mt-3 text-sm font-semibold underline" onClick={() => void handleAccessFile(previewFile, "DOWNLOAD")}>Tải xuống</button>
      </Modal>}
      {createFolderModalOpen && currentClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold flex items-center gap-2">
                <FolderPlus size={18} className="text-blue-600" />
                <span>Tạo thư mục mới</span>
              </h3>
              <button
                type="button"
                onClick={() => setCreateFolderModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="font-bold text-slate-500">Lớp đang mở:</span>{" "}
                <strong className="text-slate-900 dark:text-slate-100">{currentClass.name}</strong>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Loại nội dung:
                </label>
                <select
                  value={newFolderKind}
                  onChange={(e) => setNewFolderKind(e.target.value as FolderKind)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                >
                  <option value="materials">Tài liệu học tập</option>
                  <option value="lectures">Bài giảng</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên thư mục:
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ví dụ: Chương 1 - Hàm số"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCreateFolderModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={creatingFolder}
                onClick={() => void handleCreateFolderSubmit()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {creatingFolder ? "Đang tạo..." : "Tạo thư mục"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TẢI TỆP KHÓA ĐÍCH LƯU THEO ĐÚNG LỚP & THƯ MỤC ĐANG MỞ */}
      {uploadModalOpen && currentClass && selectedFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold flex items-center gap-2">
                {selectedFolder.kind === "lectures" ? (
                  <Video size={18} className="text-purple-600" />
                ) : (
                  <BookOpen size={18} className="text-blue-600" />
                )}
                <span>Tải tài liệu / bài giảng</span>
              </h3>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center gap-3">
                <div className="size-8 rounded-lg bg-blue-600 text-white grid place-items-center shrink-0">
                  <FolderOpen size={16} />
                </div>
                <div className="min-w-0">
                  <strong className="block font-bold text-blue-700 dark:text-blue-300 truncate">
                    {currentClass.name} ({currentClass.code}) / {selectedFolder.name}
                  </strong>
                  <span className="text-[11px] text-slate-500 block">
                    {selectedFolder.kind === "lectures"
                      ? "Lưu cố định vào đúng lớp và thư mục bài giảng đang mở."
                      : "Lưu cố định vào đúng lớp và thư mục tài liệu đang mở."}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên hiển thị:
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Để trống sẽ giữ nguyên tên tệp gốc"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chọn tệp từ máy:
                </label>
                <label className="block cursor-pointer border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center space-y-2 hover:border-blue-500 transition">
                  <input
                    type="file"
                    accept={
                      selectedFolder.kind === "lectures"
                        ? ".mp4,.pdf,.doc,.docx"
                        : ".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    }
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setSelectedUploadFile(file);
                      if (file && !uploadTitle.trim()) {
                        setUploadTitle(file.name);
                      }
                    }}
                  />
                  <UploadCloud size={24} className="mx-auto text-blue-600" />
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Bấm để chọn tệp cần tải lên
                  </div>
                  {selectedUploadFile && (
                    <div className="text-[11px] font-bold text-emerald-600">
                      ✓ {selectedUploadFile.name} ({formatMaterialSize(selectedUploadFile.size)})
                    </div>
                  )}
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trạng thái hiển thị:
                </label>
                <select
                  value={uploadVisibility}
                  onChange={(e) => setUploadVisibility(e.target.value as "PUBLISHED" | "HIDDEN")}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="PUBLISHED">Hiển thị với học sinh</option>
                  <option value="HIDDEN">Ẩn với học sinh</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => void handleUploadSubmit()}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
              >
                <Check size={14} />
                <span>{isUploading ? "Đang tải lên..." : "Hoàn tất & Lưu vào kho"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHỈNH SỬA / THAY TỆP ĐƠN LẺ */}
      {editModalOpen && editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold flex items-center gap-2">
                <RefreshCw size={18} className="text-blue-600" />
                <span>Chỉnh sửa / Thay tệp</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên học liệu:
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Thay tệp mới (tùy chọn — tệp cũ sẽ bị xóa):
                </label>
                <label className="block cursor-pointer border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center hover:border-blue-500 transition">
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(e) => setReplaceFileObj(e.target.files?.[0] ?? null)}
                  />
                  <FileText size={20} className="mx-auto text-blue-600 mb-1" />
                  <span className="text-slate-600 dark:text-slate-300">
                    {replaceFileObj ? replaceFileObj.name : "Bấm để chọn tệp mới thay thế"}
                  </span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trạng thái hiển thị:
                </label>
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as "PUBLISHED" | "HIDDEN")}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="PUBLISHED">Hiển thị với học sinh</option>
                  <option value="HIDDEN">Ẩn với học sinh</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleSaveEditSubmit()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DI CHUYỂN TỆP SANG LỚP & THƯ MỤC ĐÍCH */}
      {moveModalOpen && movingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <Move size={18} className="text-amber-600" />
              <span>Di chuyển tệp sang thư mục khác</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn lớp và thư mục đích hợp lệ cho <strong>{movingFile.name}</strong>:
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Lớp đích:
                </label>
                <select
                  value={moveTargetClassId}
                  onChange={(e) => setMoveTargetClassId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                >
                  {movableClasses.length === 0 && (
                    <option value="">Không có lớp khả dụng</option>
                  )}
                  {movableClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} ({cls.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Thư mục đích:
                </label>
                <select
                  value={moveTargetFolder}
                  disabled={loadingMoveFolders || moveTargetFolders.length === 0}
                  onChange={(e) => setMoveTargetFolder(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                >
                  {loadingMoveFolders && <option value="">Đang tải thư mục...</option>}
                  {!loadingMoveFolders && moveTargetFolders.length === 0 && (
                    <option value="">Lớp đích chưa có thư mục phù hợp</option>
                  )}
                  {moveTargetFolders.map((folderName) => (
                    <option key={folderName} value={folderName}>
                      {folderName}
                    </option>
                  ))}
                </select>
              </div>
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
                disabled={savingMove || !moveTargetClassId || !moveTargetFolder}
                onClick={() => void handleMoveSubmit()}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {savingMove ? "Đang chuyển..." : "Xác nhận di chuyển"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
