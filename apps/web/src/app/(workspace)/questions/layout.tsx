import { QuestionBankLayout } from "@/shared/layout/question-bank-layout";

/** Bố cục phân hệ Ngân hàng câu hỏi với danh sách khóa học bên trái. */
export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return <QuestionBankLayout>{children}</QuestionBankLayout>;
}
