import type { InstructorRole } from "@/lib/learning-types";

export type DetailTab = "overview" | "instructors" | "learners" | "operations";

export type RemoveTarget = {
  kind: "instructors" | "enrollments";
  id: string;
  name: string;
};

export const roleLabel: Record<InstructorRole, string> = {
  PRIMARY: "Giảng viên chính",
  CO_INSTRUCTOR: "Đồng giảng viên",
};
