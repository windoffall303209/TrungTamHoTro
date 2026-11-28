-- Bổ sung công tắc bật/tắt gia sư AI trên đề kiểm tra, bảng cache gợi ý dẫn dắt theo câu hỏi mẫu và bảng lưu lượt hỏi đáp theo từng câu trong lượt làm bài.

ALTER TABLE "exams" ADD COLUMN "ai_tutor_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_tutor_preset_caches" (
    "id" VARCHAR(191) NOT NULL,
    "question_id" VARCHAR(191) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "preset_key" VARCHAR(64) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reply" TEXT,
    "model" VARCHAR(200),
    "lease_token" VARCHAR(64),
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tutor_preset_caches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exam_attempt_tutor_turns" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "preset_key" VARCHAR(64),
    "user_prompt" TEXT NOT NULL,
    "ai_reply" TEXT NOT NULL,
    "from_cache" BOOLEAN NOT NULL DEFAULT false,
    "model" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attempt_tutor_turns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_tutor_preset_caches_question_id_preset_key_language_idx" ON "ai_tutor_preset_caches"("question_id", "preset_key", "language");
CREATE INDEX "ai_tutor_preset_caches_state_created_id_idx" ON "ai_tutor_preset_caches"("state", "created_at" DESC, "id" DESC);

CREATE INDEX "exam_attempt_tutor_turns_attempt_id_question_id_created_at_idx" ON "exam_attempt_tutor_turns"("attempt_id", "question_id", "created_at");
CREATE INDEX "exam_attempt_tutor_turns_attempt_id_created_at_idx" ON "exam_attempt_tutor_turns"("attempt_id", "created_at");

ALTER TABLE "ai_tutor_preset_caches" ADD CONSTRAINT "ai_tutor_preset_caches_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_attempt_tutor_turns" ADD CONSTRAINT "exam_attempt_tutor_turns_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_attempt_tutor_turns" ADD CONSTRAINT "exam_attempt_tutor_turns_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
