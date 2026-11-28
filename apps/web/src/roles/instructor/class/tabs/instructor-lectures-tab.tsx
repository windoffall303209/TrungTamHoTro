"use client";

import { memo, useMemo, useState } from "react";
import {
  Calendar,
  ChevronDown,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Video,
} from "lucide-react";
import { ClassFolderEntry } from "@/features/class-detail/class-folder-entry";
import { filterClassResources, type LectureItem } from "../instructor-class-workspace.helpers";

export interface InstructorLecturesTabProps {
  lectures: LectureItem[];
  lectureFolders: string[];
  selectedLectureFolder: string;
  selectedLectureId: string;
  canManageClassContent: boolean;
  onSelectFolder: (folder: string) => void;
  onSelectLectureId: (id: string) => void;
  onOpenLecturePage: (lecture: LectureItem) => void;
  onOpenAddLecture: () => void;
  onOpenNewFolder: () => void;
  onToggleVisibility: (id: string, visibility: "PUBLISHED" | "HIDDEN", title: string) => void;
  onEditLecture: (lecture: LectureItem) => void;
  onMoveLecture: (id: string, title: string) => void;
  onDeleteLecture: (id: string, title: string) => void;
}

/** Tab Bài giảng tách độc lập, tự giữ state tìm kiếm/sắp xếp/đóng mở thư mục để gõ lọc không re-render workspace cha. */
export const InstructorLecturesTab = memo(function InstructorLecturesTab({
  lectures,
  lectureFolders,
  selectedLectureFolder,
  selectedLectureId,
  canManageClassContent,
  onSelectFolder,
  onSelectLectureId,
  onOpenLecturePage,
  onOpenAddLecture,
  onOpenNewFolder,
  onToggleVisibility,
  onEditLecture,
  onMoveLecture,
  onDeleteLecture,
}: InstructorLecturesTabProps) {
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureSort, setLectureSort] = useState<"alpha" | "newest" | "type">("newest");
  const [lectureFolderExpanded, setLectureFolderExpanded] = useState<Record<string, boolean>>({});

  const filteredLectures = useMemo(
    () => filterClassResources(lectures, selectedLectureFolder, lectureSearch, lectureSort, false),
    [lectures, selectedLectureFolder, lectureSearch, lectureSort],
  );

  const activeLectureItem = useMemo(() => {
    if (filteredLectures.length === 0) return null;
    return filteredLectures.find((item) => item.id === selectedLectureId) || filteredLectures[0] || null;
  }, [filteredLectures, selectedLectureId]);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
      {/* Header tiêu đề danh mục */}
      <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Bài giảng
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Video bài học chuyên đề, slide trình chiếu và audio ghi âm theo chương mục.
          </p>
        </div>
        {canManageClassContent && (
          <button
            type="button"
            onClick={onOpenAddLecture}
            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Plus size={14} />
            <span>Thêm bài giảng</span>
          </button>
        )}
      </div>

      {/* Khung 3 cột Master-Detail */}
      <div className="flex flex-col lg:flex-row min-h-[580px]">
        {/* CỘT 1: CÂY THƯ MỤC */}
        <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
            <span>Thư mục</span>
            <div className="flex items-center gap-1.5">
              {canManageClassContent && (
                <button
                  type="button"
                  onClick={onOpenNewFolder}
                  className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-bold cursor-pointer"
                  title="Tạo thư mục mới"
                >
                  + Tạo
                </button>
              )}
              <SlidersHorizontal size={14} className="text-slate-400" />
            </div>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onSelectFolder("__ALL__")}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                selectedLectureFolder === "__ALL__"
                  ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              }`}
            >
              <Folder
                size={16}
                className={
                  selectedLectureFolder === "__ALL__"
                    ? "text-blue-600 fill-blue-500/20"
                    : "text-slate-400"
                }
              />
              <span className="truncate">Tất cả bài giảng</span>
            </button>

            {lectureFolders.map((folderName) => (
              <ClassFolderEntry
                key={folderName}
                name={folderName}
                expanded={lectureFolderExpanded[folderName] ?? true}
                selected={selectedLectureFolder === folderName}
                onSelect={() => onSelectFolder(folderName)}
                onToggle={() =>
                  setLectureFolderExpanded((prev) => ({
                    ...prev,
                    [folderName]: !(prev[folderName] ?? true),
                  }))
                }
                toggleCursor
              />
            ))}
          </div>
        </div>

        {/* CỘT 2: DANH SÁCH BÀI GIẢNG */}
        <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={lectureSearch}
                onChange={(e) => setLectureSearch(e.target.value)}
                placeholder="Tìm kiếm bài giảng..."
                className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              <Search
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>

            <div className="relative">
              <select
                value={lectureSort}
                onChange={(e) => setLectureSort(e.target.value as "alpha" | "newest" | "type")}
                className="appearance-none py-1.5 pl-3 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="newest">Mới nhất</option>
                <option value="alpha">Tên A-Z</option>
                <option value="type">Loại tệp</option>
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            {filteredLectures.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Video size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-400">Không có bài giảng nào trong thư mục này</p>
              </div>
            ) : (
              filteredLectures.map((lec) => {
                const isSelected = (activeLectureItem?.id || filteredLectures[0]?.id) === lec.id;
                return (
                  <div
                    key={lec.id}
                    onClick={() => onSelectLectureId(lec.id)}
                    onDoubleClick={() => onOpenLecturePage(lec)}
                    title="Bấm đúp để xem bài giảng"
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-purple-50/70 dark:bg-purple-950/30 border-purple-400 dark:border-purple-500 shadow-2xs"
                        : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-800"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                      <div className={`size-8 rounded-lg text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs ${
                        lec.fileType === "mp4"
                          ? "bg-purple-600"
                          : lec.fileType === "mp3"
                            ? "bg-amber-600"
                            : "bg-rose-600"
                      }`}>
                        {lec.fileType}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                            {lec.title}
                          </strong>
                          {lec.visibility === "HIDDEN" && (
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              <EyeOff size={11} />
                              <span>Đã ẩn</span>
                            </span>
                          )}
                        </div>
                        <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full"
                            style={{ width: `${lec.progressPercent || 0}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {lec.duration} · GV: {lec.teacher}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">
                        {lec.progressPercent ?? 0}% đã xem
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CỘT 3: CHI TIẾT BÀI GIẢNG */}
        <div className="w-full lg:w-80 shrink-0 p-5 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
          {activeLectureItem ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 block">
                  Bài giảng
                </span>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                  {activeLectureItem.title}
                </h4>
              </div>

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 py-2 border-t border-b border-slate-200/60 dark:border-slate-800/60">
                <div className="flex items-center justify-between">
                  <span>Trạng thái</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      activeLectureItem.visibility === "HIDDEN"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    }`}
                  >
                    {activeLectureItem.visibility === "HIDDEN" ? (
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
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-400" />
                    <span>Ngày đăng</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {activeLectureItem.uploadedAt}
                  </span>
                </div>
              </div>

              <div className="pt-2 space-y-1.5">
                <button
                  type="button"
                  onClick={() => onOpenLecturePage(activeLectureItem)}
                  className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <span>Xem bài giảng</span>
                  <Play size={15} className="shrink-0" />
                </button>

                {canManageClassContent && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onToggleVisibility(
                          activeLectureItem.id,
                          activeLectureItem.visibility,
                          activeLectureItem.title,
                        )
                      }
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>
                        {activeLectureItem.visibility === "HIDDEN"
                          ? "Hiển thị bài giảng"
                          : "Ẩn bài giảng"}
                      </span>
                      {activeLectureItem.visibility === "HIDDEN" ? (
                        <Eye size={15} className="shrink-0 text-emerald-600" />
                      ) : (
                        <EyeOff size={15} className="shrink-0 text-slate-500" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditLecture(activeLectureItem)}
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>Chỉnh sửa</span>
                      <Edit3 size={15} className="shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onMoveLecture(activeLectureItem.id, activeLectureItem.title)}
                      className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <span>Di chuyển</span>
                      <FolderInput size={15} className="shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteLecture(activeLectureItem.id, activeLectureItem.title)}
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
              Chọn một bài giảng để xem thông tin
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
