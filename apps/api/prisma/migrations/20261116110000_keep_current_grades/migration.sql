BEGIN;

-- Điểm hiện hành đã nằm trên bài nộp và lượt thi, kể cả điểm sau phúc khảo.
DROP TABLE IF EXISTS public.assignment_grade_changes, public.grade_history, public.file_reviews;

COMMIT;
