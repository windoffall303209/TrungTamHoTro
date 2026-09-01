export const WORD_MIME_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const DEFAULT_MATERIAL_MIME_TYPES = [
  "application/pdf",
  ...WORD_MIME_TYPES,
  "video/mp4",
  "image/png",
  "image/jpeg",
] as const;

export function includeSupportedDocumentMimeTypes(values: readonly string[]): string[] {
  return [...new Set([...values, ...WORD_MIME_TYPES])];
}

export function normalizeMultipartFileName(value: string): string {
  const safeValue = value.replace(/[\0\r\n]/g, "").trim().normalize("NFC");
  const windows1252 = new Map<number, number>([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
    [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
    [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ]);
  const bytes: number[] = [];
  for (const character of safeValue) {
    const codePoint = character.codePointAt(0) ?? 0;
    const byte = codePoint <= 0xff ? codePoint : windows1252.get(codePoint);
    if (byte === undefined) return safeValue;
    bytes.push(byte);
  }
  const source = Buffer.from(bytes);
  const decoded = source.toString("utf8").normalize("NFC");
  return !decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").equals(source) ? decoded : safeValue;
}

export function fileContentDisposition(mode: "inline" | "attachment", fileName: string): string {
  const normalized = normalizeMultipartFileName(fileName) || "hoc-lieu";
  const fallback = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "hoc-lieu";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}
