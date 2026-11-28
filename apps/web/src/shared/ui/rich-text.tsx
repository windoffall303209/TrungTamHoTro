"use client";

import { lazy, Suspense } from "react";
import type { RichTextProps } from "./rich-text-renderer";

const RICH_SYNTAX_PATTERN = /[*_`~#$\\[\]|<>]|^\s*(?:[-+*]|\d+\.)\s|https?:\/\//m;

const LazyRichTextRenderer = lazy(() => import("./rich-text-renderer"));

/** Kiểm tra chuỗi có chứa cú pháp Markdown, liên kết hoặc LaTeX cần bộ kết xuất nặng hay không. */
export function hasRichFormatting(content: string): boolean {
  return RICH_SYNTAX_PATTERN.test(content);
}

/** Hiển thị khung chờ gọn nhẹ trong lúc chunk Markdown/KaTeX đang tải lần đầu, tránh chớp mã LaTeX thô. */
function RichTextFallback({ className = "" }: Pick<RichTextProps, "className">) {
  return (
    <div
      aria-busy="true"
      className={`rich-content min-w-0 animate-pulse space-y-1.5 ${className}`}
      data-rich-text-loading="true"
    >
      <span className="block h-3.5 w-3/4 rounded bg-slate-200/70 dark:bg-slate-700/60" />
    </div>
  );
}

/** Kết xuất văn bản thuần thành các đoạn `<p>` ngay lập tức mà không cần tải chunk Markdown/KaTeX. */
function PlainRichText({ children, className = "" }: RichTextProps) {
  const paragraphs = children
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <div className={`rich-content min-w-0 text-slate-800 dark:text-slate-200 ${className}`}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/** Render Markdown/GFM và công thức LaTeX qua KaTeX bằng chunk nạp lười khi nội dung thực sự cần. */
export function RichText({ children, className = "" }: RichTextProps) {
  if (!hasRichFormatting(children)) {
    return <PlainRichText className={className}>{children}</PlainRichText>;
  }
  return (
    <Suspense fallback={<RichTextFallback className={className} />}>
      <LazyRichTextRenderer className={className}>{children}</LazyRichTextRenderer>
    </Suspense>
  );
}
