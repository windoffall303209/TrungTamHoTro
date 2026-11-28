import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LectureItem, MaterialDisplayItem } from "@/roles/instructor/class/instructor-class-workspace.helpers";
import { InstructorLecturesTab } from "@/roles/instructor/class/tabs/instructor-lectures-tab";
import { InstructorMaterialsTab } from "@/roles/instructor/class/tabs/instructor-materials-tab";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lectures: LectureItem[] = [
  {
    id: "lec-1",
    title: "Bài giảng Hàm số bậc hai",
    visibility: "PUBLISHED",
    sourceType: "FILE",
    fileType: "mp4",
    folder: "Chương 1",
    uploadedAt: "2026-11-01",
    authorName: "GV A",
    teacher: "GV A",
    duration: "25 phút",
  },
  {
    id: "lec-2",
    title: "Bài giảng Đạo hàm",
    visibility: "HIDDEN",
    sourceType: "FILE",
    fileType: "mp4",
    folder: "Chương 2",
    uploadedAt: "2026-11-02",
    authorName: "GV A",
    teacher: "GV A",
    duration: "30 phút",
  },
];

const materials: MaterialDisplayItem[] = [
  {
    id: "mat-1",
    title: "Đề cương Hàm số.pdf",
    fileType: "pdf",
    size: "1.2 MB",
    uploadedAt: "01/11/2026",
    folder: "Chương 1",
    visibility: "PUBLISHED",
  },
  {
    id: "mat-2",
    title: "Bài tập Đạo hàm.docx",
    fileType: "docx",
    size: "0.8 MB",
    uploadedAt: "02/11/2026",
    folder: "Chương 2",
    visibility: "HIDDEN",
  },
];

describe("C06b Instructor Lectures & Materials tabs state isolation", () => {
  it("cô lập state tìm kiếm và sắp xếp trong InstructorLecturesTab (0 re-render cha khi gõ)", () => {
    let parentRenders = 0;
    const onOpenLecturePage = vi.fn();

    /** Vỏ cha đo số lần re-render khi người dùng lọc danh sách bài giảng. */
    function LecturesParent() {
      parentRenders += 1;
      return (
        <InstructorLecturesTab
          lectures={lectures}
          lectureFolders={["Chương 1", "Chương 2"]}
          selectedLectureFolder="__ALL__"
          selectedLectureId="lec-1"
          canManageClassContent
          onSelectFolder={vi.fn()}
          onSelectLectureId={vi.fn()}
          onOpenLecturePage={onOpenLecturePage}
          onOpenAddLecture={vi.fn()}
          onOpenNewFolder={vi.fn()}
          onToggleVisibility={vi.fn()}
          onEditLecture={vi.fn()}
          onMoveLecture={vi.fn()}
          onDeleteLecture={vi.fn()}
        />
      );
    }

    render(<LecturesParent />);
    expect(parentRenders).toBe(1);

    fireEvent.change(screen.getByPlaceholderText("Tìm kiếm bài giảng..."), {
      target: { value: "Đạo hàm" },
    });

    expect(screen.getAllByText("Bài giảng Đạo hàm").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Bài giảng Hàm số bậc hai")).not.toBeInTheDocument();
    expect(parentRenders).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Xem bài giảng" }));
    expect(onOpenLecturePage).toHaveBeenCalledWith(lectures[1]);
  });

  it("cô lập state tìm kiếm và sắp xếp trong InstructorMaterialsTab (0 re-render cha khi gõ)", () => {
    let parentRenders = 0;
    const onDownloadMaterial = vi.fn();

    /** Vỏ cha đo số lần re-render khi người dùng lọc danh sách tài liệu. */
    function MaterialsParent() {
      parentRenders += 1;
      return (
        <InstructorMaterialsTab
          materials={materials}
          materialFolders={["Chương 1", "Chương 2"]}
          selectedMaterialFolder="__ALL__"
          selectedMaterialId="mat-1"
          canManageClassContent
          onSelectFolder={vi.fn()}
          onSelectMaterialId={vi.fn()}
          onOpenAddMaterial={vi.fn()}
          onOpenNewFolder={vi.fn()}
          onDownloadMaterial={onDownloadMaterial}
          onToggleVisibility={vi.fn()}
          onEditMaterial={vi.fn()}
          onMoveMaterial={vi.fn()}
          onDeleteMaterial={vi.fn()}
        />
      );
    }

    render(<MaterialsParent />);
    expect(parentRenders).toBe(1);

    fireEvent.change(screen.getByPlaceholderText("Tìm kiếm tài liệu..."), {
      target: { value: "Đề cương" },
    });

    expect(screen.getAllByText("Đề cương Hàm số.pdf").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Bài tập Đạo hàm.docx")).not.toBeInTheDocument();
    expect(parentRenders).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Tải xuống tài liệu" }));
    expect(onDownloadMaterial).toHaveBeenCalledWith("mat-1");
  });
});
