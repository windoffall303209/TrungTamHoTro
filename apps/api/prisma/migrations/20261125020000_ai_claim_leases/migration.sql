-- Bổ sung fencing token và mốc hết hạn lease cho các bản ghi AI đang xử lý (GENERATING).
-- Cột cho phép NULL để tương thích bản ghi cũ và tránh viết lại toàn bảng khi triển khai.
ALTER TABLE "ai_grading_suggestions"
  ADD COLUMN "lease_token" VARCHAR(64),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3);

ALTER TABLE "ai_study_drafts"
  ADD COLUMN "lease_token" VARCHAR(64),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3);

-- Chỉ mục bộ phận hỗ trợ quét nhanh các bản ghi GENERATING đã hết hạn lease sau crash/restart.
CREATE INDEX "ai_grading_suggestions_generating_lease_idx"
  ON "ai_grading_suggestions" ("lease_expires_at")
  WHERE "state" = 'GENERATING' AND "lease_expires_at" IS NOT NULL;

CREATE INDEX "ai_study_drafts_generating_lease_idx"
  ON "ai_study_drafts" ("lease_expires_at")
  WHERE "state" = 'GENERATING' AND "lease_expires_at" IS NOT NULL;
