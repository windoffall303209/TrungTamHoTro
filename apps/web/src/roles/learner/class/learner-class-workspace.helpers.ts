type FolderItem = { folder?: string };
type TitledItem = FolderItem & { title: string };
type FileItem = TitledItem & { fileType: string; uploadedAt: string };
type AssignmentItem = TitledItem & { createdAt?: string; dueAt?: string };

export { getFolderNames as getLearnerFolderNames } from "@/features/class-detail/folder-names";

// Lọc thư mục và tìm kiếm trên bản sao để không làm thay đổi dữ liệu đầu vào.
function filterByFolderAndTitle<T extends TitledItem>(items: ReadonlyArray<T>, folder: string, search: string): T[] {
  let result = [...items];
  if (folder !== "__ALL__") {
    result = result.filter((item) => item.folder === folder);
  }
  if (search.trim()) {
    const query = search.toLowerCase().trim();
    result = result.filter((item) => item.title.toLowerCase().includes(query));
  }
  return result;
}

// Sắp xếp bài tập theo tên, thời gian tạo hoặc hạn nộp như màn hình học viên.
export function filterLearnerAssignments<T extends AssignmentItem>(
  items: ReadonlyArray<T>, folder: string, search: string, sort: "alpha" | "newest" | "due",
): T[] {
  const result = filterByFolderAndTitle(items, folder, search);
  if (sort === "alpha") {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "newest") {
    result.sort((a, b) => new Date(b.createdAt || b.dueAt || 0).getTime() - new Date(a.createdAt || a.dueAt || 0).getTime());
  } else if (sort === "due") {
    result.sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
  }
  return result;
}

// Lọc bài giảng và tài liệu theo tên, định dạng hoặc ngày tải lên.
export function filterLearnerFiles<T extends FileItem>(
  items: ReadonlyArray<T>, folder: string, search: string, sort: "alpha" | "newest" | "type",
): T[] {
  const result = filterByFolderAndTitle(items, folder, search);
  if (sort === "alpha") {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "type") {
    result.sort((a, b) => a.fileType.localeCompare(b.fileType));
  } else if (sort === "newest") {
    result.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }
  return result;
}
