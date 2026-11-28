"use client";

import { memo, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderInput,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ClassFolderEntry } from "@/features/class-detail/class-folder-entry";
import { ClassMaterialRow } from "@/features/class-detail/class-material-row";
import { filterClassResources, type MaterialDisplayItem } from "../instructor-class-workspace.helpers";

export interface InstructorMaterialsTabProps {
  materials: MaterialDisplayItem[];
  materialFolders: string[];
  selectedMaterialFolder: string;
  selectedMaterialId: string;
  canManageClassContent: boolean;
  onSelectFolder: (folder: string) => void;
  onSelectMaterialId: (id: string) => void;
  onOpenAddMaterial: () => void;
  onOpenNewFolder: () => void;
  onDownloadMaterial: (id: string) => void;
  onToggleVisibility: (id: string, visibility: "PUBLISHED" | "HIDDEN", title: string) => void;
  onEditMaterial: (material: MaterialDisplayItem) => void;
  onMoveMaterial: (id: string, title: string) => void;
  onDeleteMaterial: (id: string, title: string) => void;
}

/** Tab Tài liệu tách độc lập, tự giữ state tìm kiếm/sắp xếp/thư mục để gõ lọc không re-render workspace cha. */
export const InstructorMaterialsTab = memo(function InstructorMaterialsTab({
  materials,
  materialFolders,
  selectedMaterialFolder,
  selectedMaterialId,
  canManageClassContent,
  onSelectFolder,
  onSelectMaterialId,
  onOpenAddMaterial,
  onOpenNewFolder,
  onDownloadMaterial,
  onToggleVisibility,
  onEditMaterial,
  onMoveMaterial,
  onDeleteMaterial,
}: InstructorMaterialsTabProps) {
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialSort, setMaterialSort] = useState<"alpha" | "newest" | "type">("alpha");
  const [materialFolderExpanded, setMaterialFolderExpanded] = useState<Record<string, boolean>>({});

  const filteredMaterials = useMemo(
    () => filterClassResources(materials, selectedMaterialFolder, materialSearch, materialSort, true),
    [materials, selectedMaterialFolder, materialSearch, materialSort],
  );

  const activeMaterialItem = useMemo(() => {
    if (filteredMaterials.length === 0) return null;
    return filteredMaterials.find((item) => item.id === selectedMaterialId) || filteredMaterials[0] || null;
  }, [filteredMaterials, selectedMaterialId]);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
      {/* Header tiêu đề danh mục */}
      <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Tài liệu ({materials.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục chuyên đề.
          </p>
        </div>
        {canManageClassContent && (
          <button
            type="button"
            onClick={onOpenAddMaterial}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <UploadCloud size={14} />
            <span>Tải tài liệu</span>
          </button>
        )}
      </div>

      {/* Khung 3 cột Master-Detail */}
      <div className="flex flex-col lg:flex-row min-h-[580px]">
        {/* CỘT 1: CÂY THƯ MỤC */}
        <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
            <span>Thư mục</span>
            {canManageClassContent && (
              <button
                type="button"
                onClick={onOpenNewFolder}
                className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-bold cursor-pointer"
              >
                + Tạo
              </button>
            )}
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onSelectFolder("__ALL__")}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                selectedMaterialFolder === "__ALL__"
                  ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              }`}
            >
              <Folder
                size={16}
                className={
                  selectedMaterialFolder === "__ALL__"
                    ? "text-blue-600 fill-blue-500/20"
                    : "text-slate-400"
                }
              />
              <span className="truncate">Tất cả tài liệu</span>
            </button>

            {materialFolders.map((folderName) => (
              <ClassFolderEntry
                key={folderName}
                name={folderName}
                expanded={materialFolderExpanded[folderName] ?? true}
                selected={selectedMaterialFolder === folderName}
                onSelect={() => onSelectFolder(folderName)}
                onToggle={() =>
                  setMaterialFolderExpanded((prev) => ({
                    ...prev,
                    [folderName]: !(prev[folderName] ?? true),
                  }))
                }
              />
            ))}
          </div>
        </div>

        {/* CỘT 2: DANH SÁCH TÀI LIỆU */}
        <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={materialSearch}
                onChange={(e) => setMaterialSearch(e.target.value)}
                placeholder="Tìm kiếm tài liệu..."
                className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              <Search
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>

            <div className="relative">
              <select
                value={materialSort}
                onChange={(e) => setMaterialSort(e.target.value as "alpha" | "newest" | "type")}
                className="appearance-none py-1.5 pl-3 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="alpha">Tên A-Z</option>
                <option value="type">Theo loại tệp</option>
                <option value="newest">Mới nhất</option>
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            {filteredMaterials.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Folder size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-400">Không có tài liệu nào trong thư mục này</p>
              </div>
            ) : (
              filteredMaterials.map((mat) => {
                const isSelected = (activeMaterialItem?.id || filteredMaterials[0]?.id) === mat.id;
                return (
                  <ClassMaterialRow
                    key={mat.id}
                    fileType={mat.fileType}
                    title={mat.title}
                    size={mat.size}
                    uploadedAt={mat.uploadedAt}
                    selected={isSelected}
                    onSelect={() => onSelectMaterialId(mat.id)}
                    titleBadge={
                      mat.visibility === "HIDDEN" ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <EyeOff size={11} />
                          <span>Đã ẩn</span>
                        </span>
                      ) : undefined
                    }
                  />
                );
              })
            )}
          </div>
        </div>

        {/* CỘT 3: CHI TIẾT TÀI LIỆU */}
        <div className="w-full lg:w-80 shrink-0 p-4 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
          {activeMaterialItem ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-800 text-white py-2.5 px-4 flex items-center justify-center gap-2 shadow-sm">
                <FileText size={16} className="text-emerald-400" />
                <span className="text-sm font-bold">
                  {activeMaterialItem.fileType.toUpperCase()} · {activeMaterialItem.size}
                </span>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {activeMaterialItem.title}
                </h4>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>Trạng thái</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      activeMaterialItem.visibility === "HIDDEN"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    }`}
                  >
                    {activeMaterialItem.visibility === "HIDDEN" ? (
                      <>
                        <EyeOff size={12} />
                        <span>Đã ẩn</span>
                      </>
                    ) : (
                      <>
                        <Eye size={12} />
                        <span>Đang hiển thị</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>Định dạng</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 uppercase">
                    {activeMaterialItem.fileType}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>Dung lượng</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {activeMaterialItem.size}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>Ngày tải lên</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {activeMaterialItem.uploadedAt}
                  </span>
                </div>
              </div>

              <div className="pt-2 space-y-1.5">
                <button
                  type="button"
                  onClick={() => onDownloadMaterial(activeMaterialItem.id)}
                  className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <span>Tải xuống tài liệu</span>
                  <Download size={15} className="shrink-0" />
                </button>

                {canManageClassContent && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onToggleVisibility(
                          activeMaterialItem.id,
                          activeMaterialItem.visibility,
                          activeMaterialItem.title,
                        )
                      }
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>
                        {activeMaterialItem.visibility === "HIDDEN"
                          ? "Hiển thị tài liệu"
                          : "Ẩn tài liệu"}
                      </span>
                      {activeMaterialItem.visibility === "HIDDEN" ? (
                        <Eye size={15} className="shrink-0 text-emerald-600" />
                      ) : (
                        <EyeOff size={15} className="shrink-0 text-slate-500" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditMaterial(activeMaterialItem)}
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>Chỉnh sửa</span>
                      <Edit3 size={15} className="shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onMoveMaterial(activeMaterialItem.id, activeMaterialItem.title)}
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>Di chuyển</span>
                      <FolderInput size={15} className="shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteMaterial(activeMaterialItem.id, activeMaterialItem.title)}
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>Xóa</span>
                      <Trash2 size={15} className="shrink-0" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              Chọn một tài liệu để xem chi tiết
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
