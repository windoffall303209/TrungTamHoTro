-- Bổ sung công tắc cho phép học viên xem đáp án chi tiết ngay sau khi nộp bài trắc nghiệm.

ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "show_answers_after_submit" BOOLEAN NOT NULL DEFAULT false;
