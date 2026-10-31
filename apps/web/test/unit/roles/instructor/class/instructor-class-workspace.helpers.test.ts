import { afterEach, describe, expect, it, vi } from "vitest";
import type { Assignment, GradebookRow, Material, Question } from "@/lib/learning-types";
import {
  detectLectureLinkPlatform,
  exportAssignmentsCsv,
  exportGradebookCsv,
  filterClassQuestions,
  filterClassResources,
  getClassFolderNames,
  getClassQuestionStats,
  getScoreColorClass,
  getLectureYoutubeId,
  isLectureMaterial,
  toClassQuestion,
  toLectureItem,
  toMaterialDisplayItem,
} from "../../../../../src/roles/instructor/class/instructor-class-workspace.helpers";

const material = {
  id: "material-1",
  name: "Bài giảng.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1_048_576,
  folder: "Tuần 1",
  createdAt: "2026-10-20T09:30:00.000Z",
  tags: ["lecture", "youtube:abc123", "attachedExamId:exam-1", "Mô tả: Khởi động"],
} as Material;

// Đọc Blob qua FileReader để kiểm tra dữ liệu CSV trong môi trường jsdom.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("instructor class workspace helpers", () => {
  it("đọc câu hỏi API, ánh xạ đáp án và trạng thái đúng như bảng câu hỏi lớp", () => {
    const source: Question & { solution?: string; createdAt?: string } = {
      id: "question-1", courseId: "course-1", type: "MULTIPLE_CHOICE", content: "Chọn A và C",
      options: ["A", "B", "C"], correctAnswers: ["C", "A", "không tồn tại"], difficulty: 2,
      tags: ["chương 1", "ôn tập"], status: "PUBLISHED", version: 1,
      solution: "Giải thích", createdAt: "2026-10-20T09:00:00Z",
    };
    expect(toClassQuestion(source)).toEqual({
      id: "question-1", familyId: "question-1", status: "PUBLISHED", content: "Chọn A và C",
      type: "Nhiều đáp án", difficulty: "Thông hiểu", source: "chương 1, ôn tập",
      options: ["A", "B", "C"], correctAnswers: [2, 0], solution: "Giải thích",
      createdAt: new Date(source.createdAt!).toLocaleDateString("vi-VN"),
    });
    expect(source.correctAnswers).toEqual(["C", "A", "không tồn tại"]);
    expect(toClassQuestion({ ...source, type: "ESSAY", difficulty: 3, tags: [], createdAt: undefined })).toMatchObject({
      type: "Tự luận", difficulty: "Vận dụng", source: "Ngân hàng câu hỏi CSDL", createdAt: "Hôm nay",
    });
    expect(toClassQuestion({ ...source, type: "TRUE_FALSE", difficulty: 1, familyId: "family-1" })).toMatchObject({
      familyId: "family-1", type: "Đúng / Sai", difficulty: "Cơ bản",
    });
    expect(toClassQuestion({ ...source, type: "SHORT_ANSWER" }).type).toBe("Điền khuyết");
    expect(toClassQuestion({ ...source, type: "SINGLE_CHOICE" }).type).toBe("Trắc nghiệm một đáp án");
  });

  it("lọc tài liệu theo thư mục và từ khóa, không làm thay đổi dữ liệu nguồn", () => {
    const items = [
      { title: "Số học", folder: "Toán", description: "Bài giảng nền tảng", fileType: "pdf", uploadedAt: "2026-10-01" },
      { title: "Hình học", folder: "Toán", description: "Phân tích", fileType: "mp4", uploadedAt: "2026-10-03" },
      { title: "Văn học", folder: "Văn", description: "Bài tập", fileType: "docx", uploadedAt: "2026-10-02" },
      { title: "Không phân loại", folder: "", fileType: "txt", uploadedAt: "2026-10-04" },
    ];
    const original = [...items];

    expect(getClassFolderNames(items)).toEqual(["Toán", "Văn"]);
    expect(filterClassResources(items, "Toán", "HÌNH", "alpha", true).map((item) => item.title)).toEqual(["Hình học"]);
    expect(filterClassResources(items, "__ALL__", "  ", "alpha", false).map((item) => item.title))
      .toEqual(["Hình học", "Không phân loại", "Số học", "Văn học"]);
    expect(filterClassResources(items, "Toán", "tảng", "alpha", false).map((item) => item.title)).toEqual(["Số học"]);
    expect(filterClassResources(items, "Toán", "học ", "alpha", true)).toEqual([]);
    expect(items).toEqual(original);
  });

  it("giữ nguyên ba chế độ sắp xếp và khác biệt mới nhất giữa bài giảng và tài liệu", () => {
    const items = [
      { title: "Z", folder: "Toán", fileType: "pdf", uploadedAt: "2026-10-02" },
      { title: "A", folder: "Toán", fileType: "docx", uploadedAt: "2026-10-03" },
      { title: "C", folder: "Toán", fileType: "mp4", uploadedAt: "2026-10-01" },
    ];
    expect(filterClassResources(items, "__ALL__", "", "alpha", false).map((item) => item.title)).toEqual(["A", "C", "Z"]);
    expect(filterClassResources(items, "__ALL__", "", "type", false).map((item) => item.title)).toEqual(["A", "C", "Z"]);
    expect(filterClassResources(items, "__ALL__", "", "newest", false).map((item) => item.title)).toEqual(["Z", "A", "C"]);
    expect(filterClassResources(items, "__ALL__", "", "newest", true).map((item) => item.title)).toEqual(["A", "Z", "C"]);
    expect(items.map((item) => item.title)).toEqual(["Z", "A", "C"]);
  });

  it("thống kê câu hỏi tự luận và trắc nghiệm ở cả ngân hàng và danh sách đã xuất bản", () => {
    expect(getClassQuestionStats([])).toEqual({ total: 0, multipleChoice: 0, essay: 0 });
    expect(getClassQuestionStats([{ type: "Tự luận" }, { type: "Trắc nghiệm" }, { type: "Nhiều đáp án" }]))
      .toEqual({ total: 3, multipleChoice: 2, essay: 1 });
  });

  it("lọc câu hỏi nhất quán giữa ngân hàng và các chế độ lập đề", () => {
    const questions = [
      { id: "choice", type: "Trắc nghiệm một đáp án", difficulty: "Cơ bản", content: "Phân số", source: "Chương 1" },
      { id: "essay", type: "Tự luận", difficulty: "Thông hiểu", content: "Tính diện tích", source: "Hình học" },
      { id: "multi", type: "Nhiều đáp án", difficulty: "Thông hiểu", content: "Chọn mệnh đề", source: "Hình học" },
    ] as ReturnType<typeof toClassQuestion>[];
    expect(filterClassQuestions(questions, "ALL").map((question) => question.id)).toEqual(["choice", "essay", "multi"]);
    expect(filterClassQuestions(questions, "ESSAY").map((question) => question.id)).toEqual(["essay"]);
    expect(filterClassQuestions(questions, "MULTIPLE_CHOICE").map((question) => question.id)).toEqual(["choice", "multi"]);
    expect(filterClassQuestions(questions, "ALL", "Thông hiểu", "  hình HỌC ").map((question) => question.id))
      .toEqual(["essay", "multi"]);
    expect(filterClassQuestions(questions, "MULTIPLE_CHOICE", "Cơ bản", " PHÂN ").map((question) => question.id))
      .toEqual(["choice"]);
    expect(questions.map((question) => question.id)).toEqual(["choice", "essay", "multi"]);
  });

  it("giữ nguyên cách phân loại liên kết và bài giảng", () => {
    expect(detectLectureLinkPlatform("  https://youtu.be/abc123  ")).toBe("YOUTUBE");
    expect(detectLectureLinkPlatform("https://fb.watch/123")).toBe("FACEBOOK");
    expect(detectLectureLinkPlatform("https://drive.google.com/file/d/1")).toBe("DRIVE");
    expect(detectLectureLinkPlatform("https://example.com")).toBe("INVALID");
    expect(isLectureMaterial(material)).toBe(true);
    expect(isLectureMaterial({ ...material, mimeType: "application/pdf", tags: [] })).toBe(false);
    expect(isLectureMaterial({ ...material, mimeType: "application/pdf", tags: ["Bài giảng số 1"] })).toBe(true);
  });

  it("trích xuất YouTube ID nhất quán khi xem trước và sửa bài giảng", () => {
    const id = "aB12_-xYz90";
    expect(getLectureYoutubeId(`https://youtu.be/${id}`)).toBe(id);
    expect(getLectureYoutubeId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(getLectureYoutubeId(`https://www.youtube.com/watch?feature=share&v=${id}`)).toBe(id);
    expect(getLectureYoutubeId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(getLectureYoutubeId(`https://www.youtube.com/v/${id}`)).toBe(id);
    expect(getLectureYoutubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(getLectureYoutubeId(undefined)).toBeNull();
  });

  it("chuyển metadata sang thông tin hiển thị mà không tạo số liệu giả", () => {
    expect(toMaterialDisplayItem(material)).toEqual({
      id: "material-1",
      title: "Bài giảng.mp4",
      fileType: "mp4",
      size: "1.0 MB",
      uploadedAt: new Date(material.createdAt).toLocaleDateString("vi-VN"),
      folder: "Tuần 1",
      description: material.tags.join(", "),
    });
    expect(toMaterialDisplayItem({ ...material, name: "filename", folder: "", sizeBytes: 0, createdAt: "broken-date" })).toMatchObject({
      fileType: "mp4", size: "—", uploadedAt: "—", folder: "Tài liệu chung",
    });
    expect(toLectureItem(material, "Giảng viên")).toMatchObject({
      id: "material-1", title: "Bài giảng.mp4", sourceType: "LINK", youtubeId: "abc123",
      sourceUrl: "https://www.youtube.com/watch?v=abc123", platform: "YOUTUBE",
      fileType: "mp4", authorName: "Giảng viên", attachedExamId: "exam-1",
      description: "Khởi động",
    });
    expect(toLectureItem({ ...material, name: "Slides.pptx", tags: [] }, "GV")).toMatchObject({
      sourceType: "FILE", platform: "DIRECT", fileType: "pptx",
    });
  });

  it("giữ các ngưỡng màu điểm như giao diện cũ", () => {
    expect(getScoreColorClass(4.9)).toContain("bg-rose-50");
    expect(getScoreColorClass(5)).toContain("bg-sky-50");
    expect(getScoreColorClass(8.5)).toContain("bg-emerald-50");
    expect(getScoreColorClass(85, 100)).toContain("bg-emerald-50");
  });

  it("xuất CSV đúng tên, giữ số và vô hiệu hóa công thức trong ô văn bản", async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:mocked";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const append = vi.spyOn(document.body, "append");
    vi.useFakeTimers();

    exportGradebookCsv([{
      learnerName: '=SUM(1,2)', learnerEmail: 'hello"@example.com',
      examEarned: -3, examPossible: 10, assignmentEarned: 6, assignmentPossible: 10,
      totalPercent: 15, awaitingGrade: 0, notSubmitted: 1,
    } as GradebookRow], "Toán 1");
    exportAssignmentsCsv([{
      id: "assignment-1", title: "@HYPERLINK", status: "PUBLISHED",
      dueAt: "2026-10-20", maxScore: 10, description: "A,B", instructions: "ghi\" chú", version: 1,
    } as Assignment], "Lớp 1");

    expect(click).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map(([link]) => (link as HTMLAnchorElement).download)).toEqual([
      "bang-diem-To-n-1.csv", "bai-tap-L-p-1.csv",
    ]);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    vi.useRealTimers();

    const gradebookText = await readBlob(blobs[0]!);
    const assignmentText = await readBlob(blobs[1]!);
    expect(gradebookText).toContain('"\'=SUM(1,2)"');
    expect(gradebookText).toContain('"hello""@example.com"');
    expect(gradebookText).toContain('"-3"');
    expect(assignmentText).toContain('"\'@HYPERLINK"');
    expect(assignmentText).toContain('"A,B"');
    expect(assignmentText).toContain('"ghi"" chú"');
  });
});
