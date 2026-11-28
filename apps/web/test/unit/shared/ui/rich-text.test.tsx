import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeLatexDelimiters } from "../../../../src/shared/ui/rich-text-renderer";
import { hasRichFormatting } from "../../../../src/shared/ui/rich-text";
import { RichText } from "../../../../src/shared/ui/ui";

afterEach(() => {
  cleanup();
});

describe("RichText lazy Markdown and KaTeX renderer (C02)", () => {
  it("nhận diện văn bản thuần và hiển thị đồng bộ không cần nạp chunk nặng", () => {
    expect(hasRichFormatting("Trình bày khái niệm REST ngắn gọn.")).toBe(false);
    expect(hasRichFormatting("Công thức $x^2$")).toBe(true);
    expect(hasRichFormatting("Nội dung **quan trọng**")).toBe(true);

    const { container } = render(<RichText>{"Đoạn một\n\nĐoạn hai"}</RichText>);
    expect(container.querySelector("[data-rich-text-loading]")).toBeNull();
    expect(screen.getByText("Đoạn một")).toBeInTheDocument();
    expect(screen.getByText("Đoạn hai")).toBeInTheDocument();
  });

  it("chuyển đổi delimiter \\(...\\) và \\[...\\] mà không phá vỡ nội dung trong code span/block", () => {
    const input = "Công thức \\(a^2 + b^2\\), khối \\[\\frac{1}{2}\\], giữ nguyên `\\(x\\)` và ```\n\\[y\\]\n```";
    const output = normalizeLatexDelimiters(input);
    expect(output).toContain("$a^2 + b^2$");
    expect(output).toContain("$$\n\\frac{1}{2}\n$$");
    expect(output).toContain("`\\(x\\)`");
    expect(output).toContain("```\n\\[y\\]\n```");
  });

  it("nạp lười bộ kết xuất KaTeX cho công thức inline, block và bảng GFM", async () => {
    const content = [
      "Giá trị **quan trọng**: \\(\\frac{3}{4}\\) và khối:",
      "",
      "\\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]",
      "",
      "| Cột A | Cột B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");

    const { container } = render(<RichText>{content}</RichText>);

    await waitFor(() => {
      expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    });
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-mathml annotation")?.textContent).toContain("\\frac{3}{4}");
    expect(screen.getByText("quan trọng").tagName).toBe("STRONG");
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Cột A")).toBeInTheDocument();
  });
});
