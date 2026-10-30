import { ExaminationLayout } from "@/shared/layout/examination-layout";

/** Bố cục phân hệ Ngân hàng câu hỏi với Header dọc bên trái. */
export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return <ExaminationLayout>{children}</ExaminationLayout>;
}
