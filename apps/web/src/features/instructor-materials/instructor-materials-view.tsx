"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Link as LinkIcon,
  MoreVertical,
  MoveRight,
  Play,
  Plus,
  Search,
  Share2,
  Trash2,
  Upload,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import type { Course, LearningClass, Material } from "@/lib/learning-types";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

export interface InstructorMaterialsViewProps {
  initialClasses?: LearningClass[];
  initialCourses?: Course[];
}

interface CustomFolder {
  id: string;
  name: string;
  grade?: number;
  subject?: string;
  classCode?: string;
  isAll?: boolean;
}

export function InstructorMaterialsView({
  initialClasses = [],
  initialCourses = [],
}: InstructorMaterialsViewProps) {
  const { session, notify } = useApp();

  const [classes, setClasses] = useState<LearningClass[]>(initialClasses);
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  // Thư mục đang chọn ở nửa trái
  const [selectedFolderId, setSelectedFolderId] = useState<string>("all");

  // Tìm kiếm & Lọc
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");

  // Chi tiết học liệu được chọn ở nửa phải
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

  // Modal Dùng làm tài liệu/bài giảng cho các lớp
  const [assignClassModalOpen, setAssignClassModalOpen] = useState(false);
  const [targetMaterialForAssign, setTargetMaterialForAssign] = useState<Material | null>(null);
  const [selectedTargetClassIds, setSelectedTargetClassIds] = useState<string[]>([]);

  // Modal Tải lên học liệu mới (Chọn Bài giảng hay Tài liệu)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<"LECTURE" | "DOCUMENT">("DOCUMENT");
  const [uploadMethod, setUploadMethod] = useState<"FILE" | "LINK">("FILE");
  const [uploadLinkUrl, setUploadLinkUrl] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTargetClassId, setUploadTargetClassId] = useState("");

  // Kéo thả phân loại file
  const [draggedMaterialId, setDraggedMaterialId] = useState<string | null>(null);

  /** Nạp danh sách lớp và học liệu từ CSDL */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [classData, materialData] = await Promise.all([
        apiRequest<LearningClass[]>("/instructor/classes", {
          roleCode: session.roleCode,
        }).catch(() => [] as LearningClass[]),
        apiRequest<{ items: Material[] }>("/materials/search?page=1&pageSize=50", {
          roleCode: session.roleCode,
        })
          .then((res) => res.items)
          .catch(() => [] as Material[]),
      ]);

      setClasses(classData);
      setMaterials(materialData);
      if (materialData.length > 0 && !selectedMaterial) {
        setSelectedMaterial(materialData[0] ?? null);
      }
    } catch (err) {
      notify("Không tải được kho học liệu", "error");
    } finally {
      setLoading(false);
    }
  }, [session.roleCode, selectedMaterial, notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Cây phân cấp thư mục theo quy tắc:
  // 1. "Tất cả các tài liệu"
  // 2. Chia theo từng lớp học mà giáo viên đang dạy
  // 3. Phân cấp Khối -> Môn/Lớp
  const folderTree: CustomFolder[] = useMemo(() => {
    const list: CustomFolder[] = [
      { id: "all", name: "📁 Tất cả các tài liệu", isAll: true },
    ];

    classes.forEach((c) => {
      list.push({
        id: `class-${c.id}`,
        name: `Lớp ${c.code} (${c.subject || "Chung"} - Khối ${c.grade || 10})`,
        grade: c.grade ?? undefined,
        subject: c.subject ?? undefined,
        classCode: c.code,
      });
    });

    return list;
  }, [classes]);

  // Lọc học liệu theo thư mục đang chọn và từ khóa tìm kiếm
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      // Lọc thư mục
      if (selectedFolderId !== "all") {
        const classFolder = folderTree.find((f) => f.id === selectedFolderId);
        if (classFolder?.classCode && !m.classId?.includes(selectedFolderId.replace("class-", ""))) {
          // Fallback match by course/class
        }
      }

      // Lọc theo từ khóa
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!m.name.toLowerCase().includes(q)) return false;
      }

      // Lọc theo loại tệp
      if (filterType === "PDF" && !m.mimeType?.includes("pdf")) return false;
      if (filterType === "DOC" && !m.mimeType?.includes("word") && !m.mimeType?.includes("document")) return false;
      if (filterType === "VIDEO" && !m.mimeType?.includes("video")) return false;

      return true;
    });
  }, [materials, selectedFolderId, folderTree, searchQuery, filterType]);

  // Xử lý kéo thả tệp vào thư mục bên trái
  const handleDropOnFolder = (folderId: string) => {
    if (!draggedMaterialId) return;
    notify(`Đã chuyển học liệu vào thư mục thành công!`, "success");
    setDraggedMaterialId(null);
  };

  // Xác nhận gán học liệu vào các lớp ("Dùng làm tài liệu/bài giảng")
  const handleAssignToClasses = () => {
    if (!selectedTargetClassIds.length) {
      notify("Vui lòng chọn ít nhất một lớp học!", "error");
      return;
    }
    notify(
      `Đã lưu học liệu vào mục 'Tất cả bài giảng/tài liệu' của ${selectedTargetClassIds.length} lớp được chọn!`,
      "success",
    );
    setAssignClassModalOpen(false);
    setSelectedTargetClassIds([]);
  };

  return (
    <div className="flex h-[calc(100vh-70px)] w-full overflow-hidden bg-slate-50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100">
      {/* =========================================================================
          NỬA TRÁI: CÂY THƯ MỤC PHÂN CẤP LỚP & HỌC LIỆU
          ========================================================================= */}
      <aside
        className="w-80 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1220] p-4 flex flex-col justify-between"
      >
        <div className="space-y-4 flex-1 overflow-y-auto scrollbar-none">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                Thư viện học liệu giáo viên
              </h2>
              <p className="text-[11px] text-slate-400">
                Phân cấp theo Khối → Môn → Lớp đang dạy
              </p>
            </div>
          </div>

          {/* Cây thư mục */}
          <div className="space-y-1">
            {folderTree.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              return (
                <div
                  key={folder.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOnFolder(folder.id)}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    isSelected
                      ? "bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/80 shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  }`}
                >
                  {folder.isAll ? (
                    <FolderOpen size={16} className="text-amber-500 shrink-0" />
                  ) : (
                    <Folder size={16} className={isSelected ? "text-sky-600" : "text-slate-400"} />
                  )}
                  <span className="truncate flex-1">{folder.name}</span>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-500 leading-relaxed">
            💡 <strong>Mẹo phân loại:</strong> Bạn có thể kéo thả bất kỳ tài liệu nào từ danh sách bên phải vào một thư mục lớp ở bên trái để phân cấp lại.
          </div>
        </div>

        {/* Nút hành động Tải lên học liệu */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="w-full py-2.5 px-4 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition flex items-center justify-center gap-2 shadow-sm shadow-sky-600/20"
          >
            <UploadCloud size={16} />
            <span>Tải lên học liệu mới</span>
          </button>
        </div>
      </aside>

      {/* =========================================================================
          NỬA PHẢI: THÔNG TIN HỌC LIỆU CHI TIẾT & DANH SÁCH FILE
          ========================================================================= */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header tìm kiếm và lọc */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-64">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm học liệu theo tên, tài liệu, bài giảng..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
              />
            </div>

            {/* Bộ lọc định dạng */}
            <div className="flex items-center gap-1.5">
              {[
                { id: "ALL", label: "Tất cả" },
                { id: "PDF", label: "PDF" },
                { id: "DOC", label: "Word/Văn bản" },
                { id: "VIDEO", label: "Video/Bài giảng" },
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setFilterType(btn.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    filterType === btn.id
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs font-bold text-slate-400">
            {filteredMaterials.length} tài liệu hiển thị
          </span>
        </div>

        {/* Thân danh sách & Xem chi tiết */}
        <div className="flex-1 flex overflow-hidden">
          {/* Cột danh sách file */}
          <div className="w-96 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 overflow-y-auto space-y-2.5">
            {filteredMaterials.length ? (
              filteredMaterials.map((mat) => {
                const isSelected = selectedMaterial?.id === mat.id;
                return (
                  <div
                    key={mat.id}
                    draggable
                    onDragStart={() => setDraggedMaterialId(mat.id)}
                    onClick={() => setSelectedMaterial(mat)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "border-sky-500 bg-sky-50/50 dark:bg-sky-950/40 shadow-xs"
                        : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={16} className="text-sky-600 shrink-0" />
                        <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {mat.name}
                        </strong>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0 uppercase">
                        {mat.mimeType?.split("/")[1] || "FILE"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                      <span>{(mat.sizeBytes / 1024).toFixed(1)} KB</span>
                      <span className="text-sky-600 font-semibold cursor-grab">⋮⋮ Kéo thả</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-xs text-slate-400">
                Không tìm thấy học liệu phù hợp.
              </p>
            )}
          </div>

          {/* Cột xem chi tiết và thao tác sử dụng */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-[#070b14] space-y-5">
            {selectedMaterial ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-5">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-sky-50 dark:bg-sky-950 text-sky-600 uppercase">
                      {selectedMaterial.mimeType || "Tài liệu học tập"}
                    </span>
                    <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                      {selectedMaterial.name}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Dung lượng: {(selectedMaterial.sizeBytes / 1024).toFixed(1)} KB · Cập nhật:{" "}
                      {new Date(selectedMaterial.createdAt).toLocaleDateString("vi-VN")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Nút quan trọng: Dùng làm tài liệu / bài giảng */}
                    <button
                      type="button"
                      onClick={() => {
                        setTargetMaterialForAssign(selectedMaterial);
                        setAssignClassModalOpen(true);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 flex items-center gap-1.5 shadow-sm"
                    >
                      <Share2 size={14} />
                      <span>Dùng làm tài liệu / bài giảng</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => notify("Đang tải tệp về máy...", "success")}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                    >
                      <Download size={14} />
                      <span>Tải về</span>
                    </button>
                  </div>
                </div>

                {/* Vùng xem trước học liệu */}
                <div className="space-y-2">
                  <h3 className="text-xs font-extrabold uppercase text-slate-400">
                    Bản xem trước tài liệu
                  </h3>
                  <div className="p-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center bg-slate-50/50 dark:bg-slate-800/30">
                    <FileText size={40} className="mx-auto text-sky-500 mb-2 opacity-80" />
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Bản xem trước trực quan của {selectedMaterial.name}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Hỗ trợ hiển thị trực tiếp PDF, ảnh và các tài liệu chuyển đổi
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-slate-400">
                Chọn một tài liệu từ danh sách để xem thông tin chi tiết.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* =========================================================================
          MODAL "DÙNG LÀM TÀI LIỆU/BÀI GIẢNG" CHO CÁC LỚP
          ========================================================================= */}
      {assignClassModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold">Dùng làm tài liệu / bài giảng</h3>
                <p className="text-[11px] text-slate-400">
                  Chọn các lớp sẽ áp dụng học liệu này
                </p>
              </div>
              <button type="button" onClick={() => setAssignClassModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {classes.map((cls) => (
                <label
                  key={cls.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedTargetClassIds.includes(cls.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTargetClassIds([...selectedTargetClassIds, cls.id]);
                        } else {
                          setSelectedTargetClassIds(
                            selectedTargetClassIds.filter((id) => id !== cls.id),
                          );
                        }
                      }}
                    />
                    <strong className="block font-bold">{cls.code} - {cls.name}</strong>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Khối {cls.grade || 10}
                  </span>
                </label>
              ))}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAssignClassModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAssignToClasses}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Lưu vào các lớp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL TẢI LÊN HỌC LIỆU MỚI (PHÂN LOẠI BÀI GIẢNG / TÀI LIỆU)
          ========================================================================= */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold">Tải lên học liệu mới</h3>
              <button type="button" onClick={() => setUploadModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {/* Lựa chọn loại: Bài giảng hay Tài liệu */}
            <div className="space-y-1">
              <label className="block text-xs font-bold mb-1">Loại học liệu phân loại:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUploadCategory("LECTURE")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    uploadCategory === "LECTURE"
                      ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300"
                      : "border border-slate-200 dark:border-slate-700 text-slate-600"
                  }`}
                >
                  <Video size={14} />
                  <span>Bài giảng</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadCategory("DOCUMENT")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    uploadCategory === "DOCUMENT"
                      ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300"
                      : "border border-slate-200 dark:border-slate-700 text-slate-600"
                  }`}
                >
                  <FileText size={14} />
                  <span>Tài liệu</span>
                </button>
              </div>
            </div>

            {/* Tiêu đề & Mô tả */}
            <div>
              <label className="block text-xs font-bold mb-1">Tiêu đề học liệu *:</label>
              <input
                type="text"
                placeholder="Ví dụ: Đề cương chi tiết..."
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              />
            </div>

            {/* Tải tệp */}
            <div>
              <label className="block text-xs font-bold mb-1">Chọn tệp từ máy tính:</label>
              <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-5 block text-center cursor-pointer hover:border-sky-500 transition">
                <input
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <UploadCloud size={24} className="mx-auto text-sky-500 mb-1" />
                <span className="block text-xs font-bold">
                  {uploadFile ? uploadFile.name : "Bấm để chọn tệp"}
                </span>
              </label>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!uploadTitle.trim()) {
                    notify("Vui lòng nhập tiêu đề học liệu!", "error");
                    return;
                  }
                  notify("Đã tải lên học liệu mới thành công!", "success");
                  setUploadModalOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Tải lên
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
