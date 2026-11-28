/** Ảnh raster xem trực tiếp an toàn; SVG bị loại vì có thể chứa script khi mở thành tài liệu. */
export const SAFE_PREVIEW_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Kiểu nội dung được phép hiển thị trực tiếp từ blob cùng origin. */
const SAFE_PREVIEW_TYPES: ReadonlySet<string> = new Set([...SAFE_PREVIEW_IMAGE_TYPES, "application/pdf", "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"]);

/**
 * Tạo lại blob với kiểu nội dung an toàn: định dạng ngoài danh sách (HTML, SVG, XML…) bị ép thành
 * application/octet-stream để trình duyệt không bao giờ render nó như tài liệu cùng origin.
 */
export function safePreviewBlob(blob: Blob, declaredType?: string): Blob {
  const type = (declaredType ?? blob.type).split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return new Blob([blob], { type: SAFE_PREVIEW_TYPES.has(type) ? type : "application/octet-stream" });
}

/** Kiểu nội dung blob đã chuẩn hóa có nằm trong nhóm ảnh raster an toàn hay không. */
export function isSafePreviewImage(type: string): boolean {
  return SAFE_PREVIEW_IMAGE_TYPES.has(type.split(";", 1)[0]?.trim().toLowerCase() ?? "");
}

/**
 * Chỉ nhận URL tuyệt đối https: (hoặc http://localhost khi phát triển) cho liên kết phòng họp/bản ghi;
 * chặn javascript:, data:, blob: và URL tương đối có thể bị chèn từ dữ liệu người dùng.
 */
export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

/** Chỉ nhận đường dẫn nội bộ dạng "/..." (không "//host" hay "/\\host") cho liên kết điều hướng trong ứng dụng. */
export function safeInternalPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
  } catch {
    return undefined;
  }
}

/** Cắt liên kết window.opener của cửa sổ con để trang mở ra không điều hướng/tác động ngược trang gốc. */
export function detachOpener(child: Window | null): Window | null {
  if (child) {
    try {
      child.opener = null;
    } catch {
      /* Một số trình duyệt không cho gán opener; bỏ qua vì đây chỉ là lớp phòng thủ bổ sung. */
    }
  }
  return child;
}

const ALLOWED_TAGS = new Set(["a", "b", "blockquote", "br", "code", "col", "colgroup", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"]);
const ALLOWED_ATTRIBUTES = new Set(["alt", "colspan", "href", "rowspan", "src", "title"]);

/**
 * Lớp lọc HTML phía client (phòng thủ chiều sâu cho HTML xem trước đã được máy chủ làm sạch): chỉ giữ thẻ/thuộc tính
 * trong danh sách cho phép, bỏ mọi handler on*, style và URL không an toàn trước khi gán vào dangerouslySetInnerHTML.
 */
export function sanitizePreviewHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  /** Duyệt đệ quy và loại bỏ phần tử/thuộc tính ngoài danh sách cho phép. */
  const clean = (node: Element): void => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Giữ chữ của thẻ lạ vô hại, nhưng bỏ hẳn nội dung script/style/iframe/object.
        if (["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript"].includes(tag)) child.remove();
        else {
          clean(child);
          child.replaceWith(...child.childNodes);
        }
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        const unsafeUrl = (name === "href" && !/^(?:https?:|mailto:|#|\/(?!\/))/i.test(value))
          || (name === "src" && !/^(?:https:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value));
        if (!ALLOWED_ATTRIBUTES.has(name) || unsafeUrl) child.removeAttribute(attribute.name);
      }
      if (tag === "a") {
        child.setAttribute("rel", "noopener noreferrer");
        child.setAttribute("target", "_blank");
      }
      clean(child);
    }
  };
  clean(document.body);
  return document.body.innerHTML;
}
