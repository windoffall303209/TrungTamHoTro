-- Kiểm tra an toàn trước khi gỡ bỏ hoàn toàn tính năng retention: không cho phép xóa nếu còn job đang chờ hoặc đang chạy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "retention_jobs"
    WHERE "status" IN ('PENDING', 'RUNNING')
  ) THEN
    RAISE EXCEPTION 'Aborting retention removal: pending or running retention_jobs still exist.';
  END IF;
END $$;

-- Gỡ tham chiếu retentionDays không còn dùng khỏi cấu hình nền tảng hiện có.
UPDATE "system_settings"
SET "value" = "value" - 'retentionDays'
WHERE "key" = 'platform'
  AND ("value" ? 'retentionDays');

DROP TABLE IF EXISTS "retention_jobs";
DROP TABLE IF EXISTS "legal_holds";
DROP TABLE IF EXISTS "retention_policies";
