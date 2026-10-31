type FolderEntry = { id: string; title: string; folder: string };

// Gom số lượng theo thư mục, lọc danh sách và giữ đúng quy tắc chọn mục hiện tại.
export function buildManagerFolderView<T extends FolderEntry>(
  items: T[],
  selectedFolder: string,
  search: string,
  selectedId: string,
) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);

  const query = search.toLowerCase().trim();
  const filtered = items.filter(
    (item) =>
      (selectedFolder === "__ALL__" || item.folder === selectedFolder) &&
      item.title.toLowerCase().includes(query),
  );

  return {
    folders: Array.from(counts.keys()),
    counts,
    filtered,
    active: filtered.find((item) => item.id === selectedId) || filtered[0] || items[0],
  };
}
