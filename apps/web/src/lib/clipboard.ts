/** Sao chép văn bản vào clipboard và chuyển lỗi trình duyệt cho nơi gọi xử lý. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Trình duyệt không hỗ trợ sao chép vào clipboard.");
  }
  await navigator.clipboard.writeText(text);
}
