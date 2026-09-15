-- Các tác vụ chưa được duyệt bằng phiên thật phải chờ phê duyệt lại.
ALTER TABLE "retention_jobs" ADD COLUMN "approved_at" TIMESTAMP(3);
