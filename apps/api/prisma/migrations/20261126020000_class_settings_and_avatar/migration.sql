-- Bổ sung quyền đăng bài bảng tin cho học viên và ảnh đại diện (avatar) tùy chỉnh của lớp học.

ALTER TABLE "learning_classes"
  ADD COLUMN "allow_learner_feed_posting" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "avatar_object_key" VARCHAR(500),
  ADD COLUMN "avatar_mime_type" VARCHAR(50),
  ADD COLUMN "avatar_updated_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "learning_classes_avatar_object_key_key" ON "learning_classes"("avatar_object_key");
