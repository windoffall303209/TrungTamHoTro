import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard";

describe("Dashboard", () => {
  it("hiển thị đủ bốn phân hệ cốt lõi", () => {
    render(<Dashboard />);

    expect(screen.getAllByText("Kho dữ liệu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ngân hàng câu hỏi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Diễn đàn").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lớp học online").length).toBeGreaterThan(0);
  });
});

