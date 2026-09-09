ALTER TABLE `ai_study_drafts`
  ADD COLUMN `edited_result` JSON NULL,
  ADD COLUMN `edit_revision` INTEGER NOT NULL DEFAULT 0;
