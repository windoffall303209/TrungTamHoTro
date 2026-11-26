-- Bỏ thiết lập ghi danh muộn và chuyển trường khối (grade) sang chuỗi để hỗ trợ 12 khối chuẩn cùng tùy chọn Khác
ALTER TABLE "learning_classes" DROP COLUMN IF EXISTS "allow_late_enrollment";

ALTER TABLE "courses"
  ALTER COLUMN "grade" TYPE VARCHAR(100) USING CASE WHEN "grade" IS NULL THEN NULL ELSE "grade"::text END;

ALTER TABLE "course_versions"
  ALTER COLUMN "grade" TYPE VARCHAR(100) USING CASE WHEN "grade" IS NULL THEN NULL ELSE "grade"::text END;

ALTER TABLE "learning_classes"
  ALTER COLUMN "grade" TYPE VARCHAR(100) USING CASE WHEN "grade" IS NULL THEN NULL ELSE "grade"::text END;
