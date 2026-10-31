"use client";

import { BookOpenCheck, Database, FileQuestion, Sparkles } from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { WorkspaceSubNavigation, type WorkspaceSubNavItem } from "./workspace-sub-navigation";

const examSubNavItems: WorkspaceSubNavItem[] = [
  {
    href: "/exams",
    label: "Đề thi & Kết quả",
    description: "Tạo đề, giao bài & bảng điểm",
    icon: BookOpenCheck,
    exact: true,
  },
  {
    href: "/questions",
    label: "Ngân hàng câu hỏi",
    description: "Kho câu hỏi & ma trận đề",
    icon: FileQuestion,
    exact: true,
  },
  {
    href: "/questions/scan",
    label: "Quét đề bằng AI",
    description: "Số hóa câu hỏi từ ảnh & PDF",
    icon: Sparkles,
    badge: "AI",
    exact: true,
  },
  {
    href: "/materials",
    label: "Kho học liệu",
    description: "Tài liệu & bài giảng số",
    icon: Database,
  },
];

/** Khung bố cục chuẩn Khảo thí: Tích hợp Header dọc bên trái cho các chức năng con và khu vực tác nghiệp chính. */
export function ExaminationLayout({ children }: { children: React.ReactNode }) {
  const { session } = useApp();

  // Học viên làm bài toàn màn hình, không hiển thị Header dọc quản trị khảo thí
  if (session.roleCode === "LEARNER") {
    return <>{children}</>;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC KHẢO THÍ */}
        <WorkspaceSubNavigation
          title="Chức năng khảo thí"
          ariaLabel="Menu chức năng khảo thí"
          items={examSubNavItems}
          asideClassName="w-full lg:w-64 shrink-0 space-y-3.5 lg:sticky lg:top-[85px]"
          showBadges
        />

        {/* VÙNG NỘI DUNG TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
