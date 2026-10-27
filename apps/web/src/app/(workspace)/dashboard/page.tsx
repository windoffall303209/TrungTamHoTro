import { redirect } from "next/navigation";

// Chuyển hướng người dùng từ dashboard cũ sang không gian quản lý lớp học.
export default function DashboardPage() {
  redirect("/courses");
}

