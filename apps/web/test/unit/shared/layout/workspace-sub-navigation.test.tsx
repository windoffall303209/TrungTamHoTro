import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOpenCheck, Users } from "lucide-react";
import { WorkspaceSubNavigation } from "../../../../src/shared/layout/workspace-sub-navigation";

const route = vi.hoisted(() => ({ pathname: "/admin/users" }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ t: (label: string) => label }) }));

describe("WorkspaceSubNavigation", () => {
  afterEach(() => {
    cleanup();
    route.pathname = "/admin/users";
  });

  it("giữ cấu trúc menu quản trị và đánh dấu cả đường dẫn con", () => {
    route.pathname = "/admin/users/detail";
    render(
      <WorkspaceSubNavigation
        title="Chức năng quản trị"
        ariaLabel="Menu chức năng quản trị"
        asideClassName="sticky top-[85px]"
        items={[{ href: "/admin/users", label: "Người dùng", description: "Tài khoản", icon: Users }]}
      />,
    );

    const link = screen.getByRole("link", { name: /Người dùng/ });
    expect(screen.getByRole("navigation", { name: "Menu chức năng quản trị" })).toContainElement(link);
    expect(link).toHaveAttribute("href", "/admin/users");
    expect(link).toHaveClass("bg-sky-50");
    expect(screen.getByText("Người dùng").parentElement).toHaveClass("min-w-0", "text-left");
    expect(screen.getByText("Chức năng quản trị")).toBeInTheDocument();
  });

  it("đường dẫn exact chỉ sáng ở trang gốc, vẫn hiển thị badge của khảo thí", () => {
    route.pathname = "/exams/123";
    render(
      <WorkspaceSubNavigation
        title="Chức năng khảo thí"
        ariaLabel="Menu chức năng khảo thí"
        asideClassName="lg:sticky lg:top-[85px]"
        showBadges
        items={[
          { href: "/exams", label: "Đề thi", description: "Đề và kết quả", icon: BookOpenCheck, exact: true },
          { href: "/exams/123", label: "Quét đề", description: "OCR", icon: BookOpenCheck, badge: "AI" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Đề thi/ })).not.toHaveClass("bg-sky-50");
    expect(screen.getByRole("link", { name: /Quét đề/ })).toHaveClass("bg-sky-50");
    expect(screen.getByText("AI")).toBeInTheDocument();
  });
});
