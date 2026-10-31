/** Liệt kê tên thư mục không rỗng theo thứ tự xuất hiện đầu tiên. */
export function getFolderNames(items: ReadonlyArray<{ folder?: string }>): string[] {
  const folders = new Set<string>();
  items.forEach((item) => {
    if (item.folder) folders.add(item.folder);
  });
  return Array.from(folders);
}
