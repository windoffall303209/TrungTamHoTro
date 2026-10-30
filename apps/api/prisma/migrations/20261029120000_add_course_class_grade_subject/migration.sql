-- Đồng bộ metadata khối/lớp với Prisma schema hiện hành.
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "grade" SMALLINT;
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(100);
ALTER TABLE "course_versions" ADD COLUMN IF NOT EXISTS "grade" SMALLINT;
ALTER TABLE "course_versions" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(100);
ALTER TABLE "learning_classes" ADD COLUMN IF NOT EXISTS "grade" SMALLINT;
ALTER TABLE "learning_classes" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "courses_grade_subject_idx" ON "courses"("grade", "subject");
CREATE INDEX IF NOT EXISTS "course_versions_grade_subject_idx" ON "course_versions"("grade", "subject");
CREATE INDEX IF NOT EXISTS "learning_classes_grade_subject_idx" ON "learning_classes"("grade", "subject");
