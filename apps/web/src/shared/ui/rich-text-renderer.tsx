"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export interface RichTextProps {
  children: string;
  className?: string;
}

/** Chuyển delimiter LaTeX chuẩn \(...\) và \[...\] sang cú pháp $...$ / $$...$$ cho remark-math. */
export function normalizeLatexDelimiters(content: string): string {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`);
    })
    .join("");
}

/** Bộ kết xuất Markdown/GFM và công thức toán KaTeX được tách chunk riêng để nạp theo nhu cầu. */
export function RichTextRenderer({ children, className = "" }: RichTextProps) {
  const normalized = normalizeLatexDelimiters(children);
  return (
    <div className={`rich-content min-w-0 text-slate-800 dark:text-slate-200 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export default RichTextRenderer;
