-- SEC-P2-22: dọn dữ liệu mồ côi trước khi thêm khóa ngoại để migration không thất bại trên dữ liệu cũ.
-- Can thiệp tiến độ mà lớp hoặc người liên quan đã không còn tồn tại không còn ý nghĩa nghiệp vụ.
DELETE FROM "progress_interventions" pi
WHERE NOT EXISTS (SELECT 1 FROM "learning_classes" c WHERE c."id" = pi."class_id")
   OR NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = pi."learner_id")
   OR NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = pi."owner_id")
   OR NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = pi."created_by_id");

-- Lượt nhắc tên tới tài khoản đã xóa.
DELETE FROM "chat_message_mentions" m
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = m."mentioned_user_id");

-- Người được phân công/xử lý phúc khảo, người đóng bài tập không còn tồn tại: giữ bản ghi, bỏ tham chiếu.
UPDATE "regrade_requests" r SET "assigned_to_id" = NULL
WHERE r."assigned_to_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = r."assigned_to_id");
UPDATE "regrade_requests" r SET "resolved_by_id" = NULL
WHERE r."resolved_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = r."resolved_by_id");
UPDATE "assignments" a SET "closed_by_id" = NULL
WHERE a."closed_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."closed_by_id");

-- Bỏ giá trị mặc định cứng "usr-manager"; người phân công phải là tài khoản thật hoặc NULL.
-- AlterTable
ALTER TABLE "class_instructors" ALTER COLUMN "assigned_by" DROP NOT NULL,
ALTER COLUMN "assigned_by" DROP DEFAULT;

-- Người phân công giảng viên không còn tồn tại (kể cả giá trị mặc định cứng "usr-manager" cũ): bỏ tham chiếu.
UPDATE "class_instructors" ci SET "assigned_by" = NULL
WHERE ci."assigned_by" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = ci."assigned_by");

-- CreateIndex
CREATE INDEX "progress_interventions_learner_id_idx" ON "progress_interventions"("learner_id");

-- CreateIndex
CREATE INDEX "progress_interventions_created_by_id_idx" ON "progress_interventions"("created_by_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_instructors" ADD CONSTRAINT "class_instructors_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regrade_requests" ADD CONSTRAINT "regrade_requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regrade_requests" ADD CONSTRAINT "regrade_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_interventions" ADD CONSTRAINT "progress_interventions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_interventions" ADD CONSTRAINT "progress_interventions_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_interventions" ADD CONSTRAINT "progress_interventions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_interventions" ADD CONSTRAINT "progress_interventions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_mentioned_user_id_fkey" FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
