import { ExaminationLayout } from "@/shared/layout/examination-layout";

/** Bố cục phân hệ Khảo thí với Header dọc bên trái. */
export default function ExamsLayout({ children }: { children: React.ReactNode }) {
  return <ExaminationLayout>{children}</ExaminationLayout>;
}
