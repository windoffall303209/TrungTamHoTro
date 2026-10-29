import { ExaminationLayout } from "@/components/examination-layout";

/** Bố cục phân hệ Kho học liệu với Header dọc bên trái. */
export default function MaterialsLayout({ children }: { children: React.ReactNode }) {
  return <ExaminationLayout>{children}</ExaminationLayout>;
}
